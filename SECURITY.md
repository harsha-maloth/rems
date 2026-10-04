# Security

**This project is discontinued.** Version 1.0.0 is the final release. No security updates will be made.

## Reporting a problem

You can still report a security problem through the repository's Security tab (Report a vulnerability). Please do not open a public issue. Because nobody maintains this project any more, we may not answer and we will not promise a fix.

If you run your own copy, you are responsible for fixing problems in it.

## If you run a copy

- Keep "Allow new users to sign up" and "Confirm email" both on. Sign-up is safe only because a database check accepts admitted students and invited staff and nobody else. Do not turn sign-up on before you run `0006`.
- Keep the `service_role` key and the SMTP password out of the repository.
- Form answers and bulk e-mail are limited by `0008`. The limits are in the `app_settings` table.
- Run the three test files after any change to the database.
- The libraries the pages load are old and will not be updated here. Update them in your own copy.
- The system holds student data. Delete data you no longer need.
