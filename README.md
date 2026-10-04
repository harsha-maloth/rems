<p align="center"><img src="assets/img/logo.png" alt="ClubOrbit" width="320"></p>

# ClubOrbit

**One orbit for everything your club does.**

ClubOrbit is a free, open-source management system for student clubs: certificates, event registration
forms, bulk mail and a link shortener. The front end is static (**GitHub Pages**) and the back end is
**Supabase**, so a club can run its own copy without paying for a server.

An [IIST Open Source Society](https://github.com/iist-oss) (IIST-OSS) project.

**Live site:** https://iist-oss.github.io/club-orbit/  |  **Run your own copy:** [docs/deploy-your-own-club.md](docs/deploy-your-own-club.md)

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Supabase schema, RLS, RPCs, storage bucket | Done |
| 2 | Static shell: theme, nav, dark mode, login, password reset, dashboard | Done |
| 3 | Public CDS pages (home, certificate search, register, congrats, errors) | Done |
| 4 | Profile, activity log, DB manager | Done |
| 5 | Form generator, registrations, CSV export | Done |
| 6 | Certificate generator (Canvas) | Done |
| 7 | Mailing lists, bulk mailer (Edge Function + SMTP), link shortener | Done |
| 8 | Rebrand to ClubOrbit (name, logo, footer, docs) | Done |

The numbers above are the original build phases. The [platform plan](#clubs-and-permissions-platform-phase-1) (clubs, students, portals) has its own phases:

| Platform phase | Scope | State |
|---|---|---|
| 1 | Multi-club foundation: clubs, positions, `has_perm`, club-scoped data and policies, club switcher | Done |
| 2 | Student identity and portal: admitted list, account claim, student portal | Done |
| 3 to 8 | Club portal and hierarchy, intake, events, university portal, transcript, hardening | Planned |

## Clubs and permissions (platform phase 1)

Run `supabase/migrations/0005_multi_club_foundation.sql` once (after 0001 to 0004). From then on **what a person can do is decided by their position in a club**, not by one global switch.

- **Tables:** `clubs`, `teams`, `positions` (title, parent, permission list, scope), `memberships`, `position_terms` (who held which position from when to when) and an append-only `audit_log`.
- **One access function:** `has_perm(club_id, 'permission')`. Every Row Level Security policy calls it. The permission catalogue is the `permissions` table (`mail.send`, `certificate.issue`, `form.manage`, `link.manage`, `event.create`, `announcement.post`, `audit.view`, and more).
- **Club-scoped data:** `events`, `certificates`, `forms`, `mailing_lists`, `short_links` and `notification` now have a `club_id`. Public pages (certificate search, registration forms, `/s/NAME`) still work without signing in.
- **Starting club:** the migration creates **Main club**, moves all existing data into it, makes every existing account a member, and gives every current admin the President position there. Rename it in the `clubs` table.
- **`is_admin` now means platform admin.** It no longer reads club data by itself. A platform admin creates clubs and positions, and can open the DB manager (which still obeys Row Level Security).
- **Club switcher:** the top bar shows the club you are working in; people in several clubs get a dropdown. The menu only shows tools the club's permissions allow.
- **Certificate files** are stored under `<club_id>/...` in the `certificates` bucket. Files uploaded before the migration keep their old paths; only a platform admin can change those, and custom templates must be uploaded again once.
- **Event names, form slugs and short-link names stay unique across all clubs**, because the public links identify them by that text alone.
- **Certificate e-mail addresses** are no longer readable by signed-in accounts either (only by the generator that wrote them), so a student account can never list them.

Create a club and its first president (SQL Editor, as platform admin or owner):

```sql
select public.create_club('Robotics Club', 'robotics', 'We build robots.');   -- returns the new club id
select public.appoint_president(<that id>, 'president@example.com');
```

Appointing other positions, term handovers and the position editor arrive in platform phase 3. Until then add `positions`, `position_terms` and `memberships` rows with SQL.

**Test it:** `supabase/tests/phase1_two_clubs.sql` creates two clubs and six accounts inside a transaction, tries to read and change Club B as Club A's president (and as a plain member, an expired officer, a platform admin and an anonymous visitor), and rolls back. Run it in the SQL Editor after any change to policies. It stops with a message starting `FAIL` if anything leaks, and ends with `ALL CHECKS PASSED` otherwise.

## Students and the student portal (platform phase 2)

Run `supabase/migrations/0006_student_identity.sql` once (after 0001 to 0005).

- **The admitted list.** The institute gives a CSV (`institute_email, enrolment_no, full_name, department, programme, batch`). A **university admin** imports it on `university-students.html` (sample: `assets/Sample_students.csv`). Importing sends no e-mail. Re-importing updates people already on the list.
- **Claiming an account.** A student opens `signup.html`, enters their institute e-mail and a password, and confirms the link Supabase e-mails them. The database only creates the account if that e-mail is on the list and unclaimed (a gate on `auth.users`), so strangers cannot sign up even though public sign-ups must be switched ON. The new account is linked to the student's row and the status becomes `student`.
- **The institute domain** is a setting. The default is `iist.ac.in`; change it with `update public.app_settings set value = 'example.ac.in' where key = 'institute_email_domain';`
- **Student portal** (`student.html`): the institute record, a getting-started checklist, "my clubs and positions", the club directory and **my certificates** (every certificate issued to the student's e-mail across all clubs, found through `my_certificates()`; the e-mail column itself stays unreadable). Students with no club land here after login.
- **Roles.** `university_admins` is separate from platform admins. A platform admin can add one (`select public.add_university_admin('person@example.com');`) but cannot read the student list unless they are one. Both actions are audited.
- **Staff accounts.** Because the gate covers every new account, create staff in *Authentication -> Users -> Add user* only after `select public.invite_staff('person@example.com');`. Existing accounts are unaffected.
- **Privacy.** Students can read only their own row; nobody edits the table directly (the import function is the only writer); `can_claim()` answers only yes or no. Collect only what the portal needs (DPDP Act 2023): keep the list to the columns above.

**Supabase settings to change for this phase** (Authentication): turn **ON** "Allow new users to sign up", keep **Confirm email ON**, and add `https://YOUR-USER.github.io/YOUR-REPO/login.html` to Redirect URLs.

**Test it:** `supabase/tests/phase2_students.sql` imports a list, claims accounts, and checks that students, outsiders, platform admins and anonymous visitors see exactly what they should. Run it after Phase 1's test; both must end with `ALL CHECKS PASSED`.

## Public pages (Phase 3)

| Page | URL | Notes |
|---|---|---|
| Certificate search | `index.html` | Looks the event up (case-insensitive), then opens the results |
| Event list | `cds-public.html?mode=1` | All events, newest first |
| Certificates | `cds-public.html?event=NAME` | Name search, pagination; the e-mail column is never requested |
| Registration form | `register.html?form=SLUG` | Share this link for an event; the slug comes from the `forms` table |
| Thank-you / errors | `congrats.html`, `bad-request.html`, `404.html` | `404.html` has a `REPO` constant: keep it equal to the repository name |

Registration answers are stored in `form_responses.data` as JSON. Individual form: `{"name": "...", "email": "..."}`.
Team form: the participant number is appended to each field label (`name1`, `email1`, `name2`, ...).

Optional `js/config.js` keys: `CONTACT_EMAIL` (shows a contact link on the thank-you page) and
`DEPARTMENTS` (array that replaces the department list in the registration form).

Run `supabase/migrations/0002_hide_certificate_emails.sql` once so the database itself refuses to give
certificate e-mail addresses to anonymous visitors. `supabase/sample-data.sql` adds test rows (with cleanup).

## Members pages (Phase 4)

| Page | URL | Who | Notes |
|---|---|---|---|
| Profile | `profile.html` | any member | Name, address, phone, signature, picture. Picture is resized to 256x256 JPEG in the browser and stored as a data URL in `profiles.imgsrc`. Username and e-mail are read-only (the database refuses changes from non-admins). |
| Activity log | `logs.html` | any member | Your own entries, newest first, paginated. Admins get an "Everyone" switch. |
| DB manager | `db-manage.html` | admins | Browse, add, edit, delete rows of any `public` table via the Supabase API; every change is written to the activity log. `profiles` is edit-only (add or remove members in Authentication -> Users), and its e-mail column is locked so it always matches the sign-in account. |

Run `supabase/migrations/0003_admin_list_columns.sql` once so the DB manager can read column names and types.

## Event forms (Phase 5)

| Page | URL | Who | Notes |
|---|---|---|---|
| Form generator | `forms-generator.html` | admins | Create a form (individual or team of 2-10, preset and custom fields), copy its share link, delete forms. |
| Registrations | `forms-registrations.html?form=SLUG` | admins | Browse answers, delete spam rows, **Download CSV** (all rows, not just the visible page). |

No new SQL is needed: Phase 5 uses the `forms` and `form_responses` tables and policies from `0001_init.sql`.

- The share link is `register.html?form=SLUG`. The slug is made from the event name (lowercase, other characters become `_`).
- Name the form exactly like the event it belongs to and the dashboard's "Registrations for (latest event)" counter picks it up.
- Custom field labels are lowercased, spaces become `_`, and they must start with a letter.
- CSV cells that begin with `=`, `+`, `-` or `@` get a leading `'` so spreadsheets never run public input as a formula.
- Deleting a form also deletes its registrations (download the CSV first).

## Certificates (Phase 6)

| Page | URL | Who | Notes |
|---|---|---|---|
| Certificate generator | `cert-generate.html` | admins | Upload a CSV, name the event, pick intra/inter-college, **Preview**, then **Generate certificates**. Also manages the templates and lists/deletes generated events. |

How it works: the browser draws each certificate on a canvas (same text positions as the original Pillow code), uploads the PNG to the
public `certificates` storage bucket and saves one row per person in `certificates` (plus the event in `events`). The public pages
(`cds-public.html`) then list them. No new SQL is needed: the bucket, tables and admin-only policies are already in `0001_init.sql`.

- **CSV columns:** `name` and `email` are required headers; `regno, dept, year, section, position, college` are optional. A sample is at `assets/Sample_headers.csv`. Comma, semicolon and tab separated files all work; at most 1000 rows per batch.
- **Intra-college:** name, event, "Conducted by" (editable, defaults to `ORG_NAME`) and date. Always uses the Participation template.
- **Inter-college:** "of COLLEGE for participating in EVENT ..." wrapped over up to 4 lines (the text shrinks instead of being cut off). Position `Winner` or `Runner` (also `Runner-up`) uses that template; anything else uses Participation.
- **Templates:** until you upload your own, a plain built-in design is used. Upload one image per kind (PNG/JPG/WebP, up to 10 MB, A4 landscape, ideally 3507 x 2481) in the *Certificate Templates* card; they are saved in the bucket under `_templates/` and shared by all admins. Keep the middle of the page empty: text starts about 40% down on the left. The **Layout** box moves, widens and recolours the text for other designs, and the preview updates live.
- **Regenerating** an event replaces its old certificates. Each run writes to a new folder (`<event-slug>/<run-id>/`), so browsers never show a stale image; old files are removed after the new ones are saved. If anything fails or you press **Stop**, nothing is saved and the uploaded files are removed.
- Generating is done by your browser: drawing takes about a tenth of a second per certificate, the upload over your connection is the slow part, and the tab must stay open until the progress bar finishes. Each PNG is about 300 KB, so even a few hundred certificates fit comfortably in the Supabase free tier (1 GB storage).
- The Raleway font files in `assets/fonts/raleway/` are used for drawing (SIL Open Font License, `OFL.txt` included).
- Certificate images are public by design (anyone with the link can open them, like on the original CDS). Only admins can upload, replace or delete them.

## Mail and short links (Phase 7)

| Page | URL | Who | Notes |
|---|---|---|---|
| Update Mailing List | `mailing-list.html` | admins | Upload a CSV (`name`, `email`) to create a list or add people to an existing one (same name). Browse, add or remove people, download a list as CSV, delete a list. Duplicate and malformed addresses are skipped. |
| Bulk Mailer | `mailing-bulk.html` | admins | Pick a list, write subject, title and message, optional button, logo and cover image. Live preview, **Send a test to me**, then **Send to the list** with a progress bar and a Stop button. |
| Link Shortener | `link-short.html` | admins | Shorten a link with an optional custom name. Lists all links with click counts; delete any. |
| Short link | `/s/NAME` | everyone | Opens through `404.html`, which asks Supabase for the target and redirects. Only `http(s)` targets are followed. |

**One-time setup**

1. SQL Editor: run `supabase/migrations/0004_mail_and_short_links.sql` (creates `short_links` and `resolve_short_link()`, and stops duplicate addresses inside a list).
2. Sending e-mail needs a server, so Bulk Mailer uses an **Edge Function**. In the Supabase Dashboard go to *Edge Functions -> Deploy a new function -> Via Editor*, name it exactly `send-bulk-mail`, paste `supabase/functions/send-bulk-mail/index.ts` and deploy. Leave *Verify JWT* on.
   (With the CLI instead: `supabase functions deploy send-bulk-mail`.)
3. *Edge Functions -> Secrets*, add:

   | Secret | Example |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `465` (SSL, default) or `587` (STARTTLS) |
   | `SMTP_USER` | `club@gmail.com` |
   | `SMTP_PASS` | a Gmail **App password** (needs 2-step verification), not your normal password |
   | `SMTP_FROM` | optional, e.g. `IIST Clubs <club@gmail.com>` |

   The SMTP password lives only in Supabase. It is never in this repository or in the browser.
4. Optional `js/config.js` keys that pre-fill the Bulk Mailer: `MAIL_BUTTON_LABEL`, `MAIL_BUTTON_URL`, `MAIL_LOGO_URL`, `MAIL_COVER_URL`.

**How sending works and its limits**

- The browser builds the e-mail (HTML plus plain-text copy) and calls the function in batches of 10. The function checks that the caller is a signed-in admin, reads that slice of the list itself, and sends through your SMTP account. The browser never sends addresses, so the function cannot be used to mail arbitrary people. A test mail always goes to the signed-in admin's own address.
- Gmail allows roughly 500 messages a day (personal accounts). Larger lists need a bigger SMTP provider; only the secrets change.
- Keep the tab open until the bar reaches 100%. If a batch errors, sending stops without retrying (a timed-out batch may be half sent) and the page tells you which addresses were handled. Failed addresses can be downloaded as CSV.
- Message text is plain: a blank line starts a paragraph and web addresses become links. HTML typed into the message is shown as text, not run (the original inserted it raw).
- Every send is written to the activity log.

**Short links**

- `https://YOUR-USER.github.io/YOUR-REPO/s/NAME`. Names are 3-40 letters, digits, `-` or `_` (capitals matter). Without a custom name you get 6 random characters.
- Visitors can only ask for one link at a time (`resolve_short_link`); the table itself cannot be listed by the public. Each visit adds one to the click count.
- It relies on GitHub Pages serving `404.html` for unknown paths, so it works on the default `github.io` address and on custom domains served by Pages. The `REPO` constant in `404.html` must equal the repository name (project sites).
- The first load of a short link shows "Taking you there..." for a moment while the lookup runs.

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor** -> run `supabase/migrations/0001_init.sql`, then `0002` to `0006` in order (see `docs/deploy-your-own-club.md`).
3. **Authentication -> Sign In / Providers -> Email**: keep "Allow new users to sign up" **off** until `0006` is applied.
   After that you turn it **on**: the database then only accepts admitted students and invited staff.
4. **Authentication -> URL Configuration**: set *Site URL* to your Pages URL and add
   `https://YOUR-USER.github.io/YOUR-REPO/change-password.html` to *Redirect URLs*.
5. In the SQL Editor run `select public.invite_staff('you@example.com');`, then **Authentication -> Users -> Add user** (email + password, tick "Auto confirm").
6. Make yourself platform admin and president of the starting club (SQL Editor):
   ```sql
   update public.profiles
   set is_admin = true, login_name = 'admin'
   where email = 'you@example.com';
   select public.appoint_president((select id from public.clubs where slug = 'main'), 'you@example.com');
   ```

### 2. Front end
1. Edit `js/config.js`: paste the **Project URL** and **anon public** key
   (Project Settings -> API). Never use the `service_role` key here.
2. Replace `assets/img/Logo_White.png`, `Logo_Banner_White.png` and `front/image2.png`
   with your own artwork (ClubOrbit's logo files are already in place).
3. Push to GitHub, then **Settings -> Pages -> Source: GitHub Actions**.
   Every push to `main` redeploys.

### Local preview
```bash
python3 -m http.server 8000   # then open http://localhost:8000/login.html
```
Add `http://localhost:8000/change-password.html` to the Supabase redirect URLs to test password reset.

## Security notes

- **Row Level Security is the only protection.** All tables have RLS on; club data is gated by `public.has_perm(club_id, permission)` and platform tools by `public.is_admin()`.
- **Username login** uses `email_for_username()`, callable by anyone, so a known username can be resolved to its email.
  If that matters, delete the RPC and the lookup in `js/pages/login.js` to make login email-only.
- **Public form submissions** are open to anonymous users by design (same as the original). Add a CAPTCHA or rate limit if you see spam.
- Forgot-password shows one message whether or not the account exists (the original revealed it).

## License
MIT. See `LICENSE`.

Originally based on [REMS-For-Organisations](https://github.com/bearlike/REMS-For-Organisations) (MIT).
