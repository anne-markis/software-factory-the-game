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
