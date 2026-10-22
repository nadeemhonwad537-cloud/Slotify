# Slotify — Smart Campus Academic Timetable Generator

Stack: React + TypeScript + Vite + Tailwind (frontend, **not started**), Node + Express + TypeScript (backend), MySQL 8+.

See `HANDOVER.md` for exact status, `docs/DECISIONS.md` for the decision log and `docs/DEVIATIONS.md` for every departure from the source designs.

## Prerequisites
Node 20+ (tested on 22), MySQL 8.0.16+ (CHECK constraints are enforced from 8.0.16; tested on 8.0.46).

## Database setup
```sql
CREATE DATABASE slotify_dev CHARACTER SET utf8mb4;
CREATE DATABASE slotify_test CHARACTER SET utf8mb4;
CREATE USER 'slotify'@'127.0.0.1' IDENTIFIED BY '<choose-a-password>';
GRANT ALL ON slotify_dev.* TO 'slotify'@'127.0.0.1';
GRANT ALL ON slotify_test.* TO 'slotify'@'127.0.0.1';
```
**Triggers need one server setting.** Migration 002 creates triggers (published-version immutability). If binary logging is on and the migration user lacks SUPER, MySQL refuses with error 1419. Fix with ONE of:
`SET GLOBAL log_bin_trust_function_creators = 1;` (and add it to `my.cnf`), or grant the migration user SUPER, or disable binary logging.

## Backend
```bash
cd backend
npm install
cp .env.example .env        # fill in DB_PASSWORD and a random JWT_SECRET (never commit .env)
npm run migrate -- --seed   # applies database/migrations/*.sql, then safe reference seed
npm run typecheck
npm test                    # rebuilds slotify_test from the migrations, then runs all tests
```
Create the first admin (no default credentials exist):
```bash
ADMIN_USERNAME=<name> ADMIN_EMAIL=<email> ADMIN_NAME="<full name>" ADMIN_PASSWORD='<12+ chars>' npm run create-admin
npm run dev                 # API on http://localhost:4000
```
`npm run db:reset` drops every table in the configured DB (refuses in production). `npm run build && npm start` runs the compiled server.

## API conventions
Responses: `{ success: true, data }` or `{ success: false, error: { code, message, details? } }`.
Auth: HttpOnly cookies. Call `GET /api/auth/csrf` first, then send the returned token in the `x-csrf-token` header on every POST/PATCH/PUT/DELETE.

| Method | Path | Access |
|---|---|---|
| GET | /api/health | public |
| GET | /api/auth/csrf | public |
| POST | /api/auth/login, /refresh, /logout | public (CSRF required) |
| GET | /api/auth/me | authenticated |
| POST/GET | /api/users | `users:manage` (ADMIN) |
| PATCH | /api/users/:id/status | `users:manage` |

## Data rules
No university data is seeded. `database/seeds/reference/` holds only role permissions, generic room types, the two named designations and workload limits (status `VERIFY`), and workload counting policies (`UNCONFIRMED`). Synthetic test data lives only in `backend/tests/` and uses neutral names.

## Master-data API (Milestone 1)
All routes are under `/api/masterdata/<resource>`, need an authenticated session, and return `{ success, data }` (lists add `meta: { total, limit, offset }`). Request and response fields use the **database column names** (snake_case). Reads need `masterdata:read`; writes need `masterdata:write` (and the CSRF header).

Resources: `departments`, `designations`, `faculty`, `academic-years`, `terms`, `programs`, `schemes`, `semesters`, `sections`, `batches`, `room-types`, `rooms`, `room-availability`, `courses`, `components`, `curriculum-courses`, `offerings`, `audiences`, `elective-groups`, `elective-group-offerings`, `teaching-days`, `time-slots`, `term-day-slots`. `GET /api/masterdata/meta` lists them and the fixed rules.

Each resource supports `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` (`elective-group-offerings` cannot be patched). List endpoints accept the relevant `*_id` filters plus `limit` (max 500) and `offset`.

Business rules enforced in code: semester/term parity, Saturday end by 12:30, no overlapping slots on one day, term dates inside the academic year, batch/audience/section/term consistency, consecutive components need `periods_per_session >= 2`. `GET /api/timetable/configuration/:termId` returns a read-only readiness report for semester/division counts, shared room inventory, configured grids, availability, workload-policy verification and calendar support. Timetable validation blocks invalid slot membership, break conflicts, out-of-hours sessions, missing/UNKNOWN resource availability, capacity excess and unapproved classroom practicals. Error codes (`PARITY_MISMATCH`, `SATURDAY_AFTER_CUTOFF`, `SLOT_OVERLAP`, `BAD_REFERENCE`, `IN_USE`, ...) are listed in `docs/DECISIONS.md`. Apply the next ordered migration before using the new room approval field; do not use the destructive test reset against an uncertain `slotify_test`.

## Faculty submission API (Milestone 2)
Faculty (`faculty_submission:own`): `GET /api/faculty-submissions/mine/profile` (only the authenticated user's active faculty profile, or `null`), `GET /api/faculty-submissions/mine/available-courses?term_id=`, `GET /api/faculty-submissions/mine?term_id=`, `PUT /api/faculty-submissions/mine` (full draft: `term_id`, `preferences[<=3]`, `availability[]`), `POST /api/faculty-submissions/mine/submit`, and `GET /api/faculty-submissions/mine/track?term_id=`.
Department (`faculty_submission:review`): `GET /api/faculty-submissions`, `GET /api/faculty-submissions/:id`, `POST /api/faculty-submissions/:id/review` with `{ action: START_REVIEW | ACCEPT | RETURN, comment }`.
Admin availability entry (`faculty_submission:review`): `GET/POST /api/faculty-availability`, `PATCH/DELETE /api/faculty-availability/:id` (admin-entered rows only). Availability must be stated explicitly as AVAILABLE, UNAVAILABLE or UNKNOWN.
