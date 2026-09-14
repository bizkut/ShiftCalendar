# ShiftCalendar recovery runbook

This runbook separates application exports, D1 data recovery and Worker rollback. Use the APAC location hint for disposable rehearsal databases. Never run a Time Travel restore or destructive rehearsal command against `shiftcalendar`.

## Routine application exports

Before every structural roster import and once each week during the pilot, a current team leader or manager opens **Team scheduling → Import and export** and downloads roster, request and audit JSON. Request reasons and private calendar fields are intentionally excluded. Keep the files in encrypted operator storage for 30 days, then delete them. Keep the original CSV/JSON import source beside the pre-import exports until the imported roster is accepted.

CSV output neutralizes cells beginning with spreadsheet formula characters. JSON includes a versioned schema name. Treat either format as personal data even though private details are omitted.

## D1 Time Travel rehearsal

Create a disposable database and a temporary Wrangler configuration that binds only that database. Apply every migration and load sanitized `.invalid` fixtures. Do not copy production data into a drill.

```bash
rtk npx wrangler d1 create shiftcalendar-recovery-rehearsal --location apac
rtk npx wrangler d1 migrations apply REHEARSAL --remote --config wrangler.rehearsal.jsonc
rtk npx wrangler d1 time-travel info REHEARSAL --config wrangler.rehearsal.jsonc --json
rtk npx wrangler d1 time-travel restore REHEARSAL --config wrangler.rehearsal.jsonc --bookmark <recorded-bookmark> --json
```

After restore, query users, teams, memberships, calendars, calendar days, requests, mutations, audit and import runs. Compare counts and representative revisions/statuses with the pre-mutation fixture. Record sanitized results, delete the rehearsal database and remove the temporary configuration.

D1 Free Time Travel retains a rolling seven days. A restore overwrites the selected database and returns the prior bookmark for undo. This is an emergency data procedure and is independent of Worker code rollback.

## Independent SQL copy rehearsal

Create separate disposable source and copy databases. Apply migrations and sanitized fixtures to the source, export it, import into the empty copy and verify every required table before deleting both databases and the local SQL file.

```bash
rtk npx wrangler d1 export SOURCE --remote --config wrangler.recovery.jsonc --output /tmp/shiftcalendar-recovery.sql
rtk npx wrangler d1 execute COPY --remote --config wrangler.recovery.jsonc --file /tmp/shiftcalendar-recovery.sql
rtk npx wrangler d1 delete SOURCE --config wrangler.recovery.jsonc -y
rtk npx wrangler d1 delete COPY --config wrangler.recovery.jsonc -y
rtk rm /tmp/shiftcalendar-recovery.sql
```

Do not retain temporary download links, bookmarks, real email addresses or production row data in Git evidence.

## Worker code and asset rollback

List retained deployments, choose a schema-compatible version, route 100% traffic to it, and verify the custom domain plus Access-protected app, API, asset and deep-link routes. Restore the intended version after the drill.

```bash
rtk npx wrangler deployments list --config wrangler.production.jsonc
rtk npx wrangler versions deploy <retained-version>@100 --config wrangler.production.jsonc --message "rollback" -y
rtk npx wrangler versions deploy <intended-version>@100 --config wrangler.production.jsonc --message "restore" -y
```

Worker rollback does not rewind D1. Keep additive migrations in place and use Time Travel or a reviewed SQL recovery only when data itself must be restored.
