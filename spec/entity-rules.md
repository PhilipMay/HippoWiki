# Entity Rules

These rules add to the constraints in [Tables and Entities](entities.md). Table constraints can not express the rules marked (service), so the service layer enforces them. The responses to rejected operations are defined in [Rejected Operations](request-checks.md#rejected-operations).

## Folders, Tabs and MD Documents

- a folder always has exactly one default tab
  - creating a folder also creates its default tab in the same transaction, named "" (empty string) (service)
  - the default tab can not be deleted or renamed (service)
  - `is_default` of a tab never changes after creation (service)
- a tab can not be moved to another folder, so `folder_id` of a tab never changes (service)
- a new md_document without an explicit tab is assigned to the default tab of its folder (service)
- a md_document can only be moved to a tab in the same folder (service)

## Names

- every name is required, and only the default tab has the name "" (empty string)
- folders, md_documents and users: `^[a-z0-9]+(-[a-z0-9]+)*$`, so lowercase ASCII words joined by single hyphens, with at most 100 characters
  - this also rules out a user who looks like the root admin, such as `Admin` or a name with a lookalike character
- tabs: at most 100 characters, no control characters and no leading or trailing whitespace, so a name of only spaces is not valid
- a name that breaks these rules gets `DomainValidationError`, see [Request Checks](request-checks.md#validation)
- a create or rename request with the name "" gets `DomainValidationError`, for every entity, because PostgreSQL runs check constraints before unique indexes and a check violation would otherwise become a 500
- the name `admin` for a new user gets `NameConflictError`, because the root admin exists whenever someone can authenticate
  - this is a fixed rule for the same reason, not an up-front duplicate check, so it does not conflict with the [layer rules](architecture.md#layer-rules)
- a violated unique name is reported as `NameConflictError`
- users can not be renamed, which keeps the root admin in place, and `is_root` of a user never changes after creation (service)

## Rights

The meaning of the rights is defined in [Auth Concept](auth-concept.md).

- a user with no row for a folder has no access to it, unless they are an admin, who has an [implicit `manage` right](auth-concept.md#admin-rights)
- rights are ordered: `read` < `write` < `manage`
- assigning a right replaces the existing row with `ON CONFLICT DO UPDATE SET access_right, assigned_by, assigned_at = now()`, so `assigned_by` and `assigned_at` describe the current assignment
  - the statement sets `assigned_at` itself, because `DEFAULT now()` does not fire on the update
  - delete and insert is not an alternative, because two concurrent first assignments would then hit the primary key
- deleting a right removes the row, and deleting a right that does not exist gets 404

## Root Admin

- system initialization creates the root admin, a user named `admin` with `is_root` and `is_admin` set to true
  - `hippowiki init` runs it, see [Deployment](deployment.md)
  - it is idempotent: an existing root admin is left alone, and a concurrent run is caught by the unique name
- the root admin can never be deleted or deactivated, so these operations are rejected once they exist (service)
- the `is_admin` flag of the root admin can never be removed, so changing it is rejected (service)
- apart from that the root admin has the same rights as any other admin
- an admin changing their own `is_admin` flag is rejected (service)
- after system initialization at least one admin always exists, because the root admin always stays an admin
  - this also holds under concurrent transactions and needs no lock: admins who demote each other at the same time can not affect the root admin
  - before system initialization nobody can authenticate, so every request to a non-public route gets 401
