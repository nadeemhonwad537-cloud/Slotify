# Slotify Gate 1 Safe Demo Plan

**Inspection date:** 2026-10-22  
**Purpose:** Prepare an isolated demonstration of existing Slotify behavior.  
**Actions taken:** Read-only source/document inspection only. No app start, browser access, API call, database connection, account action, code change, migration, seed, or test execution was performed for this plan.

## Recommendation

**NO-GO for starting a demo now.** The backend's current effective configuration targets `slotify_dev`, a protected database. The proposed isolated demo database has not been verified to exist or be empty, and the current database account previously failed to create the approved disposable test database (`ER_DBACCESS_DENIED_ERROR`). No authorized demo account or shared authenticated session is confirmed. Do not start the backend until a DBA provisions and confirms the isolated target and a dedicated runtime account.

The previously documented denial concerned `slotify_test_disposable_audit_20261022_1219`; it is evidence that the prior account could not create that schema, but **not** a live check of whether the proposed `slotify_demo_gate1_20261022` exists or whether permissions have since changed. I did not query MySQL because the current configuration points to protected `slotify_dev`, and no approved read-only metadata connection was supplied.

## Inspected files and scripts

### Project configuration and test safety

- [backend/package.json](../backend/package.json): backend `dev`, `start`, `migrate`, `seed:reference`, `db:reset`, `create-admin`, workload import/preview/plan/verify and test scripts.
- [backend/src/config/env.ts](../backend/src/config/env.ts): `dotenv/config` loads environment values and Zod validates them. Environment variables already present in the process take precedence by default; the loader has no dedicated demo mode or guard against protected database names.
- [backend/src/db/pool.ts](../backend/src/db/pool.ts): application MySQL pool uses `env.DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`. `withTransaction` commits on success and rolls back on errors.
- [backend/vitest.config.ts](../backend/vitest.config.ts) and [backend/tests/globalSetup.ts](../backend/tests/globalSetup.ts): Vitest resolves a `slotify_test_disposable_<suffix>` target, requires loopback and `SLOTIFY_ALLOW_DISPOSABLE_DB_RESET=YES`, then global setup runs `resetDatabase()` and all migrations plus reference seed. Never run Vitest without a verified isolated target.
- [backend/src/config/testDatabaseSafety.ts](../backend/src/config/testDatabaseSafety.ts): safeguards apply to Vitest target selection, not to ordinary application startup, migration commands, or scripts.
- [frontend/package.json](../frontend/package.json) and [frontend/vite.config.ts](../frontend/vite.config.ts): frontend dev server uses port 5173 and proxies `/api` to `http://localhost:4000`.
- [docs/GATE1_ACTUAL_DEMO_READINESS.md](./GATE1_ACTUAL_DEMO_READINESS.md): previous audit evidence and known feature verification gaps.

### Database setup, accounts, and authorization

- [backend/src/db/migrate.ts](../backend/src/db/migrate.ts): creates/updates `schema_migrations`, applies every unapplied `.sql` migration in sorted filename order, and optionally runs every reference seed SQL file. MySQL DDL can auto-commit, so a failed migration may leave partial DDL. Migration 002 creates triggers; code warns on MySQL error 1419 to stop and ask a DBA rather than changing binary logging/global settings or granting broad rights.
- [backend/src/db/reset.ts](../backend/src/db/reset.ts): drops every base table in the configured schema. It only refuses `NODE_ENV=production`; **it does not protect `slotify_dev` or `slotify_test` by name**.
- [database/seeds/reference/001_reference_data.sql](../database/seeds/reference/001_reference_data.sql): inserts permission rows, generic room types, designations and workload counting/rule defaults. It explicitly says it does not contain university departments, faculty, courses, rooms, or slots. It does **not** create a user/account. Some permissions are marked provisional; e.g., ADMIN `timetable:publish`.
- [backend/src/scripts/createAdmin.ts](../backend/src/scripts/createAdmin.ts): supported first-admin bootstrap. It requires `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` from the process environment; password minimum is 12 characters. It inserts into `users` and `user_roles` in a transaction. No default credentials are present. The script uses the configured application DB pool, so it is safe for this plan only after the process target is explicitly set to the verified isolated demo schema.
- [backend/src/middleware/auth.ts](../backend/src/middleware/auth.ts) and [backend/src/routes/auth.ts](../backend/src/routes/auth.ts): account login reads user/role information but also updates failed-login counters and writes/rotates refresh-session rows. Logout revokes refresh-session rows. Thus a strictly read-only database account cannot complete the normal login flow.
- ADMIN is required by the frontend route guard for the Admin portal. The readiness endpoint itself requires `masterdata:read`; the seeded ADMIN role has broad write permissions as well. A DB permission boundary is therefore recommended to prevent application write routes from changing demo academic records.

## Effective database target and isolation behavior

The non-secret values read from `backend/.env` on 2026-10-22 were:

| Setting | Current value |
|---|---|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `3306` |
| `DB_NAME` | `slotify_dev` |
| `PORT` | `4000` |
| `NODE_ENV` | `development` |

No credential values were read or exposed in the report. No process-level overrides for these settings were present at inspection time.

The backend loader reads `process.env` and, through dotenv's default behavior, does not replace existing process values with `.env` values. Therefore process-only `DB_NAME`, `DB_HOST`, and `DB_USER` overrides can select a demo connection without editing `.env`; the demo DB credentials must also be supplied through a protected process/secret mechanism. **This is not a safety guard:** if a required override is absent or misspelled, the backend falls back to `.env` and targets `slotify_dev`. The app does not reject `slotify_dev` or `slotify_test` during startup.

The frontend proxy is not a database boundary. It forwards API requests to the backend, whose DB target is determined by the backend process environment.

### Proposed schema check

Proposed schema name: `slotify_demo_gate1_20261022`.

- Existence and emptiness are **unknown**. No check was made because no approved read-only connection independent of protected `slotify_dev` was available.
- An authorized DBA should check the exact schema name through an approved MySQL administration channel before creation. Confirm it is absent; if present, stop and inspect its ownership/data under DBA policy rather than reusing or overwriting it.
- Do not retry database creation using other credentials, grant privileges to the current account, or connect to a protected DB to obtain a demo.
- The previous `ER_DBACCESS_DENIED_ERROR` is a blocker signal, not permission to escalate.

## Scripts and commands that can change state

| Command/path | Effect | Safety disposition |
|---|---|---|
| `npm run dev` / `npm start` | Starts backend. It uses configured DB for API actions; login, refresh, logout and application mutation routes write records. | Do not start with current `.env` target. Use only after isolated DB and dedicated DB user are verified. |
| `npm run migrate` | Applies migrations to configured database and writes migration history. Migrations create/alter schema; DDL may auto-commit. Migration 002 creates triggers. | DBA/operator only, isolated schema only; never protected DBs. |
| `npm run seed:reference` | Calls migration runner with `--seed`: applies migrations **and** inserts reference permissions/types/policies. It does not seed a demo user or institutional academic data. | Isolated schema only, after schema verification and approved migration procedure. |
| `npm run db:reset` | Drops all base tables in configured schema. Production-mode guard is insufficient protection for protected DB names. | Do not use in this demo plan. |
| `npm run create-admin` | Creates a user and ADMIN role in configured database. | Only in confirmed demo schema and only with authorized credentials stored securely; never against protected DBs. |
| `npm run import:workload-source` | Writes workload import staging/provenance/review records in a transaction. Source explicitly refuses any target other than `slotify_dev`. | **Do not run.** Not usable for demo DB and targets a protected database. |
| `npm run preview:workload-import` | Opens a read-only transaction against hard-coded `slotify_dev`, then writes preview JSON/Markdown files in the repository. | **Do not run** for this plan: it connects to protected DB and changes workspace files. |
| `npm run plan:workload-import` | Source pins target to `slotify_dev`, uses a read-only DB transaction and writes import-plan JSON/Markdown files. | **Do not run** for this plan: it connects to protected DB and changes workspace files. |
| `npm run verify:workload-import` | Source refuses targets other than `slotify_dev`; queries counts and prints import details. No DB writes identified. | **Do not run**: protected DB access is unnecessary for demo preparation. |
| `npm test` | Vitest global setup resets configured target, then applies migrations and reference seeds. | **Do not run** unless the explicitly approved disposable test DB is independently verified and reset consent is set. Not needed for demo setup. |
| `npm run test:workload-preview` | Node test command for workload preview test file. | Not run; no demo need. |
| Admin CRUD APIs/UI | Master-data CRUD and user-management routes create/update/disable/delete records; many use DB transactions. | Runtime demo role and DB privileges must prevent writes to academic/demo data if a read-only demonstration is intended. |
| Curriculum draft/publish APIs | Draft create/update/delete and curriculum publish write draft/course/component/offering/audience/audit rows. | Do not invoke for this read-only demo. |
| Faculty preferences/availability APIs | Save/submit/review and availability CRUD write submission, preference, availability and audit data. | Do not invoke. |
| Assignment/import APIs | Allocation finalization, assignment create/update/approve/delete, and import review write records. | Do not invoke. |
| Timetable APIs | Version/session mutations and submit/review/approve/publish/change-request actions write records. Validation with `dry_run: false` stores validation runs/issues; lifecycle publication modifies versions and audit history. | Do not invoke. |
| Timetable configuration GET | `GET /api/timetable/configuration/:termId` reads academic configuration and computes readiness issues. | Candidate read-only demo endpoint, but only after safe isolated setup. |
| Timetable dry-run preview | UI sends `POST /api/timetable/validate` with `dry_run: true`; route calls `computeValidation` and returns issues without persisting validation. | The `dry_run` branch is read-only in inspected code, but it is still an authenticated POST subject to CSRF and the same DB target. Only use against demo data after isolation. |

## Isolated database proposal

### Schema and migration requirements

1. DBA checks whether `slotify_demo_gate1_20261022` exists, then creates it only if absent and only under approved organizational policy.
2. Migrations should be applied in the runner's sorted order to that schema only. The database should be provisioned empty and isolated from both protected DBs.
   Current migration filenames, in sorted application order:
   `001_core.sql`, `002_timetable.sql`, `002_workload_import_review.sql`,
   `003_audit_logs.sql`, `003_workload_import_summary.sql`,
   `004_faculty_source_subject_preferences.sql`, `005_term_program_semesters.sql`,
   `006_room_location.sql`, `007_preference_curriculum_context.sql`,
   `008_room_practical_approval.sql`, and `009_curriculum_drafts.sql`.
3. For the intended readiness and timetable validation demo, inspect all migration prerequisites. Migration **008** adds `rooms.practical_approved`; the validator checks schema support and emits a blocking issue if absent. It is required for an honest practical-room suitability demonstration.
4. Migration **009** creates `curriculum_drafts`; it is required only if curriculum draft save/restore is included. It is not needed for the read-only readiness endpoint itself.
5. Migration **002** creates immutability and approval triggers. The prior migration runner history recorded an error 1419 path on trigger creation; DBA must review trigger migration prerequisites and use an approved procedure. Do not change server-wide binary logging/trust settings or seek broad privileges. If migrations cannot safely complete, stop and narrow the demo; do not bypass triggers.
6. The reference seed inserts permission/configuration reference rows but no user or institutional timetable dataset. It marks some policies/designations `VERIFY`; the app's readiness check may remain blocked until a synthetic, approved dataset is loaded.
7. Readiness checks compare against configured academic structure, rooms, day/period grid, and workload policy. Dry-run needs an existing timetable version and related verified offerings, audiences, faculty assignments, sessions, rooms, and time slots. No synthetic dataset currently exists in this repository seed.
8. Do not copy `slotify_dev` or `slotify_test` into demo. Only use a deliberately created synthetic, non-personal dataset, populated through a separately reviewed fixture/import procedure approved by the DBA and project owner.

### Minimum privilege guidance

Use separate identities for provisioning/migrations and runtime:

- **Provisioner:** DBA-controlled permission to create only the new schema and create/restrict its database account. Do not grant the current application's account elevated global privileges.
- **Migration operator:** temporary schema-scoped DDL permissions required by the migration files (create/alter tables, indexes, foreign keys, triggers) and seed DML. Determine exact MySQL privileges with the DBA; trigger creation may be constrained by server binary-logging policy. Remove/revoke temporary DDL authority after schema initialization if organizational policy allows.
- **Runtime application account:** no global privileges and no DDL. For readiness/dry-run, grant schema-scoped `SELECT` on required demo tables and metadata visibility. Normal auth still requires scoped writes: `INSERT`/`UPDATE` on demo `refresh_sessions` and `UPDATE` on demo `users` for login counters/state; `SELECT` on `users`, `user_roles`, and `role_permissions`. If logout/refresh are part of the demo, permit the corresponding refresh-session updates/inserts. Restrict writes on academic, curriculum, assignment, room and timetable content tables to prevent accidental mutations.
- **Account bootstrap:** `create-admin` additionally needs `INSERT` on `users` and `user_roles`. Prefer a separate temporary schema-scoped bootstrap identity or a DBA-approved account provisioning procedure, then revoke its write authority. Do not include those privileges in the ongoing runtime account merely for convenience.
- This is least-privilege guidance, not a pre-certified complete grant list. The DBA should validate queries and MySQL grants in the isolated schema. Do not grant `CREATE`, `DROP`, `ALTER`, `TRIGGER`, global access, or access to `slotify_dev`/`slotify_test` to the runtime account.

The application does not have a global read-only mode. ADMIN UI controls and mutation endpoints remain present. A dedicated isolated database plus runtime DB grants that permit only auth/session writes and required reads is the recommended defense against accidental academic-data changes. If those grants make the approved workflow fail, stop and ask for a reviewed alternative; do not broaden privileges ad hoc.

## Demo account plan

- No default demo user/password is present.
- `npm run create-admin` is the existing first-admin account creation workflow. It does not itself seed permission rows; reference seed/migrations must already have been applied to the isolated schema.
- After the isolated schema is verified and seeded, the authorized operator may bootstrap its synthetic Admin using `npm run create-admin` with `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` supplied in the process environment. This command writes account/role rows; run it only after explicitly verifying `DB_NAME`, `DB_HOST`, and a temporary, schema-scoped bootstrap DB identity in that same process. Do not use the runtime identity unless its grants have been explicitly approved for account creation. Revoke temporary bootstrap write privileges/identity after setup if organizational policy allows. Do not place the account password in this report, source code, `.env`, or shell history.
- The Admin UI's `/admin/validation` route requires the ADMIN role. The readiness endpoint requires `masterdata:read`; the reference seed grants that to ADMIN. ADMIN also has broad application-level permissions, so DB privilege restriction is important.
- Create only a synthetic, authorized demo account in the isolated demo database. Use a unique username/email and a strong unique password supplied through a secure secret channel; do not put secrets in source, report, command history or `.env`.
- Do not create the account until DBA confirms the process environment is unequivocally set to the demo schema and user. Never use `create-admin` with current `.env` defaults.
- Successful login creates a refresh session and updates login counters; logout revokes the session. Those are writes but are confined to the isolated demo schema by design.

## Safe startup commands (proposed; do not execute until GO conditions are met)

These are examples only. They were not executed. DBA must supply the demo database user credentials through a protected process environment/secret manager, and the exact schema name must first be verified. Do not put credential literals in a script or report.

**Backend PowerShell terminal**

```powershell
Set-Location 'C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\backend'
$env:DB_HOST = '127.0.0.1'
$env:DB_NAME = 'slotify_demo_gate1_20261022'
$env:DB_USER = '<DBA-provisioned demo runtime account>'
$env:PORT = '4000'
$env:NODE_ENV = 'development'
if ($env:DB_HOST -notin @('127.0.0.1', 'localhost', '::1') -or
    $env:DB_NAME -ne 'slotify_demo_gate1_20261022' -or
    $env:DB_USER -eq '<DBA-provisioned demo runtime account>') {
  throw 'Demo target/user not verified; do not start backend.'
}
npm run dev
```

The password must be supplied from the approved secret manager as a process variable before startup; this example intentionally does not show how to enter/store it. Keep the same process environment and terminal for the backend lifetime. The guard above is a human/operator preflight, not an application-enforced safety check.

The account-bootstrap command, if approved, uses a separate PowerShell process with the same verified `DB_HOST`, `DB_NAME`, and demo `DB_USER`, plus the account metadata variables and password supplied securely:

```powershell
Set-Location 'C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\backend'
npm run create-admin
```

For this command, `DB_USER` must be the temporary schema-scoped bootstrap identity (not necessarily the restricted runtime identity), and the `ADMIN_*` values must be supplied securely in process environment. It is **not read-only** and is not part of the proposed demo presentation; use it only once against the isolated demo database after DBA-approved setup.

**Frontend PowerShell terminal**

```powershell
Set-Location 'C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\frontend'
npm run dev
```

Then use `http://localhost:5173/login`. Frontend startup alone does not connect to MySQL; backend API requests do.

## Proposed demonstration sequence (not executed)

### Preconditions

- DBA confirms the new schema is distinct from protected schemas and empty before setup.
- All required migrations complete successfully in the isolated schema; trigger migration is approved.
- Approved synthetic academic configuration and, if needed, a synthetic validated timetable exist.
- Dedicated demo runtime user is bound only to the demo schema and least-privilege grants have been verified.
- Synthetic Admin account exists in the demo schema; no real faculty/student data or passwords are used.
- Confirm no test setup, backend process, or browser is pointed at either protected database.

### Steps

1. Start backend with explicit process-only `DB_HOST`, `DB_NAME`, and dedicated demo `DB_USER`; verify these non-secret values before running `npm run dev`.
2. Start frontend with `npm run dev`.
3. Visit `http://localhost:5173/login` and sign in with the authorized synthetic demo account. Login session writes remain inside the isolated demo schema.
4. Open Admin **Validation & Conflicts** (`/admin/validation`).
5. Choose an approved synthetic term under **Academic Term Configuration Readiness** and select **Check Configuration**. This calls `GET /api/timetable/configuration/:termId`. Capture the actual response and visible issues; do not claim readiness if response lists blockers.
6. Only if a synthetic timetable is intentionally seeded and the runtime permission is approved, choose that existing version and click **Dry Run (Preview)**, never **Run & Save**. This calls the validation endpoint with `dry_run: true`; capture response and distinguish validation from generation.
7. Log out. This revokes the refresh token in the isolated schema. Do not demonstrate any create/edit/publish actions.

For each run, record browser console errors, HTTP status/request path, displayed response and date. Never include cookies, CSRF values, passwords or tokens in evidence.

## Remaining blockers and must-not-claim list

- Current app configuration points to protected `slotify_dev`; no demo override is currently configured.
- Proposed database existence/emptiness not checked. Previous separate disposable DB creation was denied; current account's create permission is not presumed.
- No confirmed dedicated demo DB user, least-privilege grants, authorized account, synthetic academic dataset, or safe authenticated browser session.
- All migrations, especially trigger creation, need DBA-approved isolated execution. Prior recorded state for `slotify_dev` was through 007, with 008/009 unapplied; this plan did not re-query and must not apply them there.
- Reference seed has no institutional demo records. It does not create users.
- Readiness and timetable dry-run code exists, but neither feature has been executed against a verified isolated demo dataset.
- Demo login writes auth/session rows; not truly read-only at database level. Its acceptable writes are limited to the isolated demo schema.
- Automatic timetable generation and unplaced-session reporting are not implemented. Student-scoped timetable is blocked by missing verified student/division mapping. Curriculum draft persistence requires migration 009; classroom practical suitability requires migration 008.
- The demo should not claim DB persistence, full RBAC, lifecycle atomicity, rollback safety, KPI attainment, student timetable scoping, or generator behavior as browser-verified.

## GO / NO-GO

**Current decision: NO-GO.** Do not start the backend with the current `.env`, because it resolves to `slotify_dev`. Do not create a database, retry permissions, run setup commands, or use alternative credentials in this preparation task.

**Path to GO:** DBA verifies the proposed schema name and emptiness via an approved admin channel; provisions the isolated schema and restricted runtime account; reviews/applies the ordered migrations and reference seed only there; project owner approves synthetic data and creates an authorized demo identity only in that schema; then the operator verifies process-only target overrides and least-privilege behavior before startup. Stop on any mismatch or migration/trigger permission error.
