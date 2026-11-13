// Checks that the file references in `spec/*.md`, `README.md` and `CLAUDE.md` point to files that exist, so that a
// renamed or deleted file cannot leave a spec pointing nowhere. Run by `npm run docs:check`, part of `npm run check`.
//
// A reference is a code span (`...`) outside a fenced code block that
// - starts with a top-level file or directory of the repository (`src/`, `scripts/image.sh smoke`, `Containerfile`),
//   checked by its first word, so a command whose first word is an existing file passes, or
// - ends in `.md`, checked as a whole: from the repository root, and a bare name such as `pages.md` also in `spec/`.
//   This catches a reference to a Markdown file in a directory that does not exist at all.
//
// Skipped: spans with a placeholder or a glob (`<`, `*`), paths that Git ignores (`coverage/`, `build/`,
// `src/generated/`), and the step plans `spec/*-steps.md`, which name files that do not exist yet. A bare file name
// such as `wait.ts` is not checked: the sentence around it names its directory.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const documents = [
  ...readdirSync("spec")
    .filter((name) => name.endsWith(".md") && !name.endsWith("-steps.md"))
    .map((name) => path.join("spec", name)),
  "README.md",
  "CLAUDE.md",
];

/** Returns the paths among `paths` that Git ignores. */
function ignoredPaths(paths: string[]): Set<string> {
  if (paths.length === 0) return new Set();
  try {
    const output = execFileSync("git", ["check-ignore", "--stdin"], {
      cwd: root,
      input: paths.join("\n"),
      encoding: "utf8",
    });
    return new Set(output.split("\n").filter(Boolean));
  } catch (error) {
    // `git check-ignore` exits with 1 when no path is ignored.
    if ((error as { status?: number }).status === 1) return new Set();
    throw error;
  }
}

const topLevelEntries = new Set(readdirSync(root).filter((name) => name !== ".git"));
for (const ignored of ignoredPaths([...topLevelEntries])) topLevelEntries.delete(ignored);

type Reference = { document: string; line: number; span: string; candidates: string[] };

/** The paths a code span may refer to, any of which must exist; none when the span is not a file reference. */
function candidatesOf(span: string): string[] {
  if (span.includes("<") || span.includes("*")) return [];
  if (span.endsWith(".md") && path.basename(span) !== ".md") {
    return span.includes("/") ? [span] : [span, path.join("spec", span)];
  }
  const firstWord = span.split(/\s+/)[0] ?? "";
  const topLevel = firstWord.split("/")[0] ?? "";
  return topLevelEntries.has(topLevel) ? [firstWord] : [];
}

const references: Reference[] = [];
for (const document of documents) {
  let inFence = false;
  readFileSync(document, "utf8")
    .split("\n")
    .forEach((text, index) => {
      if (/^\s*(```|~~~)/.test(text)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      for (const [, span] of text.matchAll(/`([^`]+)`/g)) {
        const candidates = candidatesOf(span!.trim());
        if (candidates.length > 0) references.push({ document, line: index + 1, span: span!, candidates });
      }
    });
}

const ignored = ignoredPaths([...new Set(references.flatMap((reference) => reference.candidates))]);
const broken = references.filter(
  ({ candidates }) =>
    !candidates.some((candidate) => ignored.has(candidate)) &&
    !candidates.some((candidate) => existsSync(path.join(root, candidate))),
);

for (const { document, line, span } of broken) {
  console.error(`${document}:${line}: \`${span}\` does not exist`);
}
if (broken.length > 0) {
  console.error(`${broken.length} broken file reference(s).`);
  process.exit(1);
}
console.log(`${references.length} file references in ${documents.length} documents, all found.`);
