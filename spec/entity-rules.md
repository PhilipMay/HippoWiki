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

## Deleting and Restoring Content

Who can do this is defined in [Auth Concept](auth-concept.md). Which response a deleted item gets is defined in [Deleted Items](request-checks.md#deleted-items).

- deleting a md_document, tab or folder sets its `deleted_at` and removes no row, so it can be restored (service)
- an item is live when it and all its parents have `deleted_at` null
- a tab or folder is deleted with its content: only its own row gets `deleted_at`, and the items in it are hidden through it (service)
  - there are no cascading writes, so restoring it brings back exactly what was visible before, and an item deleted earlier stays deleted
  - a create or move into a tab that is being deleted at the same time needs no lock: the item is hidden and comes back on restore
  - a deleted folder keeps its default tab, live but hidden
- a deleted name can be used again, because the unique names apply only to live rows
- restoring an item whose name is taken gets `NameConflictError`, and the live item has to be renamed or deleted first
- restoring an item whose parent is deleted is rejected, so the parent is restored first (service)
- writes use `WHERE deleted_at IS NULL` and a restore uses `WHERE deleted_at IS NOT NULL`, and a statement that changes no row gets `NotFoundError`, so a racing update or a second delete behaves correctly
- the rights on a deleted folder stay and apply again on restore, and changing them needs a restore first
- deleted content is never physically erased, see [Known Limitations](known-limitations.md#later)

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

## User Linking

The login method is defined in [Authentication](authentication.md#user-linking).

- creating a user requires `auth_subject`, and only the root admin is created without one (service)
- `auth_subject` has at most 255 characters
- an `auth_subject` of "" or one that is too long gets `DomainValidationError`, because the "" would otherwise hit the check constraint and become a 500
- an admin can change or remove `auth_subject` of another user, and removing it blocks that user on the next request (service)
- an admin changing their own `auth_subject` is rejected, because it could lock them out (service)
- changing `auth_subject` of the root admin through REST is rejected, because an admin could otherwise take over the root admin (service)
- a violated unique `auth_subject` is reported as `SubjectConflictError`

## Rights

The meaning of the rights is defined in [Auth Concept](auth-concept.md).

- a user with no row for a folder has no access to it, unless they are an admin, who has an [implicit `manage` right](auth-concept.md#admin-rights)
- rights are ordered: `read` < `write` < `manage`
- assigning a right replaces the existing row with `ON CONFLICT DO UPDATE SET access_right, assigned_by, assigned_at = now()`, so `assigned_by` and `assigned_at` describe the current assignment
  - the statement sets `assigned_at` itself, because `DEFAULT now()` does not fire on the update
  - delete and insert is not an alternative, because two concurrent first assignments would then hit the primary key
- deleting a right removes the row, and deleting a right that does not exist gets 404

## Deactivating and Deleting Users

- an admin can deactivate or delete another user, except for the root admin, and doing it to their own user is rejected, because it would lock them out (service)
- deactivating sets `deactivated_at`, and the credential check then rejects the user on the next request, see [Token Check](authentication.md#token-check)
  - the link and the rights stay, and apply again after reactivation
  - deactivating and reactivating are idempotent, and `deactivated_at` keeps its first value
  - a deactivated user can still get rights and a changed link from an admin
- deleting is final, and a deleted user can not be restored or reactivated (service)
  - in one transaction it sets `deleted_at`, clears `auth_subject` and removes the folder right rows of the user
  - the cleared `auth_subject` lets the same Keycloak account be linked to a new user
  - the name stays reserved, so the history stays unambiguous and the name gets `NameConflictError` for a new user
  - a user can be deleted without being deactivated first
- every other operation on a deleted user gets `NotFoundError`, also when the user is the target of a right (service)
- a deleted user stays in the list of all users, with both timestamps, so that an ID in the history can be turned into a name
- what a user did stays: their content stays attributed to them, and the rights they assigned stay in force
- a right assigned while its user is being deleted can leave a row behind. This is accepted, because the row has no effect, and the rights lists leave out rows of deleted users

## Root Admin

- system initialization creates the root admin, a user named `admin` with `is_root` and `is_admin` set to true
  - `hippowiki init` runs it, see [Deployment](deployment.md)
  - it is idempotent: an existing root admin is left alone, and a concurrent run is caught by the unique name
- system initialization leaves it unlinked, and `hippowiki link-root-admin` links it, see [Authentication](authentication.md#root-admin-credential)
  - it is idempotent: linking the same subject again changes nothing, and a subject that another user already has is rejected
- the root admin can never be deleted or deactivated, so these operations are rejected (service)
- the `is_admin` flag of the root admin can never be removed, so changing it is rejected (service)
- apart from that the root admin has the same rights as any other admin
- an admin changing their own `is_admin` flag is rejected (service)
- after system initialization at least one admin always exists, because the root admin always stays an admin
  - this also holds under concurrent transactions and needs no lock: admins who demote, deactivate or delete each other at the same time can not affect the root admin
  - before system initialization, and until an account is linked to the root admin, nobody can authenticate, so every request to a non-public route gets 401
