# Contributing to ClubOrbit

Thanks for helping. ClubOrbit is a small static site plus a Supabase back end, so it is easy to run locally.

## Run it locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000/login.html
```
Create your own Supabase project (see the README setup) and put its URL and **anon** key in `js/config.js`.
Add `http://localhost:8000/change-password.html` to the Supabase redirect URLs to test password reset.

## Ground rules
- **Never commit secrets.** Only the Supabase anon key belongs in `js/config.js`. The `service_role` key and the SMTP password must never appear in the repository.
- Row Level Security is the only protection for data. A change that touches a table needs a new numbered file in `supabase/migrations/`, never an edit to an old one. Access questions go through `has_perm(club_id, permission)`; run `supabase/tests/phase1_two_clubs.sql` before opening the pull request and add a check for any new club-scoped table.
- Keep the copyright lines in `LICENSE` (MIT requires it).
- No build step: plain HTML, CSS and JavaScript. Keep it that way so clubs can fork and deploy by pushing.

## Pull requests
1. Fork, create a branch, make a focused change.
2. Test the pages you touched in a browser, in light and dark mode.
3. Open a pull request and say what changed and how you tested it.

Bugs and ideas: open an issue using the templates.
