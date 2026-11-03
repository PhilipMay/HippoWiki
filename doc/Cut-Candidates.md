## Cut Candidates

The factual basis of each was checked, but whether to cut is your call. The first three need no product decision and I
would take them. The others are product decisions.

- **Time input rules:** no request field or tool argument takes a time, and the only list filter is `tab_id`, so the 422
  cases in Time Cases can only run at type level. Cutting saves the strict parser and its pin tests, and possibly
  PyYAML, which only `tests/test_time_libraries.py` uses. Nothing is lost today.
- **Detail out of proportion:** the AppArmor and Ubuntu bug text in `testing.md`, and the SDK line numbers in
  `implementation-notes.md`, which go stale on an upgrade. Test names would serve better.
- **Components section** of `configuration-and-failure-modes.md`: it mostly restates other documents. Keep "Values That
  Must Match" and the risks. A per-component checklist is lost.
- **Root form of the protected resource metadata:** the 401 already names the path form, so this saves one public route.
  Check first whether MCP clients fall back to the root form when the header is absent.
- **Full rights matrix on MCP:** run one allowed and one denied call per tool instead, plus the mapping of each domain
  error. This saves most of a second copy of the matrix, but a tool calling the wrong method in an unusual cell goes
  unnoticed.
- **Folder revert:** no goal names revert, only "Full **revision history**". This is the largest saving: the route, the
  `folder_revert` kind, name swap handling and about six hard test cases. One-step undo of an agent's bulk damage is
  lost, but revisions keep recording, so it can be added later.
- **Tabs beyond the default tab:** `goals.md` gives no reason for them. This saves seven routes, seven of 18 tools, and
  the rules for items hidden through a deleted tab. Keep the table and `tab_id`, so adding tabs later needs no data
  migration. Grouping inside a folder is lost.
- **Fakes and the contract suite:** only if the rule that `make test` needs no Podman changes, which I would not do.
