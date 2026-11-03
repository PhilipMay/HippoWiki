# Rights

This document defines who can do what in a folder. Accounts and the admin are in [Users](users.md).

## General Rules

- rights are assigned per folder, not per tab or md_document
- a user with no right on a folder has no access to it
- rights are ordered, `read` < `write` < `manage`, and each right includes the lower ones
- the system has exactly one [admin](users.md#admin), who has no access to content, see
  [Admin Operations](users.md#admin-operations)
- an AI agent acts as the account it logged in with and has no rights of its own, see
  [AI Agents](connectors.md#ai-agents)
- the admin can connect only through REST, and history and revert exist only on REST, for every right, see
  [MCP](mcp.md#admin-account)
- no leaks: services must filter by the current user everywhere, so an unreadable md_document never leaks through a
  list, and later through a search snippet

## Rights on Folders

A user with no right on the folder gets 404 for every row, and lists leave the folder out.

| Operation in a folder                                                                   | `read` | `write` | `manage` |
| --------------------------------------------------------------------------------------- | ------ | ------- | -------- |
| See the folder (ID and name) and find it in the folder list                             | yes    | yes     | yes      |
| Read its tabs and md_documents                                                          | yes    | yes     | yes      |
| Read the folder history, with metadata only for tabs and md_documents that are not live | yes    | yes     | yes      |
| Read the history of a live md_document and the content of its revisions                 | yes    | yes     | yes      |
| Add a md_document to a tab                                                              | 403    | yes     | yes      |
| Update the content of a md_document                                                     | 403    | yes     | yes      |
| Add a tab                                                                               | 403    | yes     | yes      |
| Rename a tab or a md_document                                                           | 403    | 403     | yes      |
| Move a md_document to another tab                                                       | 403    | 403     | yes      |
| Delete a md_document or a tab, except for the default tab                               | 403    | 403     | yes      |
| List deleted md_documents and tabs, and restore them                                    | 403    | 403     | yes      |
| Read the history of a md_document that is not live and the content of its revisions     | 403    | 403     | yes      |
| Revert a md_document or a folder                                                        | 403    | 403     | yes      |

- The current right applies to all revisions, also to those from before the user got it.
- The content and the history of a deleted folder can not be read with any right, so the folder has to be restored
  first.
- The admin holds no right.

## Combined Updates

One [update of a md_document](rest.md#md-document-routes) can change its content, name and tab together:

- with only `content_md` present it needs `write`
- with `name` or `tab_id` present it needs `manage`, also when the value would not change, because the right check comes
  before the item is read, see [Check Order](request-checks.md#check-order) (service)

## Assigning and Listing Rights

- assigning a right replaces the existing row, so `assigned_by` and `assigned_at` describe the current assignment
- deleting a right removes the row
- all users can see their own rights with the folder name
  - this list is always empty for the admin
  - deleted folders are left out
  - each entry has the folder and the right only
- the rights of a folder and all rights of all folders show the rows that the admin assigns and deletes. Rows on deleted
  folders are left out
