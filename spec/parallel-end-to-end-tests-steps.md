# Parallel End-to-End Tests – Steps

## Goal

The end-to-end tests run with several workers at the same time, locally and in CI, each worker with its own test
database and its own server, so that the complete suite takes much less time. The tests, what they check and the
commands that start them stay as they are; `HIPPOWIKI_E2E_WORKERS` sets the number of workers for one run. The
requirements are in `spec/parallel-end-to-end-tests-requirements.md`.

## Scope

- In: several workers in one Playwright run, for the run against the development server (`npm run test:e2e`) and the
  run against a production build (`npm run test:e2e:production`), locally and in both CI workflows; one database per
  worker in the one test database container, one server per worker on the ports 3100 to 3107; the variable
  `HIPPOWIKI_E2E_WORKERS` with the default 4, which both CI workflows set to 3; the checks of an invalid number and of
  `--workers`; the times of the complete suite before and after.
- Not in: shards, in CI or locally; running the integration tests in parallel; tests running in parallel within one
  spec file (`fullyParallel` stays off: the files are spread over the workers, the tests of a file run in order);
  changes to what the tests check; a search for free ports.

## Checklist

- [x] Measure the times before
- [x] Worker settings
- [x] A database and a development server per worker
- [ ] A production run built once
- [ ] Refuse more workers than servers
- [ ] Three workers in CI
- [ ] Stability and the times after
- [ ] Wrap-up

## Sessions

The plan runs in two sessions, so that the push at the stop point starts both CI workflows with the parallel run, and
the second session can check them:

- Session 1: from "Measure the times before" to "Three workers in CI", the stop point.
- Session 2: "Stability and the times after" and the wrap-up.

## Measurements

The times of the complete suite, filled in by the steps "Measure the times before" (R5) and "Stability and the times
after", and moved into `testing.md` by the wrap-up.

The local values are of a Mac16,7 (14 CPU cores, 48 GB memory, Podman machine with 7 CPUs and 4 GB), 777 tests; the CI
values are the medians of the last five successful runs on `main`, on `ubuntu-24.04` (4 CPU cores, 16 GB). The CI
values were read through the public GitHub API, because `gh` was not installed.

- Local, `npm run test:e2e`: before 6.4 min reported by Playwright, 6 min 25 s wall time; after …
- Local, `npm run test:e2e:production`: before 3.8 min reported by Playwright, 3 min 50 s wall time, build included;
  after …
- CI, `end_to_end_tests`: before 18 min 41 s for the job, 11 min 29 s for the step of the tests; after …
- CI, `end_to_end_tests_production`: before 7 min 36 s for the job, 5 min 1 s for the step of the tests; after …

## Measure the times before

### Goal

The times of the complete suite with one worker, the base for the comparison of R5, are written down before anything
changes.

### Build

- Run `npm run test:e2e` and then `npm run test:e2e:production` once each on the unchanged code, one after the other,
  in the background with a long enough timeout. Write down the duration that Playwright reports at the end of each run
  and the wall time of the command (`time`), which includes the start of the container and the servers, and for the
  production run the build.
- Read the durations of the last five successful runs on `main` of the workflows `end_to_end_tests` and
  `end_to_end_tests_production` with `gh run list` and `gh run view`: the time of the job and of the step that runs the
  tests. Write down their median.
- Fill in the "before" values in "Measurements" above, each with the machine (model, CPU cores, memory) or the runner
  it was measured on.

### Test

- `npm run check` passes; only the step file changes, so this step is documentation only and runs no integration
  test, no end-to-end test and no build. Both suites have just passed in the measurement.
- Both local runs passed. A local run that fails stops the plan (see "When a step cannot be finished"), because the
  "before" time must be of a passing run.
- If `gh` cannot read the runs, the CI values stay open and the report of the step names them as a manual check for
  the user.

## Worker settings

### Goal

One pure module decides the number of workers and what belongs to each worker, so that the configuration, the global
setup and the helpers all take the same values from one place (R4, R9).

### Build

- `e2e/support/workers.ts`, without side effects and without imports of Playwright:
  - The number of workers from the environment: without `HIPPOWIKI_E2E_WORKERS` the default 4; otherwise the value must
    be one of the whole numbers 1 to 8, written as digits only. Every other value, the empty one included (such as `0`,
    `9`, `two`, `2.5`, ` 3`), throws an error that names the variable, the value and the allowed range 1 to 8 (R9).
  - Per worker, numbered from 1: the port (3100 for worker 1, then the next port each, up to 3107), the address of its
    server (`http://localhost:<port>`), the name of its database (`hippowiki_test_<n>`) and its build directory of the
    development server (`.next-e2e/worker-<n>`). The build directory of the production run is `.next-e2e/production`,
    shared by all workers.
  - The worker of the running process, from the `TEST_PARALLEL_INDEX` that Playwright sets in each worker process
    (counted from 0, so worker 1 has the index 0); undefined in the main process of Playwright.
- Unit tests next to it, `e2e/support/workers.test.ts`. The unit project of `vitest.config.ts` also includes
  `e2e/support/**/*.test.ts`. Both projects of `playwright.config.ts` match only their own files (`*.spec.ts` for
  `chromium`), so Playwright does not take the unit test for a spec. Where the lint rules of `e2e/` do not fit a Vitest
  test, the test file gets the rules of the unit tests in `eslint.config.mjs`.
- Nothing else uses the module yet.

### Test

- Unit tests of `e2e/support/workers.test.ts`:
  - Without the variable the number is 4; `1`, `4` and `8` give 1, 4 and 8.
  - `0`, `9`, `two`, `2.5`, `-1`, ` 3`, `3 ` and the empty value each throw an error whose message names
    `HIPPOWIKI_E2E_WORKERS`, the value and the range 1 to 8.
  - Worker 1 has the port 3100, the address `http://localhost:3100`, the database `hippowiki_test_1` and the build
    directory `.next-e2e/worker-1`; worker 8 has the port 3107.
  - The worker of the process is 1 for `TEST_PARALLEL_INDEX=0`, 3 for `2`, and undefined without the variable.
- The complete end-to-end suite runs, because `playwright.config.ts` changes (the `testMatch` of the projects); it still
  runs with one worker and finds the same number of tests as before.

## A database and a development server per worker

### Goal

`npm run test:e2e` runs with the number of workers of `HIPPOWIKI_E2E_WORKERS`, 4 by default, each worker against its
own database and its own development server, with one result and one report (R1, R3, R4, R6, R7, R9, R11, R12, R13).

### Build

- The test database container stays one container with the database `hippowiki_test`, which the integration tests use
  as they do today. The global setup of the end-to-end tests:
  - applies the migrations to `hippowiki_test`, stores one new random secret in `AuthSecret` there and resets it
    (`resetTestDatabase()`), as it resets the one database today;
  - creates the database of each worker as a copy of it (`CREATE DATABASE hippowiki_test_<n> TEMPLATE hippowiki_test`),
    so every worker database starts reset, with the schema and the same secret, and the saved logins are valid on every
    server. (Changed while building: the reset before the copy replaces a reset of each worker database, so the global
    setup, which runs in the main process, needs no helper that names a worker.)
- `e2e/support/database.ts`: `getTestDb()`, `testDatabaseUrl()` and `resetTestDatabase()` use the database of the
  worker of the process, and `hippowiki_test` outside a worker; `testDatabaseUrl()` also takes the name of a database,
  for the servers of `playwright.config.ts`. The check that the test database is never the database of `DATABASE_URL`
  holds for every worker database. `emptyTestDatabase()` refuses every database but `hippowiki_test` and the worker
  databases.
- `playwright.config.ts`:
  - reads the number of workers from `e2e/support/workers.ts` when it loads, so an invalid value stops the run before
    any server starts (R9);
  - `workers` is that number; `fullyParallel` stays `false`, so the spec files are spread over the workers and the
    tests of one file run in order in one worker;
  - `webServer` is a list with one development server per worker, on its port, with its build directory, the
    `DATABASE_URL` of its database and `HIPPOWIKI_PUBLIC_URL` of its address; `reuseExistingServer` stays `false`, so a
    taken port fails the run with the message of Playwright, which names it (R12);
  - the production run keeps one worker and one server in this step, whatever the variable says; the next step makes it
    parallel.
- `e2e/support/test.ts`: the `baseURL` of every test is the address of the server of its worker, from the
  `parallelIndex` of Playwright, so `page`, `request` and every browser context a test opens use the server of its
  worker. `ISSUER` of `e2e/support/oauth.ts` is the address of the server of the worker of the process, so the specs
  that build full addresses stay as they are.
- `e2e/auth.setup.ts` logs in at the server of its worker, as every test does; its sessions are put into every worker
  database by `resetTestDatabase()`, which every spec calls in `beforeEach`.
- `tsconfig.json`: `next dev` adds the two types directories of its build directory to `include` unless they are listed
  there exactly (`node_modules/next/dist/lib/typescript/writeConfigurationDefaults.js`). The entries of `.next-e2e` are
  replaced by the two entries of each of the eight worker directories and of `.next-e2e/production`, so that no run
  changes the file (R11). `.gitignore`, `.containerignore` and `eslint.config.mjs` ignore all of `.next-e2e/` already.
- The comments of `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/support/container.ts` and
  `e2e/support/database.ts` say that each worker has its own database and server.

### Test

- The complete end-to-end suite runs (`playwright.config.ts` and `e2e/support/` change), with the default of 4 workers,
  and passes; Playwright reports 4 workers and the spec files run at the same time (R1, R4).
- The complete suite with `HIPPOWIKI_E2E_WORKERS=1` passes, with one server on port 3100 and the tests one after another
  (R7).
- `npm run test:e2e -- e2e/smoke.spec.ts` starts 4 servers and passes (R6).
- Manual checks, done in this step:
  - `HIPPOWIKI_E2E_WORKERS` set to `0`, `9`, `two` and `2.5`: each run fails at once with the message of R9, and no
    server listens on 3100 to 3107 and no test database container exists afterwards (R9).
  - With a small server listening on port 3101 (`node -e` with `net.createServer().listen(3101)`), a run fails before
    any test and names the port 3101 (R12).
  - A parallel run with one test that fails on purpose (a throwaway spec file that is not committed) ends with a
    non-zero exit code and one HTML report with all tests (R3). After it and after a passing run, no server listens on
    the ports of the run and the test database container is gone (R13).
  - After the complete runs, `git status` shows no changed tracked file (R11).
- `npm run test:e2e:production -- e2e/smoke.spec.ts` still passes with one worker.

## A production run built once

### Goal

`npm run test:e2e:production` runs with the same number of workers, against one production build that is built once
(R2).

### Build

- `playwright.config.ts`: the production run gets one server per worker as well. Playwright starts the servers of the
  list one after another, each once the one before is ready, so the first one runs `next build` and then `next start`
  on port 3100, and every further one only `next start` on its port, with the same build directory
  `.next-e2e/production`. Each server gets the `DATABASE_URL` of its worker database and `HIPPOWIKI_PUBLIC_URL` of its
  address; the build itself needs no database, as today.
- The time to wait for a server stays long for the first one, which builds, and is the one of a started server for the
  others.
- If servers of `next start` cannot share one build directory, the step stops and the plan is updated before another
  way is built.

### Test

- The complete end-to-end suite runs with `npm run test:e2e:production`, with the default of 4 workers, and passes; the
  output shows one `next build` and 4 servers (R2).
- `npm run test:e2e:production -- e2e/smoke.spec.ts` with `HIPPOWIKI_E2E_WORKERS=1` passes with one server on port 3100.
- `npm run test:e2e -- e2e/smoke.spec.ts` still passes.
- After the runs, `git status` shows no changed tracked file (R11), and no server and no container is left (R13).

## Refuse more workers than servers

### Goal

A run in which `--workers` asks for more workers than `HIPPOWIKI_E2E_WORKERS` sets fails with a message that names the
variable, and fewer workers work (R10).

### Build

- `e2e/global-setup.ts` compares the number of workers of the run, which Playwright has resolved from the
  configuration and `--workers`, with the number of `HIPPOWIKI_E2E_WORKERS`. A larger number stops the run before any
  test with a message that the number of workers is set with `HIPPOWIKI_E2E_WORKERS`, not with `--workers`. The servers
  that have started by then are stopped by Playwright, and the container is removed as after every failed setup.
- As a second guard, the `baseURL` of `e2e/support/test.ts` fails with the same message when the worker of a test has no
  server.
- The message is built in `e2e/support/workers.ts`, with a unit test.

### Test

- A unit test of `e2e/support/workers.test.ts`: the check accepts as many and fewer workers than the variable sets and
  gives the message of R10 for more.
- Manual checks, done in this step:
  - `HIPPOWIKI_E2E_WORKERS=2 npm run test:e2e -- --workers=3` fails with that message; no server and no container is
    left (R10, R13).
  - `HIPPOWIKI_E2E_WORKERS=2 npm run test:e2e -- --workers=1 e2e/smoke.spec.ts` passes (R10).
- `npm run test:e2e -- e2e/smoke.spec.ts` passes.

## Three workers in CI

### Goal

Both end-to-end workflows run with 3 workers, and the documentation of the commands names the variable (R4).

### Build

- `.github/workflows/end_to_end_tests.yml` and `.github/workflows/end_to_end_tests_production.yml` set
  `HIPPOWIKI_E2E_WORKERS: 3` for the step that runs the tests, with a comment on why 3 and not the local 4: the runner
  has 4 CPU cores and 16 GB.
- `README.md`, "End-to-end tests": the servers on the ports 3100 to 3107, one per worker; `HIPPOWIKI_E2E_WORKERS` with
  its default 4, its range 1 to 8 and an example of one worker to debug a test, e.g.
  `HIPPOWIKI_E2E_WORKERS=1 npm run test:e2e:ui`; and that the number of workers is set with the variable, not with
  `--workers`.
- This is the stop point of session 1: after the commit of this step, push (see "Sessions"). The push starts both CI
  workflows with the parallel run.

### Test

- The complete end-to-end suite runs, once for the session (see "The complete end-to-end suite" in
  `spec/step-plan-workflow.md`), with `npm run test:e2e`, and passes.
- The workflows are valid YAML and set the variable only for the step of the tests; the check of the CI runs follows in
  the next session.

## Stability and the times after

### Goal

Both parallel runs are stable, locally and in CI, and the times after the change are written down (R5, R8, R11).

### Build

- Read the runs of the push of the stop point with `gh run list` and `gh run view`: both end-to-end workflows must have
  passed, with 3 workers in their output and no test that passed only on a retry (`failOnFlakyTests` fails such a run
  in CI). Write down the time of the job and of the step that runs the tests. If a workflow failed, the cause is fixed
  in this step, and the fix is named in its report; the CI check then follows after the push of the wrap-up and is left
  as a manual check for the user.
- Run the complete suite of `npm run test:e2e` three times in a row and then that of `npm run test:e2e:production`
  three times in a row, with the default number of workers, in the background with a long enough timeout. Each run must
  pass; a test that fails once is a flaky test, and the step follows "When a step cannot be finished" unless the cause
  is found and fixed, after which the three runs start again.
- Fill in the "after" values in "Measurements": for each local run the median of its three runs, on the same machine as
  the "before" values.
- In a fresh clone of the repository in a temporary directory, after `npm ci`, run `npm run test:e2e -- e2e/smoke.spec.ts`
  and then `npm run test:e2e:production -- e2e/smoke.spec.ts`; `git status` there shows no changed tracked file (R11).
  Delete the clone afterwards.

### Test

- Both CI workflows of the push are green with 3 workers, or the report names the fix and leaves the CI check to the
  user (R4, R8).
- Three passing complete runs in a row of each command locally (R8).
- After the runs, `git status` shows no changed tracked file, here and in the fresh clone (R11); no server listens on
  3100 to 3103 and the test database container is gone (R13).
- All values of "Measurements" are filled in (R5).
- When this step changes only the step file, it is documentation only and runs `npm run check`; the complete suite has
  just run six times. A fix of code runs the commands of "When a step is done" as well.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Extend `testing.md`, "End-to-end tests", as the feature spec of this feature: the workers, each with its own database
   (a copy of `hippowiki_test` with the same `AuthSecret`) and its own server on its port and build directory; the
   variable `HIPPOWIKI_E2E_WORKERS` with its default 4, its range 1 to 8 and that CI sets 3; that `--workers` cannot ask
   for more workers than the variable; that every run starts the servers of all workers, also for one spec; that a run
   with one worker behaves as before; the production run built once; that the setup project logs in once and every
   worker database gets the saved sessions; `ISSUER` as the address of the server of the worker; the times before and
   after from "Measurements"; and the decisions of the requirements file that still hold (workers instead of shards,
   both runs parallel, the fixed defaults, the name of the variable, an invalid value that stops the run, the variable
   instead of `--workers`, a taken port that fails the run, no changed tracked file and the entries of `tsconfig.json`).
   Replace "All tests share the test database and run one after another" and the port 3100 and `.next-e2e` of the
   section. "Continuous integration" names the variable of both end-to-end workflows. In `step-plan-workflow.md`, the
   time of the complete suite ("about five minutes") becomes the measured one; the rule that the end-to-end tests never
   run next to the integration tests stays.
2. Remove "Sharding the end-to-end tests" from `roadmap.md`: the item of "Tests and CI" and its section. Shards stay a
   rejected alternative in the decisions of `testing.md`.
3. Check that `README.md` has all the commands a developer needs, among them the variable of the workers and the debug
   run with one worker, and that its summary of the project covers the parallel end-to-end tests.
4. Delete this step file and `spec/parallel-end-to-end-tests-requirements.md`. The requirement IDs (R1 to R13) leave
   the comments of the code and the tests in the same step: each is replaced by the section of `testing.md` that holds
   the rule now, or dropped with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: remove this step file and the requirements file. The entry of `testing.md`
   stays, because its question does not change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass: the wrap-up changes only documentation,
  so `npm run check` runs; the complete suite has run in the step before.
- `grep -rn "R[0-9]\+" e2e playwright.config.ts` finds no requirement ID of this feature, and `grep -rn "parallel-end-to-end-tests"`
  in `spec/`, `README.md` and `CLAUDE.md` finds nothing.
