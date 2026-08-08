# Automation prompts

Cursor automations for this repo keep their **trigger prompt** minimal and
read the full instructions from version-controlled files here.

Update the markdown files in this directory when workflow policy changes;
then paste the matching stub into the automation's prompt field in Cursor.

| Automation | Agent | Prompt file | Automation stub |
| --- | --- | --- | --- |
| Prioritize Issues (PM triage) | — | [`issue-triage-prompt.md`](issue-triage-prompt.md) | `read and follow scripts/issue-triage-prompt.md` |
| Issue Fixer — Bugs | Patrice | [`issue-fixer-bugs-prompt.md`](issue-fixer-bugs-prompt.md) | `read and follow scripts/issue-fixer-bugs-prompt.md` |
| Issue Fixer — Improvements | Loopy | [`issue-fixer-enhancements-prompt.md`](issue-fixer-enhancements-prompt.md) | `read and follow scripts/issue-fixer-enhancements-prompt.md` |

The stub should be the **entire** automation prompt — no duplicate policy
inline in Cursor.

**Kanban:** Issue fixers pick work from
[project board #1](https://github.com/users/anne-markis/projects/1)
(Ready → In progress on claim; In progress → In review when the
non-draft PR is posted). Triage fills Ready; it does not move cards into
In progress / In review.

**UX verification:** Both issue fixers run an optional Subagent D (UX
Verifier) only when the change is Visual (player-facing UI). Visual PRs
must include screenshots in the description.
