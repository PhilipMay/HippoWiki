// Turns coverage/coverage-summary.json (written by `npm run test:coverage`) into Markdown tables. In GitHub Actions it
// appends them to the job summary (GITHUB_STEP_SUMMARY); locally it prints them.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const METRICS = ["statements", "branches", "functions", "lines"] as const;

type Metric = { total: number; covered: number; pct: number | "Unknown" };
type FileCoverage = Record<(typeof METRICS)[number], Metric>;

const SUMMARY_FILE = path.join("coverage", "coverage-summary.json");

if (!existsSync(SUMMARY_FILE)) {
  console.error(`${SUMMARY_FILE} not found; run \`npm run test:coverage\` first.`);
  process.exit(1);
}

const { total, ...files } = JSON.parse(readFileSync(SUMMARY_FILE, "utf8")) as {
  total: FileCoverage;
  [file: string]: FileCoverage;
};

function formatMetric({ total, covered, pct }: Metric): string {
  if (total === 0) return "–";
  const percent = typeof pct === "number" ? pct.toFixed(1) : pct;
  return `${percent}% (${covered}/${total})`;
}

function row(name: string, coverage: FileCoverage): string {
  return `| ${name} | ${METRICS.map((metric) => formatMetric(coverage[metric])).join(" | ")} |`;
}

const header = ["| File | Statements | Branches | Functions | Lines |", "| --- | ---: | ---: | ---: | ---: |"];
const fileRows = Object.entries(files)
  .map(([file, coverage]) => [path.relative(process.cwd(), file), coverage] as const)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, coverage]) => row(`\`${file}\``, coverage));

const markdown = [
  "## Unit test coverage",
  "",
  ...header,
  row("**All files**", total),
  "",
  "<details><summary>Coverage per file</summary>",
  "",
  ...header,
  ...fileRows,
  "",
  "</details>",
  "",
].join("\n");

const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary) {
  appendFileSync(stepSummary, markdown);
} else {
  process.stdout.write(markdown);
}
