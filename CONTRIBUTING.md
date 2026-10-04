# Contributing

**This project is discontinued.** Pull requests and issues in this repository will not be read or merged. If you want to change ClubOrbit, fork it and work in your own copy. The rest of this page describes how the project was built, to help your fork.

ClubOrbit is a static site plus a Supabase database.

## Run it on your computer

```bash
python3 -m http.server 8000
```
Open http://localhost:8000/login.html. Create your own Supabase project and put its URL and anon key in `js/config.js`. To test password reset, add `http://localhost:8000/change-password.html` to the redirect addresses in Supabase.

## Rules

- Never commit secrets. Only the anon key belongs in `js/config.js`. The `service_role` key and the SMTP password must never be in the repository.
- Row Level Security protects the data. A change to a table needs a new numbered file in `supabase/migrations/`. Do not edit old ones. Access rules go through `has_perm(club_id, permission)`.
- Run all three files in `supabase/tests/` before you open a pull request. Add a check for every new club table.
- Keep the copyright lines in `LICENSE`.
- Do not add a build step. Plain HTML, CSS and JavaScript keeps forking easy.

## Working in your fork

1. Make one focused change on a branch.
2. Try the pages you touched in a browser, in light and dark mode.
3. Run the three test files if you touched the database.
