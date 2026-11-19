# Why the PR format is what it is

The reader is one maintainer deciding fast whether to merge. Each section answers one question
they would otherwise have to dig for, and has a limit so it stays a sentence or two.

| Section | Limit | The question it answers |
|---|---|---|
| What | 280 | What does this change, in one sentence? (If it needs "and", it is two PRs.) |
| Why | 280 | What problem does it solve, and where was it agreed (`Closes #N`)? |
| How | 500 | Where do I look in the diff, and is the approach sane? |
| Risk | 200 | What could break, and how do I undo it? Decides how carefully to read. |
| Measurement | 500 | Only in measured repos: does it really improve things? Numbers before and after. |
| Evidence | 300 + media | How was it checked, and how can I check it in a minute? Screenshots. |
| Checklist | - | The repository's own non-negotiables, ticked honestly. |

What is left out on purpose: summaries, "testing done" essays, screenshots of terminal output
(paste the number instead), and anything the diff already shows.
