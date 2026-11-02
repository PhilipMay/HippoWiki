# History and Revisions

- changes (move, rename, added content, delete, add) on folders, tabs and md_documents must be tracked and visible by the user
- changes are tracked (visualized) on two layers:
  - per md_document
  - per folder
- in the changes view on md_document it must be possible to revert to a previous status of the md_document
- in the changes view on folder it must be possible to revert to a previous status of the whole folder
  - a folder rename can never be reverted
- these reverts are only accessable on REST API - not via MCP
- a user needs the manage right on the folder do revert anything
