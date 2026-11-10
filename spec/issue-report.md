# How to Report Issues in a Code Review

## The building blocks of an issue report

Every issue you report should answer these questions. Write them in this order.

| Heading | Question it answers | Tip |
| --- | --- | --- |
| Title | What is the problem, in one line? | Name the problem, not the fix. |
| Location | Where exactly is it? | File, line range, function. |
| Severity | How urgent is it? | Use the fixed scale below. |
| Category | What kind of problem is it? | Correctness, security, performance, readability, error handling, tests, docs, style. |
| Problem | What does the code or document do or say now, and why is that wrong? | Facts first, opinion last. |
| Impact | What can go wrong because of it? | Who is affected and when. This convinces the author the issue is real. |
| Evidence | How can I see it? | An input that fails, a test, a log line, a short code excerpt. |
| Suggestion | How could it be fixed? | Concrete, ideally with a snippet. Say if it is required or optional. |
| Reference | Where can I read more? | Optional: coding guideline, docs, OWASP, a related ticket. |

If you can't fill in Impact, ask yourself whether the issue really matters. If you're unsure, it may be a question rather than an issue.

## Severity levels

Use the same four levels every time, so the author knows what must be fixed before merging and what can wait.

| Level | Meaning | Blocks the merge? | Typical examples |
| --- | --- | --- | --- |
| Blocker | Must be fixed before merging | Yes | Bug that gives wrong results, security hole, data loss, crash |
| Major | Should be fixed; real risk if left | Usually | Missing error handling, missing tests for core logic, clear performance problem |
| Minor | Worth improving | No | Unclear naming, duplicated code, a missing comment on tricky logic |
| Nit | Personal taste or tiny style point | No | Formatting, word choice, ordering of imports |

When in doubt, pick the lower level and explain your reasoning. Overrating everything as a blocker makes real blockers easy to miss.

## Tips and common mistakes

**Do:**

- **One issue per report.** Each one can then be discussed, fixed and closed on its own.
- **Label your comments** so the author knows what you expect: `issue:`, `suggestion:`, `question:`, `nit:`. This convention is called Conventional Comments.
- **Group repeated problems.** If the same mistake appears in ten places, write one report and list all locations.
- **Ask when you're unsure.** A question is better than a wrong claim.
- **Mention what is good**, too. It tells the author what to keep doing.
- **Start the review with a short summary:** the overall verdict, number of blockers vs. minor issues.

**Avoid:**

- Vague comments like "this is wrong" or "clean this up" with no reason.
- Personal language like "you always" or "why would you do this?". Talk about the code: "this function" instead of "your function".
- Marking taste or style preferences as blockers.
- Rewriting the author's whole solution in a comment. Suggest a direction; let them implement it.
- Reporting what tools already catch (linters, formatters). Fix the tool configuration instead.

## Checklist before you submit the review

- [ ] Every issue has a title, location and severity
- [ ] Every Blocker and Major issue explains its impact
- [ ] Claims are backed by evidence or phrased as questions
- [ ] Each issue has a concrete suggestion, marked as required or optional
- [ ] Repeated problems are grouped into one report
