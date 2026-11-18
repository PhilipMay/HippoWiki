# How to Report Issues in a Code Review

## The building blocks of an issue report

Every issue you report should answer these questions. Write them in this order.

| Heading      | Question it answers                                                  | Tip                                                                                    |
| ------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Title        | What is the problem, in one line?                                    | Name the problem, not the fix.                                                         |
| Location     | Where exactly is it?                                                 | File, line range, function.                                                            |
| Severity     | How urgent is it?                                                    | Use the fixed scale below.                                                             |
| Category     | What kind of problem is it?                                          | Correctness, security, performance, readability, error handling, tests, docs, style.   |
| Problem      | What does the code or document do or say now, and why is that wrong? | Facts first, opinion last.                                                             |
| Impact       | What can go wrong because of it?                                     | Who is affected and when. This convinces the author the issue is real.                 |
| Evidence     | How can I see it?                                                    | An input that fails, a test, a log line, a short code excerpt.                         |
| Suggestion   | How could it be fixed?                                               | Concrete, ideally with a snippet. Say if it is required or optional.                   |
| Confidence   | How sure is the reviewer that the suggestion is right?               | High, Medium or Low from the scale below, with a one-line reason.                      |
| Alternatives | What other fixes are possible?                                       | Optional: only if there are several reasonable solutions. Name the trade-offs briefly. |
| Reference    | Where can I read more?                                               | Optional: coding guideline, docs, OWASP, a related ticket.                             |

If you can't fill in Impact, ask yourself whether the issue really matters. If you're unsure, it may be a question rather than an issue.

## Severity levels

Use the same four levels every time, so the author knows what must be fixed before merging and what can wait.

| Level   | Meaning                            | Blocks the merge? | Typical examples                                                                |
| ------- | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| Blocker | Must be fixed before merging       | Yes               | Bug that gives wrong results, security hole, data loss, crash                   |
| Major   | Should be fixed; real risk if left | Usually           | Missing error handling, missing tests for core logic, clear performance problem |
| Minor   | Worth improving                    | No                | Unclear naming, duplicated code, a missing comment on tricky logic              |
| Nit     | Personal taste or tiny style point | No                | Formatting, word choice, ordering of imports                                    |

When in doubt, pick the lower level and explain your reasoning. Overrating everything as a blocker makes real blockers easy to miss.

## Confidence levels

The confidence says how sure the reviewer is that the problem is real and that the suggested fix removes it completely,
without side effects. It decides who acts next: a sure fix is made directly, an unsure one is reviewed by the user
first. Severity says how urgent an issue is; confidence says how much the suggestion can be trusted. The two are
independent: a Blocker can have a Low confidence, a Nit a High one.

| Level  | Meaning                                                                    | What happens next                                                      | Typical examples                                                                                                          |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| High   | The fix is clear and was checked                                           | Fixed as the suggestion describes, without asking the user             | A wrong header value, a check missing next to identical ones, a stale reference in a spec                                 |
| Medium | The fix is probably right, but rests on something unchecked or a trade-off | The user reviews the suggestion; then it is fixed, as is or as changed | Behaviour of a library or browser read in its docs but not tried, a change users see, a fix with a reasonable alternative |
| Low    | The fix needs a decision, or could not be shown to work                    | The user decides before anything is changed                            | A product or design choice, accepting a risk, several fixes with real trade-offs                                          |

A suggestion is High only when all of these hold:

- The problem is backed by evidence: the cited lines, an input that fails, a test or a log line.
- There is one reasonable fix, so the issue has no Alternatives.
- The fix changes no behaviour that a spec decision, a user or a standard sets on purpose, and needs no product
  decision.
- Every place the fix touches is named, and the effect on the code around it was checked.
- A test or check shows that the fix works: an existing one, or one the suggestion names.

Rules:

- When in doubt, pick the lower level and say why.
- An issue with Alternatives is at most Medium.
- The reason names what was checked for High, and what is still uncertain for Medium and Low.
- A `question:` has no confidence. If the problem itself is uncertain, report it as a question, not as a Low issue.
- Required or optional says whether something must be fixed; the confidence says whether the fix needs the user's
  review. An optional suggestion with High confidence stays optional.
- Write the confidence on its own line after the suggestion, for example:
  `- Confidence: High. One fix, no behaviour change, the test of the headers covers it.`

## Tips and common mistakes

Do:

- One issue per report. Each one can then be discussed, fixed and closed on its own.
- Label your comments so the author knows what you expect: `issue:`, `suggestion:`, `question:`, `nit:`. This convention is called Conventional Comments.
- Group repeated problems. If the same mistake appears in ten places, write one report and list all locations.
- Ask when you're unsure. A question is better than a wrong claim.
- Mention what is good, too. It tells the author what to keep doing.
- Start the review with a short summary: the overall verdict, number of blockers vs. minor issues, and how many
  suggestions are High, Medium and Low.

Avoid:

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
- [ ] Each suggestion has a confidence level with a one-line reason, and High only where all its criteria hold
- [ ] Repeated problems are grouped into one report
- [ ] Every spec that restates code, a constant or a message instead of pointing to it is reported
