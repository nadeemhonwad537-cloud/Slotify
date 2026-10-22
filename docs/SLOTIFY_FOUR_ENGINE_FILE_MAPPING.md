# Slotify Four-Engine File Mapping

**Inspection date:** 2026-10-22  
**Project root:** `C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\`  
**Inspection type:** Read-only code and filesystem inspection. No app startup, MySQL connection, migration, seed, reset, import, account-bootstrap command, or test execution was performed for this document.

## Team mapping supplied for this audit

| Engine | Academic area | Team member | SRN |
|---|---|---|---|
| E1 | DSA | Mitali Bilagi | `02fe24bcs112` |
| E2 | Web Development | Vinay Boomannavara | `02fe24bcs037` |
| E3 | Operating Systems | K. Shreya | `02fe24bcs117` |
| E4 | DBMS | Nadeem Honawad | `02fe24bcs109` |

These are the requested team assignments. No independent official guide document was found during this task to validate academic ownership/definitions.

## Status and verification legend

- **Implemented:** source implements the responsibility described; this is not a claim of end-to-end operational verification.
- **Partial:** a part of the described responsibility exists, with substantive gaps or integration not verified.
- **Test-only:** a test file exercises rules/fixtures; it is not runtime application functionality.
- **Configuration-only:** declares scripts, paths, or settings.
- **Not found:** the requested capability was not found in the scanned source.
- **Code inspection:** confirmed by reading source; no test run is implied.
- **Prior test file exists:** test source exists, but no test was executed during this inventory.

## E1 — DSA: timetable constraints, conflicts, and scheduling logic

| Engine | Exact relative path | Filename | Responsibility / evidence in code | Status | Verification |
|---|---|---|---|---|---|
| E1 | `backend/src/services/validationService.ts` | `validationService.ts` | `computeValidation` loads sessions, audiences, faculty and configuration and accumulates structured constraint issues; `runValidationAndPersist` records validation results. Includes faculty overlap, room double-booking, audience overlap, availability, context, capacity, room suitability and practical checks. | Implemented validation; generation not present in this file | Code inspection |
| E1 | `backend/src/services/schedulingConfiguration.ts` | `schedulingConfiguration.ts` | `validateSchedulingConfiguration`, `validateAvailability`, `validateConsecutivePeriods`, `validateRoomCapacity`, `validateRoomSuitability`, `validateSessionGrid`, and audience-scope helpers encode scheduling constraints. | Implemented rule logic; integration depends on DB-loaded configuration | Code inspection |
| E1 | `backend/src/rules/scheduleRules.ts` | `scheduleRules.ts` | Scheduling policy constants and rule configuration used by configuration checks. | Partial / policy-backed | Code inspection |
| E1 | `backend/src/services/timetableSessionRules.ts` | `timetableSessionRules.ts` | `buildTimetableSlotOptions`/session helpers determine valid slot choices, duration, adjacency, audience references and write-input constraints. | Implemented domain rules; no schedule search | Code inspection |
| E1 | `backend/src/services/timetableLifecycleRules.ts` | `timetableLifecycleRules.ts` | Pure predicates for review, approval, publish preconditions, actor-role choice and academic-context consistency. | Implemented lifecycle rules; not a generation algorithm | Code inspection |
| E1 | `backend/src/services/academicTermRules.ts` | `academicTermRules.ts` | Odd/even semester mapping and parity selection logic. | Implemented helper logic | Code inspection |
| E1 | `backend/src/services/allocationRules.ts` | `allocationRules.ts` | Allocation eligibility and workload calculation helpers used during faculty assignment planning. | Implemented allocation rules; not timetable generation | Code inspection |
| E1 | `backend/src/services/workloadService.ts` | `workloadService.ts` | `computeWorkload` loads assignment/policy rows, separates confirmed/unconfirmed workload and checks designation limits. | Implemented DB-backed calculation; live query not verified here | Code inspection |
| E1 | `backend/src/routes/timetable.ts` | `timetable.ts` | `POST /validate` routes dry-run to `computeValidation` and persisted validation to `runValidationAndPersist`; `POST /versions` creates an empty draft. Comment explicitly says no sessions are generated there. | Validation endpoint implemented; generator endpoint not found | Code inspection |
| E1 | `backend/src/services/schedulingConfigurationService.ts` | `schedulingConfigurationService.ts` | `getSchedulingConfiguration` reads mapped semesters, divisions, rooms, room availability, teaching days/slots and workload-rule status, then applies configuration checks. | Implemented read/readiness path; DB response unverified | Code inspection |
| E1 | `frontend/src/pages/admin/ValidationPage.tsx` | `ValidationPage.tsx` | Admin configuration readiness check, **Dry Run (Preview)** (`dry_run: true`), and **Run & Save** UI; the preview is distinct from generation. | Implemented interface; browser workflow not verified | Code inspection |
| E1 | `frontend/src/pages/admin/TimetableVersionsPage.tsx` | `TimetableVersionsPage.tsx` | Manual timetable version/session editing and lifecycle UI; no automatic session generation observed. | Partial manual editor; not generator | Code inspection |
| E1 | `backend/tests/schedulingConfiguration.node.test.ts` | `schedulingConfiguration.node.test.ts` | Test source includes configuration, room/capacity, practical approval, time-grid, availability and batch-strength cases. | Test-only | Prior test file exists |
| E1 | `backend/tests/scheduleRules.node.test.ts` | `scheduleRules.node.test.ts` | Test source for scheduling rule behaviors. | Test-only | Prior test file exists |
| E1 | `backend/tests/timetableSessionRules.node.test.ts` | `timetableSessionRules.node.test.ts` | Test source for adjacent-slot/session-option constraints and session-input rules. | Test-only | Prior test file exists |
| E1 | `backend/tests/timetableLifecycleRules.node.test.ts` | `timetableLifecycleRules.node.test.ts` | Test source for lifecycle preconditions and academic context checks; does not test a generator. | Test-only | Prior test file exists |
| E1 | `backend/tests/api.timetable.test.ts` | `api.timetable.test.ts` | Database-backed API test source for timetable routes. Vitest global setup resets/applies schema; not run for this inventory. | Test-only; DB-dependent | Code inspection; not executed |

### E1 finding: generation is not implemented

No callable timetable-generation algorithm, generator service, route, or UI action was found. The route creates an **empty draft** and explicitly says generation is a separate milestone. `computeValidation` checks an existing timetable; it does not construct one. No unplaced-session output from a generator exists. Sorting/query ordering and rule checks in the application are not evidence of an automatic scheduling engine.

## E2 — Web Development: UI, API, authentication and workflows

### Frontend entry, routing and shared UI

| Engine | Exact relative path | Filename | Responsibility / evidence in code | Status | Verification |
|---|---|---|---|---|---|
| E2 | `frontend/src/main.tsx` | `main.tsx` | React `createRoot` entry; mounts the application provider tree. | Implemented entry point | Code inspection |
| E2 | `frontend/src/App.tsx` | `App.tsx` | App shell/provider composition and `AppRouter` rendering. | Implemented | Code inspection |
| E2 | `frontend/src/router/index.tsx` | `index.tsx` | `AppRouter`, `RequireAuth`, role redirects, and Admin/Faculty/Student route tree. | Implemented routing; dynamic role checks require backend auth state | Code inspection |
| E2 | `frontend/src/contexts/AuthContext.tsx` | `AuthContext.tsx` | Frontend authentication state and login/logout/session interactions. | Implemented interface; not browser verified here | Code inspection |
| E2 | `frontend/src/lib/api.ts` | `api.ts` | Shared HTTP/API client and response handling. | Implemented integration layer | Code inspection |
| E2 | `frontend/src/lib/queryClient.ts` | `queryClient.ts` | TanStack Query client configuration. | Configuration / shared UI infrastructure | Code inspection |
| E2 | `frontend/src/components/layout/AdminShell.tsx` | `AdminShell.tsx` | Admin navigation, portal shell and logout control. | Implemented | Code inspection |
| E2 | `frontend/src/components/layout/FacultyShell.tsx` | `FacultyShell.tsx` | Faculty navigation/shell and submission-related gating. | Implemented | Code inspection |
| E2 | `frontend/src/components/layout/StudentShell.tsx` | `StudentShell.tsx` | Student portal navigation/shell. | Implemented; data scope has a known gap | Code inspection |
| E2 | `frontend/src/components/ui/Badge.tsx` | `Badge.tsx` | Status and label presentation components. | Shared UI | Code inspection |
| E2 | `frontend/src/components/ui/Card.tsx` | `Card.tsx` | Reusable page card component. | Shared UI | Code inspection |
| E2 | `frontend/src/components/ui/DataTable.tsx` | `DataTable.tsx` | Reusable tabular presentation component. | Shared UI | Code inspection |
| E2 | `frontend/src/components/ui/EmptyState.tsx` | `EmptyState.tsx` | Empty-result presentation. | Shared UI | Code inspection |
| E2 | `frontend/src/components/ui/ErrorMessage.tsx` | `ErrorMessage.tsx` | Error and form error presentation. | Shared UI | Code inspection |
| E2 | `frontend/src/components/ui/LoadingScreen.tsx` | `LoadingScreen.tsx` | Loading presentation. | Shared UI | Code inspection |
| E2 | `frontend/src/components/ui/Modal.tsx` | `Modal.tsx` | Modal and confirmation UI. | Shared UI | Code inspection |
| E2 | `frontend/src/components/ui/PageHeader.tsx` | `PageHeader.tsx` | Reusable page title/actions header. | Shared UI | Code inspection |
| E2 | `frontend/src/components/faculty/FacultyProfileStatus.tsx` | `FacultyProfileStatus.tsx` | Faculty profile linkage status display. | Implemented component | Code inspection |
| E2 | `frontend/src/components/faculty/FacultyTermContextSelector.tsx` | `FacultyTermContextSelector.tsx` | Faculty academic-term context selection UI. | Implemented component | Code inspection |
| E2 | `frontend/src/hooks/useFacultyProfile.ts` | `useFacultyProfile.ts` | Shared faculty-profile query hook. | Implemented hook | Code inspection |
| E2 | `frontend/src/types/index.ts` | `index.ts` | Shared API/domain TypeScript types. | Shared type definitions | Code inspection |

### Frontend feature pages

| Engine | Exact relative path | Filename | Responsibility / evidence in code | Status | Verification |
|---|---|---|---|---|---|
| E2 | `frontend/src/pages/auth/LoginPage.tsx` | `LoginPage.tsx` | Login form and API interaction. | Implemented UI; auth flow not browser verified | Code inspection |
| E2 | `frontend/src/pages/admin/DashboardPage.tsx` | `DashboardPage.tsx` | Admin summary view. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/admin/UsersPage.tsx` | `UsersPage.tsx` | User administration UI. | Implemented UI; writes not tested | Code inspection |
| E2 | `frontend/src/pages/admin/DepartmentsPage.tsx` | `DepartmentsPage.tsx` | Department master-data UI. | Implemented UI; writes not tested | Code inspection |
| E2 | `frontend/src/pages/admin/AcademicStructurePage.tsx` | `AcademicStructurePage.tsx` | Academic years, terms, programs/schemes/semesters, mappings, divisions and batches UI. | Implemented UI; DB workflow unverified | Code inspection |
| E2 | `frontend/src/pages/admin/CoursesPage.tsx` | `CoursesPage.tsx` | Courses, components, offerings and curriculum tab UI. | Implemented UI; persistence unverified | Code inspection |
| E2 | `frontend/src/pages/admin/CurriculumBuilder.tsx` | `CurriculumBuilder.tsx` | Curriculum editor, audience selection, draft and publish interactions. | Implemented UI; migration/persistence dependency | Code inspection |
| E2 | `frontend/src/pages/admin/FacultyPage.tsx` | `FacultyPage.tsx` | Faculty profile and workload administration UI. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/admin/RoomsPage.tsx` | `RoomsPage.tsx` | Room/lab and settings UI. | Implemented UI; migration 008 support may be absent | Code inspection |
| E2 | `frontend/src/pages/admin/SubmissionsPage.tsx` | `SubmissionsPage.tsx` | Faculty submission review UI. | Implemented UI; reviewer DB workflow unverified | Code inspection |
| E2 | `frontend/src/pages/admin/AssignmentsPage.tsx` | `AssignmentsPage.tsx` | Assignment management and allocation planner container. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/admin/AllocationPlanner.tsx` | `AllocationPlanner.tsx` | Allocation planning and validation UI. | Implemented UI; DB finalization unverified | Code inspection |
| E2 | `frontend/src/pages/admin/ValidationPage.tsx` | `ValidationPage.tsx` | Readiness, validation preview and persisted validation controls. | Implemented UI; controls differ in write behavior | Code inspection |
| E2 | `frontend/src/pages/admin/TimetableVersionsPage.tsx` | `TimetableVersionsPage.tsx` | Version/session editor, validation and lifecycle controls. | Implemented UI; DB transitions not verified | Code inspection |
| E2 | `frontend/src/pages/admin/WorkloadImportPage.tsx` | `WorkloadImportPage.tsx` | Workload import review interface. | Partial workflow; do not infer promotion is completed | Code inspection |
| E2 | `frontend/src/pages/faculty/DashboardPage.tsx` | `DashboardPage.tsx` | Faculty dashboard. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/faculty/PreferencesPage.tsx` | `PreferencesPage.tsx` | Faculty subject preference workflow. | Implemented UI; real save/submit unverified | Code inspection |
| E2 | `frontend/src/pages/faculty/AvailabilityPage.tsx` | `AvailabilityPage.tsx` | Faculty availability editor. | Implemented UI; real save and override behavior unverified | Code inspection |
| E2 | `frontend/src/pages/faculty/AssignedSubjectsPage.tsx` | `AssignedSubjectsPage.tsx` | Faculty assignment display. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/faculty/WorkloadPage.tsx` | `WorkloadPage.tsx` | Faculty workload display. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/faculty/TimetablePage.tsx` | `TimetablePage.tsx` | Faculty timetable access UI. | Implemented surface; requires published version and verified account scope | Code inspection |
| E2 | `frontend/src/pages/faculty/ProfilePage.tsx` | `ProfilePage.tsx` | Faculty account/profile page. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/faculty/TrackPage.tsx` | `TrackPage.tsx` | Faculty workflow/assignment tracking UI. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/student/DashboardPage.tsx` | `DashboardPage.tsx` | Student dashboard. | Implemented UI | Code inspection |
| E2 | `frontend/src/pages/student/SubjectsPage.tsx` | `SubjectsPage.tsx` | Displays active courses; page explicitly states it is not restricted to the student's semester/section. | Partial; not student scoped | Code inspection |
| E2 | `frontend/src/pages/student/TimetablePage.tsx` | `TimetablePage.tsx` | Displays an explicit unavailable notice due to missing student mapping/API. | Feature not implemented | Code inspection |

### Backend API, middleware and workflow services

| Engine | Exact relative path | Filename | Responsibility / evidence in code | Status | Verification |
|---|---|---|---|---|---|
| E2 | `backend/src/server.ts` | `server.ts` | Server entry; calls `createApp().listen(env.PORT, ...)`. | Implemented entry point | Code inspection |
| E2 | `backend/src/app.ts` | `app.ts` | Express app, Helmet/CORS/JSON/cookies/CSRF middleware, health endpoint and route mounts. | Implemented API composition | Code inspection |
| E2 | `backend/src/routes/auth.ts` | `auth.ts` | CSRF token, login, refresh, logout, `/me`, change-password endpoints. | Implemented endpoints; DB writes on auth lifecycle | Code inspection |
| E2 | `backend/src/routes/users.ts` | `users.ts` | User administration endpoints. | Implemented API surface | Code inspection |
| E2 | `backend/src/routes/masterdata.ts` | `masterdata.ts` | Academic/curriculum endpoints and generated CRUD routes for master data. | Implemented API surface; persistence not exercised | Code inspection |
| E2 | `backend/src/routes/submissions.ts` | `submissions.ts` | Faculty-owned profile/submission/availability and reviewer routes. | Implemented API surface; access/persistence not exercised | Code inspection |
| E2 | `backend/src/routes/assignments.ts` | `assignments.ts` | Allocation plan/validate/finalize, assignment CRUD/approval and workload endpoints. | Implemented API surface; writes not exercised | Code inspection |
| E2 | `backend/src/routes/workloadImports.ts` | `workloadImports.ts` | Workload import staging and review API. | Partial workflow; DB writes not exercised | Code inspection |
| E2 | `backend/src/routes/timetable.ts` | `timetable.ts` | Configuration readiness, timetable validation, versions, sessions, faculty timetable, review/approval/publish routes. No generator endpoint was found. | Implemented manual/validation routes; generation absent | Code inspection |
| E2 | `backend/src/routes/admin.ts` | `admin.ts` | Admin dashboard/readiness summary endpoints. | Implemented read endpoints | Code inspection |
| E2 | `backend/src/middleware/auth.ts` | `auth.ts` | `authenticate` reads the HttpOnly access cookie and refreshes roles from DB; `requirePermission` checks configured DB grants. | Implemented middleware; not runtime verified | Code inspection |
| E2 | `backend/src/middleware/security.ts` | `security.ts` | Cookie policy and double-submit CSRF/Origin checks. | Implemented security middleware; not runtime verified | Code inspection |
| E2 | `backend/src/middleware/error.ts` | `error.ts` | Express error/not-found/response helpers. | Shared API infrastructure | Code inspection |
| E2 | `backend/src/services/authService.ts` | `authService.ts` | Password verification, JWTs, refresh rotation/revocation, role lookup and password change. | Implemented auth logic; DB-backed behavior unverified | Code inspection |
| E2 | `backend/src/services/submissionService.ts` | `submissionService.ts` | Faculty submission persistence and workflow logic. | Implemented service; integration unverified | Code inspection |
| E2 | `backend/src/services/facultyTimetableService.ts` | `facultyTimetableService.ts` | Selects academic contexts and published sessions through authenticated user’s active faculty profile and approved assignments. | Implemented scope query; access not integration-tested | Code inspection |
| E2 | `backend/src/services/curriculumBuilder.ts` | `curriculumBuilder.ts` | Curriculum payload validation and business rules used by endpoints/editor. | Implemented domain service | Code inspection |
| E2 | `backend/src/utils/crud.ts` | `crud.ts` | Shared Express CRUD router/data operations for master-data resources. | Shared API infrastructure | Code inspection |
| E2 | `backend/src/utils/errors.ts` | `errors.ts` | HTTP error representation and helpers. | Shared API infrastructure | Code inspection |
| E2 | `backend/src/utils/zodHelpers.ts` | `zodHelpers.ts` | Shared request validation helpers. | Shared API infrastructure | Code inspection |

## E3 — Operating Systems: concurrency and resource coordination

| Engine | Exact relative path | Filename | Responsibility / evidence in code | Status | Verification |
|---|---|---|---|---|---|
| E3 | `backend/src/db/pool.ts` | `pool.ts` | MySQL pool and `withTransaction`; transaction commits on successful callback and rolls back on thrown error. | Partial concurrency/data-integrity primitive; not an OS algorithm | Code inspection |
| E3 | `backend/src/routes/timetable.ts` | `timetable.ts` | Version creation uses a term row `FOR UPDATE` lock while allocating `version_no`; wraps creation in `withTransaction`. | Implemented locking for this operation; concurrent outcome untested | Code inspection |
| E3 | `backend/src/services/timetableLifecycleService.ts` | `timetableLifecycleService.ts` | `lockTimetableContext` locks term and version rows; lifecycle operations run transactions; publication locks current published version for the term. | Implemented DB coordination; races/rollback not tested | Code inspection |
| E3 | `backend/src/services/timetableSessionService.ts` | `timetableSessionService.ts` | Draft-version/session row locks and transactions guard manual session create/update/delete. | Implemented DB coordination; concurrency behavior not tested | Code inspection |
| E3 | `backend/src/routes/masterdata.ts` | `masterdata.ts` | Context checks and some master-data changes use row locks/transactions, including curriculum draft optimistic version checks. | Partial concurrency control in selected workflows | Code inspection |
| E3 | `backend/src/routes/assignments.ts` | `assignments.ts` | Assignment/allocation changes include transactional sections; workload revalidation is part of mutation flow. | Partial coordination; concurrent assignment races untested | Code inspection |
| E3 | `backend/src/services/timetableLifecycleRules.ts` | `timetableLifecycleRules.ts` | Pure transition predicates; not process/thread scheduling. | Implemented state rules; not an OS engine by itself | Code inspection |
| E3 | `backend/tests/timetableLifecycleRules.node.test.ts` | `timetableLifecycleRules.node.test.ts` | Rule tests cover status/permission/validation preconditions, not simultaneous transactions. | Test-only; no concurrency test | Code inspection of test source |
| E3 | `backend/tests/timetableSessionRules.node.test.ts` | `timetableSessionRules.node.test.ts` | Session input/slot rules, not concurrent database execution. | Test-only; no concurrency test | Code inspection of test source |

### E3 finding

There is concrete MySQL transaction and row-locking code in select workflows. This is meaningful DB transaction coordination, but the repository does not demonstrate a distinct OS scheduler, parallel worker/job system, semaphore/mutex abstraction, or tested race-resolution engine. JavaScript async functions and Node's event loop are not counted as an implemented OS-engine feature. No multi-client concurrency test was run or found in the listed test set.

## E4 — DBMS: schema, persistence, constraints and audit

| Engine | Exact relative path | Filename | Responsibility / evidence in code | Status | Verification |
|---|---|---|---|---|---|
| E4 | `backend/src/config/env.ts` | `env.ts` | Validates DB host/port/user/password/name and application settings from process environment/dotenv. | Configuration-only; no DB access itself | Code inspection; secret values not read |
| E4 | `backend/src/db/pool.ts` | `pool.ts` | Configured MySQL pool, parameterized `query`/`exec`, `withTransaction`. | Implemented persistence infrastructure | Code inspection |
| E4 | `backend/src/db/migrate.ts` | `migrate.ts` | Sorted SQL migration runner, checksum/history table, optional reference seeding. | Implemented setup tooling; not run | Code inspection |
| E4 | `backend/src/db/reset.ts` | `reset.ts` | Drops every base table in configured DB unless production; no protected DB name guard. | Destructive tooling; not run | Code inspection |
| E4 | `database/migrations/001_core.sql` | `001_core.sql` | Core relational entities, users/roles/permissions and academic/master-data schema. | Schema source; applied state not confirmed here | Code inspection |
| E4 | `database/migrations/002_timetable.sql` | `002_timetable.sql` | Timetable versions/sessions/approval structures, constraints and immutability/approval triggers. | Schema source; migration has trigger prerequisites | Code inspection |
| E4 | `database/migrations/002_workload_import_review.sql` | `002_workload_import_review.sql` | Workload import review schema. | Schema source | Code inspection |
| E4 | `database/migrations/003_audit_logs.sql` | `003_audit_logs.sql` | `audit_logs` table, indexes and actor foreign key. | Schema source | Code inspection |
| E4 | `database/migrations/003_workload_import_summary.sql` | `003_workload_import_summary.sql` | Workload import summary schema changes. | Schema source | Code inspection |
| E4 | `database/migrations/004_faculty_source_subject_preferences.sql` | `004_faculty_source_subject_preferences.sql` | Faculty source-subject/preference schema. | Schema source | Code inspection |
| E4 | `database/migrations/005_term_program_semesters.sql` | `005_term_program_semesters.sql` | Term/program/scheme/semester mapping structure. | Schema source | Code inspection |
| E4 | `database/migrations/006_room_location.sql` | `006_room_location.sql` | Room location schema. | Schema source | Code inspection |
| E4 | `database/migrations/007_preference_curriculum_context.sql` | `007_preference_curriculum_context.sql` | Preference/curriculum context schema changes. | Schema source | Code inspection |
| E4 | `database/migrations/008_room_practical_approval.sql` | `008_room_practical_approval.sql` | Adds `rooms.practical_approved`, default false. | Schema source; prior audit says unapplied; not applied here | Code inspection |
| E4 | `database/migrations/009_curriculum_drafts.sql` | `009_curriculum_drafts.sql` | Adds context-keyed JSON curriculum drafts with optimistic version column and FKs. | Schema source; prior audit says unapplied; not applied here | Code inspection |
| E4 | `database/seeds/reference/001_reference_data.sql` | `001_reference_data.sql` | Idempotent reference permissions, room types, workload designations/policies; no demo user or institutional dataset. | Seed source; not run | Code inspection |
| E4 | `backend/src/services/audit.ts` | `audit.ts` | Shared application writes to audit history. | Implemented helper; completeness/readback unverified | Code inspection |
| E4 | `backend/src/services/timetableLifecycleService.ts` | `timetableLifecycleService.ts` | Persists lifecycle status transitions, approval actions and audit entries transactionally. | Implemented service; DB behavior unverified | Code inspection |
| E4 | `backend/src/services/timetableSessionService.ts` | `timetableSessionService.ts` | Persists scheduled sessions and audience/faculty links. | Implemented service; DB behavior unverified | Code inspection |
| E4 | `backend/src/services/schedulingConfigurationService.ts` | `schedulingConfigurationService.ts` | Read-only SQL queries assemble term readiness inputs from relational tables. | Implemented read service; live data unverified | Code inspection |
| E4 | `backend/src/services/validationService.ts` | `validationService.ts` | SQL reads configuration/session relationships; persisted mode inserts validation runs/issues and updates version status. | Implemented DB-backed service; not executed here | Code inspection |
| E4 | `backend/src/services/workloadService.ts` | `workloadService.ts` | SQL reads assignments, counting policies, faculty designation and workload rules. | Implemented DB-backed calculation | Code inspection |
| E4 | `backend/src/services/submissionService.ts` | `submissionService.ts` | Faculty submissions/preferences persistence. | Implemented DB-backed service | Code inspection |
| E4 | `backend/src/services/workloadImportService.ts` | `workloadImportService.ts` | Transactional import staging/provenance/discrepancy persistence. | Implemented importer; one script explicitly targets `slotify_dev`; do not use for demo | Code inspection |
| E4 | `backend/src/routes/masterdata.ts` | `masterdata.ts` | SQL-backed CRUD, curriculum draft save/update/delete/publish; checks schema presence for `curriculum_drafts`. | Implemented DB routes; draft path depends on migration 009 | Code inspection |
| E4 | `backend/src/routes/assignments.ts` | `assignments.ts` | SQL-backed allocation, assignment and workload APIs. | Implemented DB routes; not integration-verified | Code inspection |
| E4 | `backend/src/routes/submissions.ts` | `submissions.ts` | SQL-backed faculty submission, profile and availability endpoints. | Implemented DB routes; not integration-verified | Code inspection |
| E4 | `backend/src/routes/timetable.ts` | `timetable.ts` | SQL-backed versions, validation, sessions, lifecycle dispatch and faculty timetable reads. | Implemented DB routes; migration/permissions unverified | Code inspection |
| E4 | `backend/tests/db.constraints.test.ts` | `db.constraints.test.ts` | Database constraint integration test source. | Test-only; not run | Code inspection of test source |
| E4 | `backend/tests/globalSetup.ts` | `globalSetup.ts` | Vitest global setup calls DB reset, migrations and reference seeding after disposable DB safety resolution. | Test configuration/setup; destructive effects; not run | Code inspection |
| E4 | `backend/vitest.config.ts` | `vitest.config.ts` | Loads `.env`, resolves disposable DB target and defines Vitest global setup/environment. | Configuration-only; full suite intentionally not run | Code inspection |

## Shared infrastructure (not forced into a single engine)

| Shared area | Exact relative paths | Why shared |
|---|---|---|
| Frontend API/auth integration | `frontend/src/contexts/AuthContext.tsx`; `frontend/src/lib/api.ts`; `frontend/src/router/index.tsx` | Connects UI sessions, API requests and role navigation. |
| Request security and errors | `backend/src/middleware/auth.ts`; `backend/src/middleware/security.ts`; `backend/src/middleware/error.ts`; `backend/src/utils/errors.ts`; `backend/src/utils/zodHelpers.ts` | Cross-cutting API behavior and validation boundary. |
| Data access and CRUD | `backend/src/db/pool.ts`; `backend/src/utils/crud.ts` | Shared DB and route infrastructure supporting multiple workflows/engines. |
| Workload import | `backend/src/services/workloadImportPreview.ts`; `backend/src/services/workloadImportService.ts`; `backend/src/routes/workloadImports.ts`; `backend/src/scripts/previewWorkloadImport.ts`; `backend/src/scripts/planWorkloadImport.ts`; `backend/src/scripts/importWorkloadSource.ts`; `backend/src/scripts/verifyWorkloadImport.ts`; `frontend/src/pages/admin/WorkloadImportPage.tsx` | Crosses UI, application workflow, parsing/validation, and persistence; not uniquely owned by one academic engine. |
| Build/runtime configuration | `backend/package.json`; `backend/tsconfig.json`; `frontend/package.json`; `frontend/tsconfig.json`; `frontend/vite.config.ts`; `frontend/tailwind.config.js`; `frontend/postcss.config.js`; `frontend/index.html`; `frontend/src/index.css` | Tooling/configuration rather than academic-engine implementation. |

## Entry points and actual connections

1. **Frontend entry:** `frontend/index.html` contains the page root; `frontend/src/main.tsx` calls React `createRoot` and mounts `frontend/src/App.tsx`.
2. **Frontend routing:** `frontend/src/App.tsx` renders `frontend/src/router/index.tsx`. `AppRouter` defines `/login`, Admin paths under `/admin`, Faculty under `/faculty`, and Student under `/student`, guarded by authentication/role state.
3. **Frontend HTTP client:** feature pages call the shared client in `frontend/src/lib/api.ts`. Vite configuration in `frontend/vite.config.ts` proxies `/api` to `http://localhost:4000`.
4. **Backend entry:** `backend/src/server.ts` imports `createApp` from `backend/src/app.ts` and listens on configured `env.PORT`.
5. **Backend route path:** `backend/src/app.ts` applies Helmet, CORS, JSON parsing, cookie parsing and CSRF protection, mounts `/api/auth`, `/api/users`, `/api/masterdata`, `/api/faculty-submissions`, `/api/faculty-availability`, `/api/assignments`, `/api/workload-imports`, `/api/timetable`, and `/api/admin`.
6. **Authentication/authorization:** protected routers use `authenticate` and `requirePermission` from `backend/src/middleware/auth.ts`; role/permission checks query DB-backed records. Auth tokens/session logic is in `backend/src/services/authService.ts`.
7. **Database connection:** `backend/src/config/env.ts` validates environment values; `backend/src/db/pool.ts` creates the MySQL pool and supplies parameterized query/transaction helpers.
8. **Migrations/seeds:** `backend/src/db/migrate.ts` sorts migration filenames, tracks checksums in `schema_migrations`, applies outstanding SQL and optionally seeds reference records. `backend/src/db/reset.ts` drops all base tables in its configured schema. These were not executed for this audit.
9. **Readiness:** Admin page `frontend/src/pages/admin/ValidationPage.tsx` invokes `GET /api/timetable/configuration/:termId`; `backend/src/routes/timetable.ts` calls `getSchedulingConfiguration` in `backend/src/services/schedulingConfigurationService.ts`, which reads DB configuration and evaluates the rule functions in `backend/src/services/schedulingConfiguration.ts`.
10. **Dry-run validation:** same Admin page sends `POST /api/timetable/validate` with `{ version_id, dry_run: true }`; route calls `computeValidation` from `backend/src/services/validationService.ts` and does not call persistence in that branch. **Run & Save** sends `dry_run: false` and persists a validation run; the two controls must not be conflated.
11. **Timetable generation:** no generator route/service/algorithm was found. `POST /api/timetable/versions` creates an empty draft, and `TimetableVersionsPage.tsx` supports manual session editing. Validation is not generation.
12. **Tests:** `backend/tests/*.node.test.ts` are plain Node test files intended for DB-independent logic. Vitest uses `backend/vitest.config.ts` and `backend/tests/globalSetup.ts`; the latter resets the selected database, migrates and seeds. The existence of API test files does not establish that those tests are safe to run without the configured disposable target.

## Engine summary

| Engine | Main source folders | Implemented | Partial / missing | Evidence basis |
|---|---|---|---|---|
| E1 — DSA | `backend/src/services/`, `backend/src/rules/`, `backend/src/routes/timetable.ts`, `frontend/src/pages/admin/ValidationPage.tsx` | Constraint/readiness checks, conflict validation, time-slot and capacity/suitability rules, manual session validation. | Automatic coordinated timetable generation and generator infeasibility/unplaced-session output were not found. | Source inspection; relevant test files exist but were not run for this task. |
| E2 — Web Development | `frontend/src/`, `backend/src/routes/`, `backend/src/middleware/`, `backend/src/services/` | React role-based pages/router, API client, Express routes, forms and authentication/permission interfaces. | End-to-end auth, persistence and role workflows are not verified by this inventory; Student scoping has a known gap. | Source inspection only. |
| E3 — Operating Systems | DB coordination in `backend/src/db/` and selected route/service workflows | Transactions and `FOR UPDATE` locks in version creation, lifecycle, sessions and selected master-data operations. | No OS scheduler, parallel worker system, or concurrency stress/race test identified; transaction correctness is unverified at runtime. | Source inspection only; rule tests do not prove concurrent DB behavior. |
| E4 — DBMS | `database/migrations/`, `database/seeds/`, `backend/src/db/`, SQL in route/service files | Relational schema definitions, FKs/indexes/constraints, query layer, migrations, reference seed, transactions and audit write helper. | Applied migration state, live persistence, rollback, deployed grants and migration-008/009 availability are not established by source presence. | Source inspection only; no database access or integration test. |

## Exclusions and accuracy notes

- Excluded folders: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.vite`, `.cache`, and `__pycache__`.
- `.env` is mentioned only as a filename where applicable; no secret values are included.
- No controllers folder, automatic generator folder, or generator source was present in the scanned tree; none has been invented.
- “Implemented” in a file mapping describes source capability, not a verified end-to-end feature.
- No tests, database workflows, migrations, or application startup were executed for this file audit.
