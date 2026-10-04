# Instructions for AI assistants working on ClubOrbit

1. **Before doing anything, read `.ai/PROJECT_LOG.md`.** It holds the goal, the phase plan, the architecture rules, how to test, and what has already been done. Do not ask the owner to re-explain history that is written there.
2. **After every task (code change, migration, decision, or finding), append an entry to section 6 of `.ai/PROJECT_LOG.md` before replying.** Include: what was asked, files changed, how it was verified, what was NOT verified, open follow-ups, and any decision the owner made. Update the phase table state and the "Known gaps" if they changed. This is part of finishing the task, not optional.
3. Add the update to your task list as the last item every time ("Update .ai/PROJECT_LOG.md").
4. Follow the architecture rules in section 4 of the log (all access through `has_perm` + RLS, new numbered migration for every schema change, tests updated, no secrets, no build step).
5. Never write secrets or real student data into the log.
6. The `.ai/` folder and this file are temporary and will be deleted by the owner at the end of the project.
