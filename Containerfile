# The container image of HippoWiki. On every start it applies the pending database migrations, creates the admin
# account if there is none, and then serves the wiki (scripts/image-start.sh). Built with `npm run image:build` (scripts/image.sh). Only plain instructions are used (no
# heredocs, no RUN --mount), because the Podman of the CI runner is older than the one of the development machine.

# The only stage that names the Node.js image, so its version stands in one place. The major version must be the one
# of .nvmrc; scripts/image.sh checks that before the build. Dependabot keeps the pinned minor version up to date.
FROM docker.io/library/node:26.13-slim AS base

# The dependencies of the project. The postinstall script runs `prisma generate`, which needs the schema and the
# Prisma configuration.
FROM base AS deps
WORKDIR /src
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# The standalone build. It starts from deps for node_modules and the generated Prisma client in src/generated, which
# .containerignore keeps out of the build context. It needs no database.
FROM deps AS build
COPY . .
RUN HIPPOWIKI_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 npm run build
# `next build` copies a .env file of the project into the standalone output, which the app stage copies as a whole.
# .containerignore keeps .env out of the build context; this is the second guard.
RUN if [ -e .next/standalone/.env ]; then \
      echo "The standalone output contains a .env file; it must not reach the image." >&2; \
      exit 1; \
    fi
# The admin setup (scripts/admin.ts) as one file, build/admin.mjs. It imports @prisma/client, pg, pino, pino-pretty
# and @node-rs/argon2 from the node_modules of the standalone output; everything else is part of the file.
RUN npm run build:admin

# What `prisma migrate deploy` needs, apart from the node_modules of the standalone output: the Prisma CLI and dotenv,
# which prisma.config.ts imports. Both are development dependencies, so the standalone output does not contain them.
# Their versions are read from package-lock.json; their own dependencies are resolved anew at every build.
FROM base AS migrate-tools
WORKDIR /migrate
COPY package-lock.json /tmp/package-lock.json
RUN PRISMA_VERSION="$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")" \
    && DOTENV_VERSION="$(node -p "require('/tmp/package-lock.json').packages['node_modules/dotenv'].version")" \
    && echo '{ "private": true }' > package.json \
    && npm install --no-audit --no-fund "prisma@${PRISMA_VERSION}" "dotenv@${DOTENV_VERSION}" \
    && rm /tmp/package-lock.json
# The postinstall script of @prisma/engines downloads the schema engine that `prisma migrate deploy` needs.
RUN if ! ls node_modules/@prisma/engines/schema-engine-* >/dev/null 2>&1; then \
      echo "The Prisma schema engine was not downloaded into node_modules/@prisma/engines." >&2; \
      exit 1; \
    fi

# The image: the standalone server in /app, the migration tools in /app/migrate.
FROM base AS app
LABEL org.opencontainers.image.source="https://github.com/PhilipMay/HippoWiki"
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1
# Like every file of the image, owned by root, so that the server, which runs as `node`, cannot change its own code.
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
# prisma.config.ts imports dotenv and prisma/config, which are found only next to this node_modules, and its paths to
# the schema and the migrations are relative to it. The seed script is left out.
COPY --from=migrate-tools /migrate/node_modules ./migrate/node_modules
COPY prisma.config.ts ./migrate/
COPY prisma/schema.prisma ./migrate/prisma/
COPY prisma/migrations ./migrate/prisma/migrations
# The admin setup, next to the node_modules of the standalone output.
COPY --from=build /src/build/admin.mjs ./admin.mjs
# The password hashing with its native build for the platform of the image, whatever the standalone output contains
# of it: Next.js only traces what the server imports.
COPY --from=deps /src/node_modules/@node-rs ./node_modules/@node-rs
COPY scripts/image-admin.sh scripts/image-migrate.sh scripts/image-start.sh ./
# The cache of Next.js is the only place below /app that `node` can write to.
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
EXPOSE 3000
CMD ["./image-start.sh"]
