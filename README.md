<p align="center"><img src="assets/img/logo.png" alt="ClubOrbit" width="320"></p>

# ClubOrbit

> **This project is discontinued.** Version 1.0.0 is the final release. There will be no new features, no bug fixes, no security updates and no replies to issues or pull requests. You may fork it and carry on under the MIT license. See [Project status](#project-status-discontinued) below.

ClubOrbit is a free tool for student clubs. It handles event sign-up forms, certificates, bulk e-mail and short links. Many clubs can share one copy, and each club only sees its own data.

The pages are plain HTML, CSS and JavaScript hosted on GitHub Pages. The data lives in a free Supabase project. There is no server to run and nothing to build.

Made by the IIST Open Source Society (IIST-OSS). It started from [REMS-For-Organisations](https://github.com/bearlike/REMS-For-Organisations) and keeps its MIT license.

Live site: https://iist-oss.github.io/club-orbit/

## Project status: discontinued

The IIST Open Source Society has stopped working on ClubOrbit. Version 1.0.0 is the last version.

**What this means**
- No new features will be added.
- Bugs will not be fixed, and security problems will not be patched. Security reports may not get an answer.
- Issues and pull requests will not be read.
- The repository will be archived, so it will be read-only.
- The live site may stop working at any time. Supabase can pause a free project that is not used, and the site depends on it.

**What still works**
- The code, the database scripts and the tests are complete. Version 1.0.0 passed its own tests when it was released.
- You can run your own copy by following [docs/deploy-your-own-club.md](docs/deploy-your-own-club.md).
- You can change the code in any way you like. The license is MIT.

**If you want to use it**
- Fork the repository and run your own copy. You become responsible for it, including the student data it holds.
- Read the [Known limits](#known-limits) before you use it with real students.
- Check the libraries it loads (jQuery, Bootstrap, FontAwesome, supabase-js). They are old and will not be updated here.

**If a club already uses the live site**
- Download your data now: registrations (CSV on the registrations page), contact lists (CSV on the contact lists page) and anything else you need.
- Certificates are pictures in the `certificates` storage bucket. Download them if you need them.
- Plan to move to your own copy or another tool.

**If you run a copy and want to shut it down**
1. Export the data you need to keep.
2. Delete the Supabase project. This removes all student data from it.
3. Delete or archive the GitHub Pages site and the repository.

## What it does

**Public pages (no login)**
- Search certificates by event name, and see all events.
- Fill in a registration form from a link a club shares.
- Open a short link such as `/s/NAME`.

**Club members (login)**
- Make registration forms and download the answers as a CSV file.
- Make certificates from a CSV list, drawn in your browser.
- Keep contact lists and send e-mail to them.
- Make short links and see how many times each was opened.
- Manage members, teams and positions (president, vice president, wing lead and so on).
- Post announcements to everyone in the club.

**Students (login)**
- Claim an account with an institute e-mail address that is on the admitted list.
- See their own record, their clubs and every certificate issued to their e-mail.

**Platform admins and university admins**
- Platform admins create clubs and can open the database manager.
- University admins import the admitted-student list.

## How access works

What a person can do depends on their position in a club, not on one global switch.

- Every rule is checked in the database by the function `has_perm(club_id, 'permission')`. The web pages only hide buttons; the database is what actually blocks access.
- A position is a title with a level and a list of permissions. Level 1 is the top.
- You can only appoint or change positions below your own level, and you can only give permissions you hold yourself.
- A position tied to one team (a wing lead) works only inside that team.
- A club can never be left without a president, except by a platform admin.
- Handing over a position is one step. The new person is appointed first, then the old term ends.
- Every change is written to a log that cannot be edited.
- Event names, form names and short-link names are unique across all clubs, because public links use only that text.
- Certificate e-mail addresses cannot be read by visitors or by signed-in accounts.

## Set it up

You need a GitHub account and a free Supabase account. The full steps are in [docs/deploy-your-own-club.md](docs/deploy-your-own-club.md).

In short:
1. Fork this repository.
2. Create a Supabase project. Run the files in `supabase/migrations/` in number order, from `0001` to `0008`.
3. In Supabase, go to Authentication and turn on "Allow new users to sign up" and "Confirm email". This is safe because the database only lets in students on the admitted list and staff you invited.
4. Put your project URL and anon key in `js/config.js`. Never put the `service_role` key anywhere in the repository.
5. Turn on GitHub Pages with the source set to GitHub Actions, then push to `main`.
6. Add the first admin and the first president (see the deploy guide).

## Main tasks

**Create a club and its first president** (run in the SQL Editor):
```sql
select public.create_club('Robotics Club', 'robotics', 'We build robots.');
select public.appoint_president(1, 'president@example.com');
```
Use the club id returned by the first command in place of `1`.

**Import the admitted list.** A university admin opens `university-students.html` and uploads a CSV with these columns: `institute_email, enrolment_no, full_name, department, programme, batch`. There is a sample in `assets/Sample_students.csv`. Importing sends no e-mail. Importing again updates people already on the list.

**Add a university admin:** `select public.add_university_admin('person@example.com');`

**Add a staff account.** The sign-up gate covers every new account, so first run `select public.invite_staff('person@example.com');`, then add the user in Authentication, Users, Add user.

**Change the institute e-mail domain** (the default is `iist.ac.in`):
```sql
update public.app_settings set value = 'example.ac.in' where key = 'institute_email_domain';
```

**Change the limits.** These values are in the `app_settings` table:
- `form_hourly_cap`: most answers one form accepts per hour (default 300).
- `form_daily_cap`: most answers one form accepts per day (default 2000).
- `mail_daily_cap`: most e-mails one club can send per day (default 300).

## Pages

| Page | Who can use it |
|---|---|
| `index.html`, `cds-public.html` | Everyone. Certificate search and event list. |
| `register.html?form=SLUG` | Everyone. A registration form. |
| `signup.html`, `login.html` | Students and staff. People sign in with their e-mail address. |
| `student.html` | Students. Record, clubs, certificates, club directory. |
| `dashboard.html` | Club members. Overview and shortcuts. |
| `club.html` | Club officers. Members, positions and teams. |
| `forms-generator.html`, `forms-registrations.html` | Form managers. Make forms and read the answers. |
| `cert-generate.html` | Certificate issuers. Make and manage certificates. |
| `mailing-list.html`, `mailing-bulk.html` | Mail senders. Contact lists and bulk e-mail. |
| `link-short.html` | Link managers. Short links. |
| `logs.html`, `profile.html` | Any member. Own activity and own profile. |
| `university-students.html` | University admins. Import and browse the admitted list. |
| `db-manage.html` | Platform admins. Browse and edit tables. |

## Notes on each tool

**Registration forms.** The share link is `register.html?form=SLUG`. The slug comes from the event name. If you name a form exactly like its event, the dashboard counts its sign-ups. Answers are saved as JSON. Team forms add the participant number to each field name (`name1`, `email1`, `name2`). CSV downloads put a `'` in front of cells that start with `=`, `+`, `-` or `@`, so spreadsheets do not run them as formulas. Deleting a form deletes its answers, so download the CSV first.

**Certificates.** Upload a CSV with `name` and `email` columns. These columns are optional: `regno, dept, year, section, position, college`. There is a sample in `assets/Sample_headers.csv`. Up to 1000 rows can be done in one go. Your browser draws each certificate, uploads the picture to the public `certificates` storage bucket and saves one row per person. Keep the browser tab open until the progress bar finishes. Making certificates for an event again replaces the old ones. Certificate pictures are public: anyone with the link can open them. You can upload your own template (PNG, JPG or WebP, up to 10 MB, A4 landscape). Without one, a plain built-in design is used. The font is Raleway (SIL Open Font License, see `assets/fonts/raleway/OFL.txt`).

**Bulk e-mail.** Sending e-mail needs a server, so the mailer uses a Supabase Edge Function named `send-bulk-mail`.
1. In Supabase, go to Edge Functions and create a function named `send-bulk-mail`. Paste in `supabase/functions/send-bulk-mail/index.ts` and deploy it. Leave "Verify JWT" on.
2. Under Edge Functions, Secrets, add `SMTP_HOST`, `SMTP_PORT` (465 or 587), `SMTP_USER`, `SMTP_PASS` and, if you like, `SMTP_FROM`. For Gmail, use an App password, not your normal password. The password stays in Supabase and is never in the repository or the browser.
3. The browser sends the e-mail in batches of 10. The function checks the caller's permission, reads the list itself and sends through your SMTP account. A test e-mail always goes to the person who asked for it.
4. Each club can send up to 300 e-mails a day. If the limit is reached, sending stops and the page says how far it got.
5. If a batch fails, sending stops and does not retry. The page shows which addresses were done, and you can download the failed ones as a CSV.

**Short links.** A link like `/s/NAME` opens `404.html`, which looks up the target and redirects. Only `http` and `https` targets are followed. In `404.html`, the value of `REPO` must match your repository name.

## Tests

The tests are SQL files in `supabase/tests/`. Each one runs inside a transaction, adds its own test data and rolls everything back at the end. Run each in the Supabase SQL Editor. A test stops with a message that starts with `FAIL` if something is wrong, and ends with `ALL CHECKS PASSED` if everything is fine.

| File | What it checks |
|---|---|
| `phase1_two_clubs.sql` | One club cannot read or change another club's data. Visitors see only public data. Form and mail limits work. |
| `phase2_students.sql` | The admitted list, account claiming and what students can see. |
| `phase3_hierarchy.sql` | Position levels, appointments, handovers and team limits. |

Run all three after any change to the database.

## Security notes

- Row Level Security is the only real protection. Every table has it turned on.
- Keep "Allow new users to sign up" and "Confirm email" both on. The database check on new accounts is what keeps strangers out.
- The anon key in `js/config.js` is meant to be public. The `service_role` key and the SMTP password must never be put in the repository.
- Report a security problem privately. See [SECURITY.md](SECURITY.md).

## Known limits

- The activity log is not split by club. Platform admins can see everyone's entries.
- Anyone can find out whether an institute e-mail is on the admitted list. This is how the sign-up page can give clear messages. There is no CAPTCHA.
- The libraries (jQuery, Bootstrap, FontAwesome, supabase-js) load from public CDNs. Their versions are not all locked and they have no integrity hashes.
- The old name `REMS` still appears inside the code (`window.REMS`, `REMS_CONFIG`). It was not renamed.
- Many admin pages build HTML in the browser. The public pages were checked for injection. The admin pages were only spot-checked.
- Supabase free projects can pause when unused and have no managed backups. Export your data now and then.
- The system holds student data. If you run it, you need a privacy notice and you should delete data you no longer need. India's DPDP Act 2023 applies.

## Not built

These ideas were planned. Because the project is discontinued, they will not be built: recruitment rounds and scoring, events and attendance, a university approval portal, transcripts and alumni, and a full privacy review.

## Optional settings in `js/config.js`

`CONTACT_EMAIL` shows a contact link on the thank-you page. `DEPARTMENTS` replaces the department list on registration forms. `MAIL_BUTTON_LABEL`, `MAIL_BUTTON_URL`, `MAIL_LOGO_URL` and `MAIL_COVER_URL` pre-fill the bulk mailer.

## Versions

**1.0.0** is the final release, and the project is discontinued. It adds e-mail-only login, limits on form answers and bulk mail, and a database script (`0008`) that makes the certificate e-mail privacy fix permanent. Earlier work added the multi-club base, student accounts and the club portal.

## License

MIT. See [LICENSE](LICENSE).
