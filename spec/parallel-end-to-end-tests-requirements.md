# Parallel End-to-End Tests – Requirements

Status: approved

## Goal

The end-to-end tests run in parallel, locally and in CI, so that the complete suite takes much less time than today,
when all tests run one after another. The tests themselves, what they check and how a developer starts them stay as
they are.

## Users and roles

- The developer, who runs the end-to-end tests locally: the complete suite, a few specs, or the Playwright UI.
- The AI that builds a step plan, which runs the specs a step affects and the complete suite once per plan.
- CI, which runs both end-to-end workflows on every push to `main` and on every pull request.

## Scenarios

- The developer runs `npm run test:e2e`. Several workers run the tests at the same time, each against its own test
  database and its own server, and the run ends with one result and one report, as today, but sooner.
- The developer runs `npm run test:e2e:production`. The app is built once, and each worker tests against its own
  server on that build.
- A push starts the two end-to-end workflows in CI. Each runs its suite with the workers of CI and uploads one report,
  as today.
- A developer who wants to debug a test sets the number of workers to one for that run.

## Requirements

### Parallel run

- R1: The end-to-end tests must run with several workers at the same time in one run, each with its own test database
  and its own server, so that no worker sees or resets the data of another.
  - Acceptance: a complete run with more than one worker passes, and the tests of different spec files run at the same
    time.
- R2: Both runs must be parallel: the run against the development server (`npm run test:e2e`) and the run against a
  production build (`npm run test:e2e:production`). The production run builds the app only once.
  - Acceptance: both commands run with more than one worker and pass; the production run builds once.
- R3: A run must end with one result and one report, as today, whatever the number of workers.
  - Acceptance: a parallel run writes one HTML report with all tests, and its exit code fails when one test fails.

### Number of workers

- R4: The number of workers must have a default, which the environment variable `HIPPOWIKI_E2E_WORKERS` can change for
  one run, e.g. `HIPPOWIKI_E2E_WORKERS=1 npm run test:e2e`. The default is 4 workers locally and 3 in CI, where both
  end-to-end workflows set the variable.
  - Acceptance: a run without the variable uses 4 workers locally; both CI workflows run with 3; a run with the
    variable uses the given number.
- R9: The number of workers must be a whole number from 1 to 8. Worker 1 uses the port 3100, and each further worker the
  next port, up to 3107. Any other value of the variable, such as `0`, `9`, `two` or `2.5`, must stop the run before
  any server starts, with a message that names the variable, the value and the allowed range.
  - Acceptance: a run with each of these values fails at once with that message, and no server or database is
    started.
- R10: When Playwright's own `--workers` option asks for more workers than the variable sets, the run must fail with a
  message that the number of workers is set with `HIPPOWIKI_E2E_WORKERS`, not with `--workers`. Fewer workers than the
  variable sets must work.
  - Acceptance: `HIPPOWIKI_E2E_WORKERS=2 npm run test:e2e -- --workers=3` fails with that message;
    `HIPPOWIKI_E2E_WORKERS=2 npm run test:e2e -- --workers=1` passes.
- R6: Every run must use the same number of workers, the complete suite as well as a run of a few specs, such as the
  specs a step affects or `--last-failed`. The rules of a step plan for which specs run stay as they are.
  - Acceptance: a run of one spec file starts the default number of servers and passes.
- R7: A run with the variable set to one worker must behave exactly like today: one test database, one server on port
  3100, all tests one after another. So a test can be debugged without parallel servers, and the Playwright UI works
  as today.
  - Acceptance: a complete run with one worker passes, with one server on port 3100 and the tests one after another.

### Stability

- R8: The parallel runs must be stable: before the feature is done, both runs pass the complete suite three times in a
  row locally with the default number of workers, and both CI workflows pass on the push, where a test that passes
  only on a retry already fails the run.
  - Acceptance: three passing complete runs in a row of each command locally, and both CI workflows green.

### Side effects of a run

- R11: A run must leave every file that Git tracks as it was, in both runs and with any number of workers.
  - Acceptance: after a complete run of each command with the default number of workers, and after the first run in a
    fresh checkout, `git status` shows no changed tracked file.
- R12: When one of the ports of the servers is already taken, the run must fail before any test runs, with a message
  that names the taken port, as today for port 3100. A server that someone else started is never used.
  - Acceptance: with a program listening on port 3101, a run with two or more workers fails at start and names that
    port.
- R13: As today, nothing of a run may be left running after it ends, also when it fails: no server, no test database
  and no container.
  - Acceptance: after a passing and after a failing parallel run, no server listens on the ports of the run and the
    test database container is gone.

### Speed

- R5: The time of the complete suite must be measured before and after the change, locally and in CI, for both runs,
  and written down. No fixed target has to be met.
  - Acceptance: the times before and after are written down for both runs, locally and in CI.

## Scope

- In: parallel workers for both end-to-end runs, locally and in CI; the default number of workers and its variable.
- Not in: splitting the CI run over several jobs (shards); running the integration tests in parallel; changing what the
  tests check.

## Effect on existing features

- No feature of the app changes; only how the end-to-end tests run.
- The rule that all end-to-end tests share one test database and run one after another changes: each worker has its
  own database and server.
- The time of the complete suite, which the rules of a step plan name, changes.
- The integration tests and the end-to-end tests still use the same test database container, so they still never run
  at the same time.
- The documentation of the end-to-end commands names the new variable and its default.
- The roadmap entry "Sharding the end-to-end tests" is done by this feature.
- Security and privacy: none. The test databases stay throwaway, in memory, and reachable only from the machine of the
  run, as today.

## Decisions

- Several workers in one run, not separate shards: the workers take the next test file when they are free, which
  balances the load better than shards split by file, and there is one command and one report, the same locally and in
  CI. Shards in CI on top were rejected for now: they cost more runner minutes and a job to merge the reports.
- Both runs become parallel, so that the local default run and the complete suite of a step plan get faster too, at
  the cost of one development server per worker, each compiling the routes itself.
- The speedup is measured and written down, with no hard target.
- 4 workers locally and 3 in CI, fixed now rather than measured first; the CI runner has 4 CPU cores and 16 GB, so a
  development run with 3 compiling servers may be heavy there, which the stability check (R8) shows.
- A run of a few specs uses the same default as the complete suite, so that the rules of a step plan stay as they
  are; the cost is a few seconds and some memory for the servers that start in every run.
- The variable is called `HIPPOWIKI_E2E_WORKERS`, like `HIPPOWIKI_E2E_SERVER`, which chooses the run. Rejected:
  `E2E_WORKERS`, without the prefix of the project.
- An invalid number stops the run instead of falling back to the default, so that a typo is not hidden. The limit of 8
  keeps a typo such as `40` from starting 40 servers.
- The number of workers is set with the variable only, because it also decides how many servers and databases start;
  `--workers` cannot start more of them.
- A run changes no file that Git tracks, so the working tree stays clean after the tests; how the build directories
  of the development servers fit with the configuration of TypeScript is decided in the step plan.
- A taken port fails the run, as today, instead of a search for free ports, so that the ports of a run stay fixed.

## Open questions

- None.
