// Runs the checks side by side instead of one after another, and prints the output of each check as one block when it
// is done, so the outputs do not mix. `npm run check` runs the format check, the doc references, lint, the type check
// and the unit tests; `npm run check:all` (`--all`) adds the integration tests and the build. The exit code is 1 when
// any check failed; every check still runs, so one run shows all failures.
//
// What must not overlap:
// - `next typegen` writes `.next/types`, which lint and the type check read (`tsconfig.json` includes it), so it runs
//   first and alone.
// - `next build` writes `.next/types` again, so it starts only after lint and the type check are done.
// - The cost tests measure wall-clock time, so they run last and alone (see `spec/testing.md`).
// - The integration tests use the test database container of the end-to-end tests, so `npm run check:all` never runs
//   at the same time as `npm run test:e2e`.
import { spawn } from "node:child_process";

type Check = { name: string; command: string };
type Result = { name: string; ok: boolean; seconds: number; output: string };

const all = process.argv.includes("--all");

/** Runs one command in a shell and keeps its output, stdout and stderr in the order they came. */
function run({ name, command }: Check): Promise<Result> {
  const start = performance.now();
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const finish = (ok: boolean, extra = "") => {
      const result = {
        name,
        ok,
        seconds: (performance.now() - start) / 1000,
        output: Buffer.concat(chunks).toString("utf8") + extra,
      };
      report(result);
      resolve(result);
    };
    child.on("error", (error) => finish(false, `\n${error.message}\n`));
    child.on("close", (code) => finish(code === 0));
  });
}

/** Prints the block of a finished check: a status line, then its output. */
function report({ name, ok, seconds, output }: Result): void {
  const status = ok ? "passed" : "FAILED";
  process.stdout.write(`\n── ${name}: ${status} in ${seconds.toFixed(1)} s ──\n${output.trim()}\n`);
}

const started = performance.now();
const results: Result[] = [];

// Alone first: the route types that lint and the type check read.
results.push(await run({ name: "typegen", command: "npx next typegen" }));

// Side by side. The build waits for lint and the type check, because it writes the route types again.
const lintAndTypes = Promise.all([
  run({ name: "lint", command: "npm run --silent lint" }),
  run({ name: "tsc", command: "npx tsc --noEmit" }),
]);
const parallel: Promise<Result | Result[]>[] = [
  run({ name: "format:check", command: "npm run --silent format:check" }),
  run({ name: "docs:check", command: "npm run --silent docs:check" }),
  run({ name: "knip", command: "npm run --silent knip" }),
  run({ name: "test:unit", command: "npm run --silent test:unit" }),
  lintAndTypes,
];
if (all) {
  parallel.push(run({ name: "test:integration", command: "npm run --silent test:integration" }));
  parallel.push(lintAndTypes.then(() => run({ name: "build", command: "npm run --silent build" })));
}
results.push(...(await Promise.all(parallel)).flat());

// Alone last: the tests with a wall-clock budget.
results.push(await run({ name: "test:cost", command: "npm run --silent test:cost" }));

const failed = results.filter(({ ok }) => !ok).map(({ name }) => name);
const total = ((performance.now() - started) / 1000).toFixed(1);
process.stdout.write(
  failed.length === 0
    ? `\nAll ${results.length} checks passed in ${total} s.\n`
    : `\n${failed.length} of ${results.length} checks failed in ${total} s: ${failed.join(", ")}\n`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
