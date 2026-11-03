# Lists

These rules apply to every paged list on [REST](rest.md).

## Paging

- Lists take `limit` and `cursor` as query parameters. The range of `limit` is in
  [Limits](limits.md#limits-at-a-glance).
- A list returns `{"items": [...], "next_cursor": "..."}`, and `next_cursor` is null on the last page.
  - It has no total, so nothing has to count.
  - The repository reads `limit + 1` rows, so a null `next_cursor` is certain and a full last page is not followed by an
    empty one.
- Lists never return `content_md`, so the size of a page depends only on the number of rows. A page of 100 summaries is
  roughly 25 kB.
- The cursor is opaque for clients. It is base64url of the sort key of the last row, such as `["some-name", "<uuid>"]`.
  - A cursor that can not be decoded or has the wrong shape gets a schema validation error, which depends only on the
    request and so [leaks nothing](request-checks.md#validation).
  - It is not signed, because it only says where to continue. The rights still filter every row, and the row it names
    need not exist any more.
- Hidden and deleted rows are left out by the query itself, so a page is full unless it is the last one.
- There is no snapshot across pages, because each page is its own [unit of work](architecture.md#transactions). A rename
  during paging can show a row twice or not at all, which is accepted.

## List Order

The order is fixed, and a client can not choose it:

| List                                                | Order                      |
| --------------------------------------------------- | -------------------------- |
| folders, tabs, md_documents and their deleted lists | `name`, `id`               |
| users                                               | `name`, `id`               |
| own rights                                          | folder `name`, folder `id` |
| rights of a folder                                  | `user_id`                  |
| all rights                                          | `user_id`, `folder_id`     |
| revisions of a md_document                          | `version`, newest first    |
| folder history                                      | `number`, newest first     |
| changed items of an entry                           | `type`, `id`               |

The ID is the [tie-breaker](time.md#rules): names repeat among deleted rows and across the tabs of a folder.
