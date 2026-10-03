# Security policy

If you find a vulnerability (for example a way to read private data, mail strangers, or act as an admin),
please **do not open a public issue**. Report it privately through the repository's
**Security -> Report a vulnerability** page, or email the maintainers listed on the IIST-OSS GitHub profile.

Please include the page or function involved and the steps to reproduce. We will acknowledge the report
and fix it before it is discussed publicly.

Reminders for people who run their own copy:
- Turn off public sign-ups in Supabase Authentication.
- Keep the `service_role` key and SMTP password out of the repository.
- Review your Row Level Security policies after any schema change.
