# Slotify Functional Test Plan

**Purpose:** Reproducibly verify the existing Slotify workflows end to end before adding automatic timetable generation or other product features.

## Safety prerequisites

1. Do not run the default Vitest suite against `slotify_dev` or `slotify_test`. The backend `globalSetup.ts` loads backend `.env`, validates the configured test target, then calls `resetDatabase()` and migrations.
2. Use only a uniquely named disposable database matching `slotify_test_disposable_<unique_suffix>`. Before any creation/modification:
   - inspect connection target without printing username/password or secret values;
   - verify the database name is unique and not a dev/test/production target;
   - inspect existing schema/table counts read-only and verify it contains no valuable data;
   - obtain explicit user approval for the exact target and destructive setup.
3. Never disable permissions, binlogging, or database safeguards. Never reset/drop/reseed existing Slotify databases.
4. Browser tests require a shared authenticated browser page and separately provisioned Admin, Faculty, Coordinator (if enabled), and Student accounts. Do not use real faculty/student data for writes.
5. Use synthetic records with a run-specific marker and record created IDs. Clean up only records created by the run, in dependency order, after verifying no references remain. For migration/trigger tests on a disposable schema, database recreation is permitted only after the above approval.
6. Do not apply migrations 008 or 009 to an existing database without separately explaining the migration and receiving approval.

### Read-only environment inspection already performed

- Backend `.env` resolves to loopback MySQL `slotify_dev`; secrets were not printed.
- Read-only inspection found 52 base tables and tracked migrations through `007_preference_curriculum_context.sql`; migration files 008 and 009 are not recorded as applied.
- Read-only uniqueness check found no database named `slotify_test_disposable_audit_20261022_1219`.
- The user approved that exact database and test-harness adjustment, but `CREATE DATABASE` failed with `ER_DBACCESS_DENIED_ERROR`; a read-only follow-up confirmed it remains absent with zero tables.
- Do not retry creating it with another account or request broad privilege changes. Have the authorized DBA provision this exact empty schema under applicable policy. Do not point Vitest at `slotify_dev` or `slotify_test`.

## Phase A — Safe checks (no database connection/writes)

Run from PowerShell:

```powershell
Set-Location 'C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\backend'
npm run typecheck
npx tsx --test tests\*.node.test.ts

Set-Location 'C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\frontend'
npm run typecheck
npm run build
```

Current recorded result (2026-10-22): backend typecheck PASS; database-independent Node tests PASS 85/85; focused curriculum context-switch tests PASS 2/2; focused Faculty submission editor-state and timetable-cache tests PASS 5/5; frontend typecheck PASS; production build PASS with Vite >500 kB chunk warning.

Do not substitute `npm test` for these commands until its database target has been verified and approved.

## Phase B — Runtime/browser smoke tests

Prerequisite: development server configured to a verified safe database or read-only mock-free deployment; authenticated browser page shared for each tested role.

| ID | Role | Steps | Expected result/evidence |
|---|---|---|---|
| B-01 | Anonymous | Open `/`, `/login`, and protected Admin/Faculty/Student URLs; inspect browser console/network. | Redirect/login behavior is correct; no protected data; no uncaught errors. |
| B-02 | Admin | Login, refresh, navigate through every Admin route, logout, then revisit protected route. | Session survives intended refresh; logout invalidates access; each route loads without console errors. |
| B-03 | Faculty | Repeat login/refresh/logout; verify own profile and attempt direct access to Admin URLs/APIs. | Faculty sees only allowed portal; cross-role routes/API return denial; no other faculty records. |
| B-04 | Student | Repeat login/refresh/logout and inspect subjects/timetable. | No guessed division; until mapping exists, page clearly states unavailable and does not expose all-campus/other-student data. |
| B-05 | All roles | Exercise loading, success, no-record, validation-error, network-error and unauthorized states. | User-facing messages are clear; no empty/undefined query crashes or false-success notifications. |

Capture route, role, API status, console error count, and screenshots/page snapshots. Do not submit mutations during smoke testing.

## Phase C — Disposable-database integration/API tests

Prerequisite: DBA/user has explicitly approved a verified disposable database and the exact destructive initialization. Set the test-specific name and reset-consent only in the temporary test process/environment; do not persist secrets into source or documentation.

The process-only overrides are supported by the test harness. For this approved target, after the DBA provisions the empty schema, run from PowerShell:

```powershell
Set-Location 'C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\backend'
$env:SLOTIFY_TEST_DB_NAME = 'slotify_test_disposable_audit_20261022_1219'
$env:SLOTIFY_ALLOW_DISPOSABLE_DB_RESET = 'YES'
npm test
```

The Vitest config and global setup must print the resolved database name and host before reset. Confirm both lines are exactly `slotify_test_disposable_audit_20261022_1219` and loopback (`127.0.0.1`, `localhost`, or `::1`) before allowing setup to continue. If not, stop. Do not set a process `DB_NAME` to an alternate schema. Process overrides are not written to `.env`.

### Authentication and access

1. Create synthetic users with Admin, Faculty, Coordinator (if configured), and Student roles.
2. Verify login success/failure, refresh rotation, logout invalidation, cookie flags, CSRF rejection/acceptance, and expiry.
3. Call every representative protected endpoint unauthenticated, with wrong role, and with an account missing a required permission.
4. Verify faculty/self endpoints derive the profile from the token, not client-supplied IDs.
5. Confirm audit entries for auth/reviewer actions do not leak tokens/secrets.

### Academic/master data and curriculum

1. Create a synthetic academic year, Odd/Even terms, program, scheme, semesters and term-program-semester mappings; exercise valid and invalid parity.
2. Create/edit/retire course, components, division, batch, room and faculty references. Check invalid FKs, inactive references, duplicate names/codes and wrong-context IDs return actionable errors.
3. Build curriculum with mixed lecture/lab/practical components and multiple explicitly selected divisions. Save incomplete draft, reload, update, reject stale version, reject cross-context access, and delete only the created draft.
   - In the Admin Curriculum Builder, select division audience(s) without entering other subject fields, then change term/program/scheme/semester. Confirm a discard prompt appears; cancel and verify the selected audience remains in the editor.
4. Validate and publish once; verify offerings and audience divisions exactly match selected context. Retry publish and verify no duplicates. Force a transaction failure and confirm curriculum/offering/audience state rolls back atomically.
5. Test behavior when migration 009 is absent: API returns migration-required/error response and UI shows explicit unavailable persistence; no false saved message.

### Faculty preferences, availability and assignments

1. Test linked-active, linked-inactive and unlinked faculty profiles. Missing profile remains intentional `null`, with clear UI state.
2. Create preference drafts/submissions and verify allowed counts, duplicate behavior, target context, reviewer decisions, and immutable/final statuses.
3. Create valid, overlapping, invalid-time, AVAILABLE, UNAVAILABLE and UNKNOWN availability windows; verify persisted readback and term/faculty isolation.
4. Plan assignments for correct term/program/semester/division, test invalid/inactive faculty/course/audience, workload limits and source preference rules, then finalize with optimistic/transaction safety.
5. Verify Faculty assigned-course/semester views use only approved assignments for the authenticated faculty profile.
6. Make the selected-term submission-detail request fail, including a refetch failure while cached data exists. Preferences and Availability should show actionable error/retry feedback and disable editing/saving until a successful current-term reload.
7. In one browser session, load a Faculty timetable, log out, then log in as another Faculty account with the same academic context. Confirm the previous account's cached timetable is not displayed and only the new account's published sessions appear.

### Rooms, validation and readiness

1. Create synthetic rooms with type, capacity, equipment, practical approval and availability.
2. Create sessions that intentionally collide by faculty, division/batch, and physical room; verify hard validation findings and no false pass.
3. Test inactive/missing references, wrong version/term/offering/semester/division, audience strength, exact slot boundaries, breaks, operating hours, Saturday cutoff, practical consecutive periods and unknown availability.
4. Test `OVERRIDDEN` availability explicitly. Current expected safe behavior is blocking until policy/validator support is resolved; do not expect publication to pass based solely on an override marker.
5. Call readiness API with one missing prerequisite at a time; verify reasons identify exact missing configuration and are not hidden by synthetic defaults.

### Timetable lifecycle and visibility

1. Create an empty draft and verify review submission blocked.
2. Create a valid synthetic timetable; validate; submit for review as permitted reviewer; verify ordinary draft edits are rejected.
3. Request changes with a required comment and verify return to DRAFT and action history.
4. Approve as permitted approver; verify unauthorized role is rejected and fresh validation is required.
5. Publish as authorized publisher; verify status/timestamp, approval action, audit record and faculty-visible sessions.
6. Publish a replacement; assert same transaction archives old version and publishes new one, only one published version exists, old history/sessions remain retained, and faculty APIs return only new published sessions.
7. Force validation, permission, trigger, or DB failure at each transition; verify transaction rollback and no partial status/audit/session change.
8. Verify Faculty timetable filters (year/term/semester) cannot access another faculty's sessions or non-published version IDs.
9. Student timetable remains unavailable until student-to-section/elective mapping and scoped API are implemented; no test may synthesize identity mapping by guessing.

### Workload import

1. Upload/preview a synthetic source with exact, duplicate, ambiguous, missing and schema-invalid fields.
2. Verify original row values and serials remain unchanged; preview does not mutate master data.
3. Review/resolve a staged row, validate all mappings, and exercise planned promotion only if the existing API supports it and approval authorizes it.
4. Read back every affected row and assert no unselected faculty/course/offering/assignment records changed.

### Reports and audit

1. Inventory actual dashboard cards and table search/filter/pagination controls in the browser. For each, compare API counts/results to database query results and test empty/error states.
2. General report/export workflow is not presently identified; record absent routes/UI as an incomplete feature, not a test pass.
3. Inspect audit/action rows after create/update/retire/review/assignment/import/validation/publish; verify actor, action, target, timestamp and context, plus retention/append-only behavior.

## Phase D — Retest and regression

After each fix:

1. Add or update a focused database-independent regression test where logic can be isolated.
2. Run the focused test and all database-independent Node tests.
3. Run backend and frontend typechecks and frontend production build.
4. Run relevant API/browser tests only against the approved disposable DB and authenticated page.
5. Re-run affected workflows and assert no cross-context leaks, duplicate offerings, draft visibility, or unrelated data changes.
6. Record exact command, test count/result, DB target alias (never secret), and browser role/page in `docs/FUNCTIONAL_AUDIT.md`.

## Current blockers

- No browser pages are shared; authenticated role workflows cannot be honestly tested yet.
- No verified, approved disposable database is available. Existing `slotify_test` is incomplete and the DB test global setup resets its selected target.
- Migration 009 (curriculum drafts) and 008 (room practical approval) were not applied.
- Student-to-division/elective mapping is missing.
- Availability override policy and validator behavior are unresolved; current validator blocks UNKNOWN.
- Real academic/curriculum/room/workload source data and several institutional policies require authoritative confirmation.
