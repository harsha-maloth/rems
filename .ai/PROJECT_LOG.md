# ClubOrbit: project context and log for AI assistants

> Temporary working file. It exists so a new AI session can pick up without being told the history.
> **To remove it at the end:** delete the `.ai/` folder and `CLAUDE.md`, and the `--exclude '.ai'` / `--exclude 'CLAUDE.md'` lines in `.github/workflows/pages.yml`.
> Never put secrets in this file (no service_role key, SMTP password, or real student data).

## 1. What this project is
ClubOrbit is an open-source club management tool by IIST-OSS (Indian Institute of Space Science and Technology). Static front end on GitHub Pages (plain HTML/CSS/JS, Bootstrap 4 + jQuery + FontAwesome 5, **no build step**) and a Supabase back end (Postgres + RLS, Auth, Storage, one Edge Function). Forked from REMS-For-Organisations, so internal names still say `REMS` (`window.REMS`, `REMS_CONFIG`, `rems.*` storage keys).

Original features (platform "Phase 0"): public certificate search, registration forms, in-browser certificate generation, mailing lists + bulk mail (Edge Function `send-bulk-mail`, SMTP), short links (`/s/NAME` via `404.html`), activity log, DB manager.

## 2. The goal
Turn it from a single-admin tool into a multi-club platform: the unit is the **student** and the **club**; what someone can do depends on their **position in a club**, not a global `is_admin` flag. One login, four portals (student, club, university, platform). Full plan: `ClubOrbit_Platform_Plan.html` (kept by the owner outside the repo; summary below).

### Platform phases (from the plan)
| # | Scope | Exit test | State |
|---|---|---|---|
| 0 | Current tools, rebrand | n/a | Done |
| 1 | Multi-club foundation: clubs, teams, positions, memberships, position_terms, audit_log, `has_perm`, `club_id` on existing tables, rewritten policies, club switcher | Club A user cannot read/edit/mail anything of Club B (two clubs, two accounts) | **Done** (see log) |
| 2 | Student identity and portal: institute-email sign-up, admitted-list import and claim, profile, club directory, my clubs, my certificates | New student claims account, completes profile, sees all their certificates, no admin help | **Done** (see log) |
| 3 | Club portal and hierarchy: position editor, role templates, appoint/handover/end terms, teams, member list | President creates wing lead; wing lead sees only their wing; handover in one step | **Built; SQL verified live, UI checks pending** |
| 4 | Intake and recruitment: club-defined forms, rounds, scoring, shortlist, offers, auto mail | One club runs a 100-applicant drive and exports scored list | Planned |
| 5 | Events, attendance, tasks: event lifecycle, QR attendance, certificates to present, tasks, announcements | Event end to end: register, attend, certificate in student portal | Planned |
| 6 | University portal: club proposals/approval, shared calendar with clashes, cross-club reports | Student affairs approves a club and sees all activity on one page | Planned |
| 7 | Transcript, leaving, alumni: signed verifiable PDF transcript, resignation/graduation flows, retention rules | Graduate downloads transcript, becomes alumnus, loses club-private access | Planned |
| 8 | Hardening: privacy review, export/deletion, backup restore drill, accessibility, phone layout, load test | Restore works; independent reviewer cannot read another club's data | Planned |

### Open decisions (from the plan, still unanswered unless noted in the log)
**Answered 2026-10-04:** scope = IIST only; sign-in = institute email + password; the institute supplies the admitted list (a university admin imports it). Still open: hierarchy depth (fixed vs any), approvals (institute approves events/budgets or only views), pilot clubs, hosting (GitHub Pages+Supabase vs institute servers).

### Known risks
DPDP Act 2023 for student data; access rules must always go through `has_perm` + RLS; Supabase free-tier limits; few maintainers; institute buy-in; do not build everything at once (finish a phase for a real club first).

## 3. Repo map
- `*.html` pages at root; shared runtime `js/app.js` (Supabase client, `requireAuth`, club state, sidebar/topbar injection); per-page logic in `js/pages/*.js`; config in `js/config.js` (anon key is public by design).
- `supabase/migrations/000N_*.sql`: numbered, **never edit an old one**, add a new file. `supabase/functions/send-bulk-mail/index.ts`. `supabase/tests/phase1_two_clubs.sql` (club isolation) and `phase2_students.sql` (student identity): both must end with `ALL CHECKS PASSED`.
- Student pages: `signup.html` (claim account), `student.html` (student portal), `university-students.html` (import and browse the admitted list); scripts in `js/pages/`.
- Deploy: `.github/workflows/pages.yml` publishes everything except `.git`, `.github`, `supabase`, `.ai`, `CLAUDE.md`.
- Docs: `README.md`, `docs/deploy-your-own-club.md`, `CONTRIBUTING.md`, `SECURITY.md`.

## 4. Architecture rules (keep following these)
1. All access control = `public.has_perm(club_id, 'permission')` (club-wide) or `has_team_perm` (team scope), called from RLS. Pages only hide UI; the database is the real gate.
2. `profiles.is_admin` = **platform admin only**. It does not grant club data.
3. Any new club-owned table gets `club_id not null`, an index, RLS using `has_perm`, and a check added to `supabase/tests/phase1_two_clubs.sql`.
4. Functions: revoke execute from public/anon/authenticated, then grant only what is needed. Use `security definer set search_path = ''`. Use `errcode '42501'` for denials.
5. Public pages use only anon-safe columns (certificate `email` is column-revoked from anon and authenticated).
6. Event names, form slugs, short-link slugs stay globally unique (public links identify them by text).
7. Certificate storage paths are `<club_id>/<event-slug>/<run-id>/Certificate-N.png` and `<club_id>/_templates/...`.
8. No build step, no secrets in the repo.
9. Account creation is gated in the database (`signup_gate` on `auth.users`): an e-mail must be on the `students` list (unclaimed, status applicant/student) or in `signup_invites`. Staff must be invited with `invite_staff()` before being created in the dashboard. Keep "Confirm email" ON.
10. `students` is written only by `import_students()` (university admin) and read by the owner of the row or a university admin. Platform admins do not read it. Certificate lookup by e-mail goes through `my_certificates()` only.
11. The institute e-mail domain lives in `app_settings` (`institute_email_domain`, default `iist.ac.in`, an assumption: confirm it).

## 5. How to test
- Database (both test files, in order): need Postgres 16. Create stub roles `anon`/`authenticated`, `auth.users`, `auth.uid()`, `storage.buckets/objects` (see how the Phase 1 session did it: a stubs SQL file), apply migrations 0001 to latest, then run `supabase/tests/phase1_two_clubs.sql`; it must end with `ALL CHECKS PASSED`. On real Supabase just run the test in the SQL Editor (it rolls back).
- Front end: serve with `python3 -m http.server 8000`; Playwright + Chromium were used with a mocked `supabase` object to check switcher, nav filtering, guards and `club_id` scoping.
- Mutation-check new tests: break a policy on purpose and confirm the test fails.

## 6. Log (newest last; append every session)
Format: `### YYYY-MM-DD: title`, then what was asked, what changed (files), how it was verified, what is left / known gaps, decisions made.

### 2026-10-04: Orientation
- Owner uploaded the platform plan (HTML) and the repo zip and asked the AI to read everything. No changes made.
- Findings noted: `email_for_username()` is callable by anyone (leaks username→email); `handle_new_user` makes a profile for every auth user (must change in Phase 2); `form_responses` public insert has no club link except via form; legacy Bootstrap/jQuery UI still in place; owner's separate UX plan (phases U0 to U5) was not in the upload.

### 2026-10-04: Platform Phase 1, multi-club foundation (v3.1.0)
- **Added** `supabase/migrations/0005_multi_club_foundation.sql`: `permissions` catalogue (15 keys), `clubs`, `teams`, `positions`, `memberships`, `position_terms`, `audit_log` (append-only trigger); functions `has_perm`, `has_team_perm`, `is_member`, `my_clubs`, `create_club`, `appoint_president`, `audit_trigger`, `storage_club`; `club_id` (not null) on events, certificates, forms, mailing_lists, short_links, notification; starting club "Main club" (slug `main`) receives all old data, all profiles become members, current admins get President; all policies rewritten; `dashboard_stats(p_club)` and `recent_alerts(max_rows, p_club)` replace the global versions; storage policies check the `<club_id>/` folder; certificate `email` revoked from `authenticated` too; mailing list names unique per club.
- **Added** `supabase/tests/phase1_two_clubs.sql` (2 clubs, 6 accounts incl. expired officer, team-scoped wing lead, platform admin, anon).
- **Front end:** `js/app.js` now has `REMS.clubs/club/can()/clubId()/selectClub()/loadClubs()`, `requireAuth({perm})`, club switcher, permission-filtered sidebar (stored choice in `localStorage['orbit.club']`). Pages scoped to the club: dashboard, cert-generate, forms-generator, forms-registrations, mailing-list, mailing-bulk, link-short; db-manage is platform-admin only and hides certificate `email`. `send-bulk-mail` Edge Function now requires `mail.send` via `has_perm` for `club_id` and checks the list belongs to that club.
- **Docs:** README (new "Clubs and permissions" section, platform status table), deploy guide, CONTRIBUTING; `APP_VERSION` 3.1.0.
- **Verified:** migrations 0001 to 0005 apply on Postgres 16; isolation test passes; two deliberate breakages (open policy, club-blind `has_perm`) make it fail; upgrade path with legacy data checked; Chromium smoke test with mocked Supabase (switcher, nav, redirects, scoped queries).
- **Not verified:** against the real Supabase project; the changed Edge Function was never executed (only reviewed); real file upload to new storage paths.
- **Known gaps / follow-ups:** `logs.js` still uses `is_admin` for the "Everyone" switch and the `logging` table is not club-scoped; `profiles` stay visible only to self/platform admin (club member list UI is Phase 3); `positions`, `position_terms`, `memberships` for non-presidents are SQL-only until Phase 3; old certificate template files must be re-uploaded per club; `email_for_username` leak still open; the `REMS` naming rename not done.
- **Owner must do to deploy:** run 0005, redeploy `send-bulk-mail`, run the test in the SQL Editor.

### 2026-10-04: Added this log and CLAUDE.md
- Owner asked for the history to live in the repo so future sessions need no briefing, and for it to be updated automatically. Added `.ai/PROJECT_LOG.md` and `CLAUDE.md` (standing rule: read the log first, update it after every task). Excluded both from the Pages deploy.

### 2026-10-04: Phase 1 confirmed on the real Supabase project
- Owner reported that `supabase/tests/phase1_two_clubs.sql` succeeded on the live Supabase project, so migration 0005 is applied there. (Owner's wording was "test got as success"; the exact `ALL CHECKS PASSED` line was not pasted.)
- Code state on GitHub: `main` already contained all Phase 1 files (the repo's single "Initial commit" e414ad5). PR #2 (`add-ai-project-log`) adds only `.ai/PROJECT_LOG.md`, `CLAUDE.md` and the Pages-deploy exclusions.
- Still unconfirmed: `send-bulk-mail` redeployed with the new `club_id`/`has_perm` check; a real certificate upload to the new `<club_id>/` storage paths; a real login showing the club switcher.
- Next: Phase 2 (student identity and portal). Needs owner answers on: sign-in method (institute email+password vs Google), who supplies the admitted student list, single institute vs multi-institute.

### 2026-10-04: Phase 1 manual checks passed
- Owner confirmed on the live site: club switcher and permission-filtered menu work, `send-bulk-mail` redeployed and test mail works, certificate generation works with the new `<club_id>/` storage paths. Phase 1 is fully verified; the "unconfirmed" items above are closed.
- Next: Phase 2 (student identity and portal), pending owner answers on sign-in method, student list source, single vs multi-institute.

### 2026-10-04: Platform Phase 2, student identity and portal (v3.2.0)
- **Owner decisions:** institute email + password sign-in; the institute will supply the admitted list; IIST only. The email domain `iist.ac.in` is my assumption (not stated by the owner): confirm and change `app_settings` if wrong.
- **Added** `supabase/migrations/0006_student_identity.sql`: `app_settings`, `institute_domain()`, `university_admins` (+ `is_university_admin`, `add_university_admin`, audited), `students` (validated by trigger, read-only to clients), `signup_invites` + `invite_staff()`, `signup_gate` trigger on `auth.users`, `handle_new_user` now links the profile to the student row (status applicant becomes student), `can_claim(email)` (anon, yes/no), `import_students(jsonb)` (university admin, max 1000 rows per call, per-row errors, one audit row), `my_certificates()`, `club_directory()`, `complete_my_profile()`.
- **Added** `supabase/tests/phase2_students.sql`; updated `phase1_two_clubs.sql` to invite its accounts first.
- **Front end:** `signup.html`/`signup.js`, `student.html`/`student.js`, `university-students.html`/`university-students.js`, `assets/Sample_students.csv`; `app.js` gets `REMS.univ`, `requireAuth({univ:true})`, "Student portal" and "University" sidebar entries; club-less students are redirected from the dashboard to the student portal; login placeholder and sign-up link updated; README/deploy docs; `APP_VERSION` 3.2.0.
- **Verified:** migrations 0001 to 0006 apply on Postgres 16; both test files pass; four deliberate breakages of the phase 2 rules (gate removed, students readable by all, my_certificates unscoped, import open to everyone) were each caught; Chromium smoke test with a mocked Supabase (sign-up validation and messages, student portal, club-less redirect, university import with a semicolon-separated CSV, rejected rows, search filter, XSS-style cell content stays text, non-university admin redirected).
- **Not verified:** the real Supabase (0006 not yet run by the owner); a real sign-up with a real confirmation e-mail and the redirect to `login.html`; the Supabase setting that public sign-ups be ON while the gate holds on the hosted `auth.users` (hosted Supabase allows the trigger, but confirm by trying an unlisted e-mail).
- **Known gaps / risks:** (1) `can_claim` tells an anonymous caller whether an institute e-mail is on the admitted list (needed for good error messages; low risk, no rate limit). (2) Pre-hijack: someone can start a sign-up with a classmate's e-mail; Confirm-email ON limits it, and the real owner signing up again replaces the password. (3) `email_for_username` still public. (4) Gate means dashboard "Add user" fails for non-invited e-mails (documented). (5) No automatic status changes yet (alumni/withdrawn is Phase 7); no student self-service for institute data. (6) Students cannot apply to clubs yet (Phase 4); the portal says so.
- **Owner must do to deploy:** run 0006; run both test files; in Supabase Authentication turn ON "Allow new users to sign up", keep Confirm email ON, add the `login.html` URL to Redirect URLs; make a university admin: `select public.add_university_admin('<email of an existing account>');`; confirm the email domain.

### 2026-10-04: Phase 2 deployed and verified on the real Supabase project
- Owner ran `0006_student_identity.sql` on the live project (chose "Run without RLS" in the dashboard prompt, since the script enables RLS itself on its four tables), then both test files, and completed the live checklist: sign-up settings, redirect URL, university admin, email domain, CSV import, sign-up with a listed e-mail, rejection of an unlisted e-mail, club-less redirect, public certificate search. Owner reported "done"; exact output was not pasted.
- **Security finding on the live DB:** `phase1_two_clubs.sql` failed at "anon reads certificate e-mails". The live `certificates.email` column was still SELECT-able by `anon` (0002's revoke had evidently not taken effect there). Fixed by hand in the SQL Editor: `revoke select on public.certificates from public, anon, authenticated;` then re-granted the column list `(id, name, regno, dept, year, section, position, cert_link, event_name, college, club_id)` to `anon, authenticated`. Re-check showed no anon/authenticated SELECT on `email`. This fix is NOT in a migration file; a fresh deploy gets it from 0002 + 0005, but a future migration could repeat it idempotently.
- Not changed: `anon` still holds INSERT/UPDATE column grants from Supabase defaults; RLS blocks the writes and the Phase 1 test checks this.
- Phase 2 is now complete. Next: Phase 3 (club portal and hierarchy). Open decisions still unanswered: hierarchy depth, approvals, pilot clubs, hosting.

### 2026-10-04: Phase 3 verified on the live site
- Owner completed the live checklist on the deployed site (sidebar entry, positions list, teams, appointing a Vice President and a Wing Lead, wing lead scoped to their team, handover of a low position, existing tools and club switcher unaffected) and reported "done". Individual results were not pasted.
- Phase 3 is complete. Next: Phase 4 (intake and recruitment: club-defined forms, rounds, scoring, shortlist, offers, auto mail). Exit test: one club runs a 100-applicant drive and exports a scored list.
- Open decisions still unanswered: approvals (does the institute approve events and budgets or only view them), pilot clubs, hosting.
