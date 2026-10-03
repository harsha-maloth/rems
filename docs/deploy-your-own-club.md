# Deploy your own club

Any IIST club can run its own ClubOrbit. You need a GitHub account and a free Supabase account. No server, no cost.

1. **Fork** this repository (or use it as a template) under your club's GitHub account.
2. **Create a Supabase project** at supabase.com. Use a club account, not a personal one, and add a second maintainer.
3. **Run the database setup.** In the Supabase SQL Editor run, in order:
   `supabase/migrations/0001_init.sql`, `0002_hide_certificate_emails.sql`, `0003_admin_list_columns.sql`, `0004_mail_and_short_links.sql`, `0005_multi_club_foundation.sql`.
4. **Turn off public sign-ups:** Authentication -> Sign In / Providers -> Email -> disable "Allow new users to sign up".
5. **Add the first admin:** Authentication -> Users -> Add user (tick Auto confirm), then in the SQL Editor make that account platform admin and president of the starting club (rename the club later in the `clubs` table):
   ```sql
   update public.profiles set is_admin = true, login_name = 'admin' where email = 'you@example.com';
   select public.appoint_president((select id from public.clubs where slug = 'main'), 'you@example.com');
   ```
6. **Edit `js/config.js`:** paste your Project URL and the **anon** key. Set `ORG_NAME` and `ORG_TAGLINE` to your club. Never paste the `service_role` key.
7. **Replace the artwork** in `assets/img/` (`Logo_White.png`, `Logo_Banner_White.png`, `logo.png`, `front/image2.png`) with your club's own.
8. **Turn on Pages:** repository Settings -> Pages -> Source: GitHub Actions. Push to `main` and wait for the green tick.
9. **Set redirect URLs** in Supabase (Authentication -> URL Configuration): Site URL = your Pages address, and add `.../change-password.html` to Redirect URLs.
10. **Fix the short-link path:** in `404.html` set `var REPO = 'your-repo-name';`.
11. **Optional mail:** follow "Mail and short links" in the README to deploy the `send-bulk-mail` Edge Function and add the SMTP secrets.

Test before announcing: run `supabase/tests/phase1_two_clubs.sql` (it must end with `ALL CHECKS PASSED`), then log in, reset a password, generate a certificate, send a test mail, open a short link.

To add more clubs on the same copy: `select public.create_club('Name', 'slug');` then `select public.appoint_president(<id>, 'email');`. The Edge Function `send-bulk-mail` changed in 0005's release: redeploy it from `supabase/functions/send-bulk-mail/index.ts`.
