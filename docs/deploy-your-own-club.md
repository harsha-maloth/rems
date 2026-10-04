# Run your own copy

You need a GitHub account and a free Supabase account. You do not need a server.

1. **Fork** this repository under your club's GitHub account.
2. **Create a Supabase project** at supabase.com. Use a club account, not a personal one, and add a second person as an owner.
3. **Set up the database.** In the Supabase SQL Editor, run these files from `supabase/migrations/` one at a time, in this order:
   `0001_init.sql`, `0002_hide_certificate_emails.sql`, `0003_admin_list_columns.sql`, `0004_mail_and_short_links.sql`, `0005_multi_club_foundation.sql`, `0006_student_identity.sql`, `0007_club_hierarchy.sql`, `0008_release_hardening.sql`.
4. **Sign-up settings.** In Authentication, turn on "Allow new users to sign up" and "Confirm email". Do this only after running `0006`. If your institute e-mail domain is not `iist.ac.in`, change it (see the README).
5. **Add the first admin.** Run `select public.invite_staff('you@example.com');`. Then go to Authentication, Users, Add user, enter that e-mail and a password, and tick Auto confirm. Then run:
   ```sql
   update public.profiles set is_admin = true, login_name = 'admin' where email = 'you@example.com';
   select public.appoint_president((select id from public.clubs where slug = 'main'), 'you@example.com');
   ```
   The starting club is called Main club. You can rename it in the `clubs` table.
6. **Edit `js/config.js`.** Paste your project URL and the anon key. Set `ORG_NAME` and `ORG_TAGLINE`. Never paste the `service_role` key.
7. **Change the pictures** in `assets/img/` (`Logo_White.png`, `Logo_Banner_White.png`, `logo.png`, `front/image2.png`) to your own.
8. **Turn on GitHub Pages.** In the repository, go to Settings, Pages, and set the source to GitHub Actions. Push to `main` and wait for the green tick.
9. **Set the redirect addresses.** In Supabase, go to Authentication, URL Configuration. Set Site URL to your Pages address. Add `.../change-password.html` and `.../login.html` to Redirect URLs.
10. **Fix the short-link path.** In `404.html`, set `var REPO = 'your-repo-name';`.
11. **Bulk e-mail (optional).** Follow the "Bulk e-mail" part of the README to deploy the `send-bulk-mail` function and add the SMTP secrets.

## Check that it works

Run the three files in `supabase/tests/` in the SQL Editor. Each must end with `ALL CHECKS PASSED`. Then sign in, reset a password, make a certificate, send a test e-mail and open a short link.

## Add more clubs

```sql
select public.create_club('Name', 'slug');
select public.appoint_president(<club id>, 'person@example.com');
```
