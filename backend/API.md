# ShiftCalendar cloud API contract

All routes are under `/v1`, use JSON, and require an HTTP API JWT authorizer. The Lambda also requires `sub` and `token_use=access`. List routes return `Page<T>` and accept `limit` (maximum 100) and an opaque `cursor`. Date reads require inclusive `from` and `to` local dates and allow at most 62 days. Create/action bodies use `{ mutationId, value }`; versioned bodies use `{ mutationId, expectedVersion, value }`. Stale versions return `409 conflict` and mutation retries return the original result. Invitation expiry defaults to seven days when omitted.

| Method and route | Purpose and response |
|---|---|
| `GET /bootstrap` | Profile, private calendars, team memberships |
| `GET, PATCH /profile` | Read or version-update the caller's private profile |
| `GET, POST /calendars` | List private calendars (or one team's calendars with `teamId`) or create a private/team calendar |
| `GET, PATCH, DELETE /calendars/{calendarId}` | Read, version-update, or deactivate a calendar |
| `GET /calendars/{calendarId}/days?from=&to=&limit=&cursor=` | Bounded day records including versioned tombstones, which clients hide but retain for concurrency |
| `PATCH /calendars/{calendarId}/days/{date}` | Versioned day upsert/delete |
| `POST /calendars/{calendarId}/days/bulk` | Atomic bulk of at most 8 versioned day edits |
| `GET, PATCH /calendars/{calendarId}/private-details` | Owner-only pay, notes, overtime, leave reasons and balances |
| `GET /calendars/{calendarId}/shift-types` | Paginated scoped shift definitions |
| `PUT, DELETE /calendars/{calendarId}/shift-types/{code}` | Versioned scoped shift definition write/delete |
| `GET, POST /teams` | List memberships or create a team |
| `GET, PATCH, DELETE /teams/{teamId}` | Read, version-update, or deactivate a team |
| `GET /teams/{teamId}/members` | Paginated membership list |
| `PATCH, DELETE /teams/{teamId}/members/{sub}` | Owner-only non-owner role change/removal; self-delete leaves |
| `POST /teams/{teamId}/transfer-ownership` | Atomically transfer ownership to a current member |
| `POST /teams/{teamId}/invites` | Owner-only invitation creation; plaintext token returned once |
| `DELETE /teams/{teamId}/invites/{inviteId}` | Owner-only invitation revocation |
| `POST /invites/redeem` | Atomically consume an unexpired invitation and create membership |
| `GET /teams/{teamId}/roster?from=&to=&limit=&cursor=` | Paginated team schedule rows with no private details |

Calendar shapes preserve the local `id`, `name`, and `color` fields and add scope, team, assigned-member, timezone, role, version, and audit metadata. Team calendar day responses contain only `date`, `shiftCode`, `availability`, version, and audit fields. Personal notes, leave details/balances, overtime, and pay appear only through the private-details route after a private-calendar ownership check.

Private details retain up to 3,660 unique dated entries and at most 300,000 UTF-8 JSON bytes. Storage uses one small metadata/version item plus per-date rows of at most 2,000 bytes. A request may change at most four private dates; unchanged submitted history is not rewritten. Authorized retries return the current private snapshot from rows because idempotency records intentionally contain only a small marker rather than copied private history. Deleted calendar days remain as versioned tombstones so stale version-zero writes cannot recreate them; day reads return tombstones for version caching, while roster responses omit them.

Invitation tokens are returned only by the successful create call and are never stored in plaintext. Retrying the same invitation creation mutation returns `409 conflict` because the original secret cannot be recovered; the mutation marker prevents a duplicate invitation.
