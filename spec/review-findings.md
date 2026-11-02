# Review Findings

Open findings from the review of all documents in this folder. The High and Medium findings are fixed and no longer listed.
Topics already listed in [Known Limitations](known-limitations.md) are left out, unless the finding is a contradiction
that the listed topic does not cover. References are `file:line`.

## Low

Smaller inaccuracies and wording.

- `time.md:27` says asyncpg returns aware UTC datetimes, and `time.md:19-20` calls a naive `datetime` a bug. The test
  `test_infinity_is_returned_naive` in `tests/test_time_asyncpg.py:70` pins an exception: `infinity` comes back naive. State
  that `infinity` is not used, or how it is handled.
- `auth-concept.md:39` says all users can see their own full rights, while the rights of an admin are implicit
  (`entities.md:114-116`). It is undefined whether an admin sees `update` on all folders, the stored rows without effect, or
  both.
- `goals.md:13` calls PostgreSQL the only infrastructure dependency, while `deployment.md:10` requires a reverse proxy for
  remote MCP connectors.
- Some parts have no user in the specs: title extraction in `architecture.md:90`, since md_documents have no title column,
  and split and join of frontmatter in `architecture.md:91`, since `time.md:39` keeps frontmatter verbatim in `content_md`.
  "placeholder resolution" in `architecture.md:94` is not explained.
- The session manager of the MCP SDK may need to run in the lifespan of the parent app, because Starlette does not run the
  lifespan of mounted apps. `architecture.md:67` only names the DB engine. This was not checked against the SDK 2.x.
- Terminology:
  - `md_document` in `entities.md` against `document` in `architecture.md:78`, `architecture.md:85`, `architecture.md:133`
  - "disabled" in `auth-concept.md:8` against "deactivated" in `entities.md:120`
  - the `write` right "can update the content" (`auth-concept.md:26`), but the `update` right is the one for renaming and
    moving (`auth-concept.md:28-33`), which invites mistakes
- Spelling: "contraints" (`known-limitations.md:5`), "plannning" (`known-limitations.md:13`), "seperately"
  (`known-limitations.md:37`), "an other" (`auth-concept.md:40-41`).

## Checked Without Findings

- The table constraints do what `entities.md` claims, including the NOT NULL that the check on `is_default` relies on, the
  root admin rules and the index coverage. `RIGHT` is a reserved word in PostgreSQL.
- All links between the documents resolve.
- The Pydantic, PyYAML, asyncpg and `now()` claims in `time.md` match what the tests in `tests/` assert. The tests were
  read, not run, for this review.
- `testing.md` matches the Makefile and the two CI workflows. The dev dependencies in `architecture.md:60` match
  `pyproject.toml`.
- The `mcp` SDK has 2.x releases on PyPI (latest 2.3.0). The `MCPServer` API name itself was not checked.
