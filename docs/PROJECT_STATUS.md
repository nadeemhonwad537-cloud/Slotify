# Slotify Project Status and Roadmap

**Audit date:** 2026-10-21  
**Scope:** Scheduling-configuration validation and read-only configuration inspection. No database records were changed and no migrations were run. Migration 008 was added for explicit classroom practical approval but remains unapplied.

## Follow-up — timetable review and publication (2026-10-22)

- The existing timetable schema already had the lifecycle statuses, `approval_actions`, audit logs, immutable-publication triggers, one-published-version-per-term constraint, and role permissions. The missing part was the API/UI transition workflow; no schema migration was required.
- The reference permission seed grants ADMIN `timetable:review` and provisional `timetable:publish`; COORDINATOR `timetable:review` and `timetable:approve` are provisional. Backend routes enforce the configured grants; live database grants were not queried. `REJECTED` exists in the enum but this workflow uses request-changes back to DRAFT rather than a reject action.
- Added explicit review submission, request-changes, approval, and publication transitions. Validation is rerun at submission, approval, and publication. Publication is transactional and term-serialized; it archives the previous published version and publishes the replacement atomically.
- Added blocking validation for empty versions, inconsistent version/term/offering/division/curriculum context, inactive or unverified references, and faculty assignments that no longer match the scheduled audience.
- Faculty session retrieval remains limited to the authenticated faculty member and `PUBLISHED` versions. Student timetable access remains blocked because the schema has no student-to-division mapping or student-scoped API. Automatic timetable generation is still not implemented.
- Backend typecheck passed, focused database-independent tests passed (12/12), and the frontend production build passed with the existing >500 kB chunk warning. No database-backed tests, browser verification, database writes, or migrations were performed.

## Current functional-audit snapshot (2026-10-22)

The detailed evidence matrix and reproducible test plan are [FUNCTIONAL_AUDIT.md](./FUNCTIONAL_AUDIT.md) and [TEST_PLAN.md](./TEST_PLAN.md). This snapshot supersedes the older feature-status labels below wherever they conflict.

| Measure | Current count | Meaning |
|---|---:|---|
| Feature groups inventoried | 25 | The project’s existing 25-row scope inventory; covers Admin, Faculty, Student, API, schema, import and cross-cutting areas |
| PASS / fully end-to-end verified in this audit | 0 | No role-authenticated UI → API → database workflow was run |
| PARTIAL | 18 | Implementation and/or rule-level evidence exists, but workflow is incomplete or not fully verified |
| BLOCKED | 7 | Safe valid test requires unavailable database/browser, missing mapping/data or approved institutional policy |
| FAIL | 0 | No new end-to-end failing workflow was exercised; this is not evidence of no defects |
| NOT TESTED | 0 | All groups have at least a source-inspection finding or concrete blocker; this does not mean they were dynamically tested |
| Features with code present in whole or part | 22 | Source inventory; not a functionality or quality claim |
| Feature groups represented by database-independent tests run | 15 | Rule/helper coverage only, not full API/DB/UI verification |
| Database-independent test cases passed | 85/85 | `npx tsx --test tests\*.node.test.ts` |
| End-to-end UI/API/database workflows verified | 0 | No shared authenticated browser session or approved disposable database |

Verification commands: backend `npm run typecheck` PASS; curriculum editor regression tests PASS (2/2); Faculty submission editor-state and timetable-cache regression tests PASS (5/5); backend database-independent Node tests PASS (85/85); frontend `npm run typecheck` PASS; frontend `npm run build` PASS with existing Vite chunk-size warning. No Vitest DB suite, migration, seed, or browser test was run. The approved disposable schema creation was attempted but denied by MySQL; the target remains absent. Existing `slotify_test` is incomplete and must not be used for destructive setup.

Read-only database safety inspection found the backend configuration points to loopback `slotify_dev`; it has 52 base tables and tracks migrations through `007_preference_curriculum_context.sql` (008 and 009 are not recorded). The approved candidate `slotify_test_disposable_audit_20261022_1219` did not exist; its creation attempt returned `ER_DBACCESS_DENIED_ERROR`, and the target remains absent. No existing database was modified.

Known incomplete scope includes the unsupported availability-override path in timetable validation, the missing student-to-division/elective mapping, absent automatic timetable generation, absent general reports/export, unverified real data and policies, and unverified persistence/RBAC/transactions across full workflows. See the audit matrix for per-feature evidence and blockers.

Follow-up fix (2026-10-22): Admin Curriculum Builder now recognizes division-audience-only edits as unsaved content and prompts before changing academic context. Added 2 regression tests; all 80 database-independent tests, backend/frontend typechecks and frontend build passed. Curriculum remains PARTIAL because persistence/publish integration and browser verification are blocked.

Faculty workflow fix (2026-10-22): Preferences previously ignored errors from the selected-term submission-detail query, leaving the form available without loaded state; Availability also lacked detail-query error feedback and allowed adding windows before its selected-term submission loaded. Both pages now show retryable errors and use a shared fail-closed editor state so edits/saving require successfully loaded data, even when a refetch fails while cached data exists. Added 4 database-independent tests; the full suite passed 84/84, backend/frontend typechecks and frontend build passed. Faculty workflows remain PARTIAL pending authenticated browser and database-backed persistence/authorization tests.

Faculty timetable isolation fix (2026-10-22): The session query cache key omitted the active faculty profile, allowing a persistent 30-second cache to reuse one faculty member's timetable after another member logged into the same browser and selected the same context. Added the profile ID to the query key and a regression test proving keys differ by profile. Final checks passed 85/85 database-independent Node tests, both backend/frontend typechecks, and the frontend production build. No authenticated browser test was available, so account-switch behavior remains unverified end to end.

## 1. Project overview

### Purpose and scope

Slotify is a Smart Campus academic timetable management system. The current implementation provides academic master-data management, curriculum and course offerings, faculty preference and availability submissions, admin review, faculty allocation/workload, workload-import review, timetable version records, validation, and a permission-checked timetable review/approval/publication workflow. Automatic timetable generation is not implemented.

### Stack and runtime

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query.
- Backend: Node.js, Express, TypeScript, Zod, MySQL2.
- Database: MySQL 8+.
- Frontend/backend development ports: 5173/4000.
- Database names configured for the local workflow: `slotify_dev` and `slotify_test`.
- The frontend proxies API requests through Vite; the backend is mounted under `/api`.
- Authentication uses HttpOnly access/refresh cookies, rotating hashed refresh tokens, CSRF double-submit validation, origin checks, and database-backed role/permission checks.

### Repository structure

- `frontend/src/`: role-based routing, layouts, shared UI, and Admin/Faculty/Student pages.
- `backend/src/routes/`: auth, users, master-data, submissions, assignments, workload imports, timetable validation/version APIs, and Admin dashboard.
- `backend/src/services/`: submission, allocation/workload, curriculum builder, validation, audit, and import logic.
- `database/migrations/`: eleven SQL migration files, including migration 008 and additive curriculum-draft migration 009 (both remain unapplied); `database/seeds/reference/` contains reference configuration, not institution-specific records.
- `backend/tests/`: database-backed API/schema tests plus database-independent Node/Vitest tests.
- `docs/`: design decisions, deviations, handover/progress notes, and workload-import evidence.

The inspected workspace has no Git metadata (`git status` reports that it is not a repository), so a Git-based clean/dirty-worktree determination is unavailable.

### Current schema and data snapshot

Read-only `information_schema` inspection on 2026-10-21 found:

- `slotify_dev`: 52 base tables including `schema_migrations`, 120 foreign-key relationships, and all nine migration names recorded (001 through 007; two 002- and two 003-prefixed files).
- `slotify_test`: 47 base tables and 103 foreign-key relationships. `schema_migrations` records only `001_core.sql`, while some later-migration tables also exist. This is an incomplete/partially applied schema, not a safe target for another reset or migration attempt without a separately approved recovery plan.
- No `student_profiles` table exists.
- Current `slotify_dev` counts include 2 academic years, 2 terms, 2 programs, 2 schemes, 2 semesters, 2 program-semester mappings, 2 sections, 2 batches, 8 courses, 16 components, 16 offerings, 6 audiences, 2 rooms, 2 faculty profiles, 3 submissions, 9 preferences, 3 assignments, 2 timetable versions, 2 scheduled sessions, and 39 workload-import rows. Counts are not evidence that underlying academic data is institutionally verified; inspect each row's `data_status` and provenance before operational use.
- Submission 8 remains submitted/accepted with three preferences, two availability rows, reviewer/timestamp/comment present, and zero assignments for its faculty member. This is the isolated demo verification record; it was read, not changed, during this audit.
- The latest workload import is `REVIEW_REQUIRED`. Its persisted summary records 39 source rows and zero changes to faculty profiles, courses, components, offerings, audiences, assignments, preferences, or curriculum links.

The default database-backed Vitest setup explicitly forces `DB_NAME=slotify_test` and calls `resetDatabase()` before migrations/tests. That reset drops all tables in the configured test database. It does not target `slotify_dev`, but the current test schema is incomplete and must not be destroyed/rebuilt casually. No default Vitest run, reset, migration, seed, or write query was executed in this audit.

## 2. Prior feature status dashboard (2026-10-21 snapshot; superseded by current functional audit above)

Status counts use the 25 inventory rows below (not estimated completion percentages).

| ID | Feature | Status | Implementation evidence | Test/verification evidence | Remaining work | Dependencies |
|---|---|---|---|---|---|---|
| APP-01 | Project foundation and frontend/backend connectivity | **COMPLETE & VERIFIED** | `backend/src/app.ts`, `frontend/src/App.tsx`, `frontend/src/router/index.tsx`, Vite config | This audit: backend typecheck and frontend production build passed; frontend `/` and backend `/api/health` returned HTTP 200 | Address the bundle-size warning; no critical foundation blocker found in the checks performed | None |
| AUTH-01 | Login/session lifecycle, CSRF, RBAC | **IMPLEMENTED, PARTIALLY VERIFIED** | `backend/src/services/authService.ts`, `backend/src/middleware/auth.ts`, `backend/src/middleware/security.ts`, `frontend/src/contexts/AuthContext.tsx` | Historical project notes report auth/API tests; no login workflow was performed in this audit | Re-run auth API tests only after test-database recovery; verify browser login/refresh/logout and role boundaries | Safe isolated DB test environment |
| ACAD-01 | Admin master-data CRUD | **IMPLEMENTED, PARTIALLY VERIFIED** | `backend/src/routes/masterdata.ts`; Admin departments, academic structure, courses, rooms, and faculty pages; README documents 23 master-data resources | Existing API test files cover master data; not run in this audit because test setup resets the incomplete test DB | Re-verify each resource's create/read/update/retire and permission behavior in a safe environment; ensure audit requirements are met | Safe isolated DB test environment |
| ACAD-02 | Academic context and term/program/semester/section mappings | **IMPLEMENTED, PARTIALLY VERIFIED** | `term_program_semesters`, composite foreign keys, `GET /api/assignments/allocation/contexts`, curriculum selection validation | Current schema/data snapshot; prior preference/allocation workflow evidence in session history | Reconcile parity and academic rules with approved institutional sources; verify edge cases for context changes and inactive records | Confirmed university rules and safe API tests |
| CURR-01 | Curriculum builder and publication | **IMPLEMENTED, PARTIALLY VERIFIED** | `backend/src/services/curriculumBuilder.ts`; `/curriculum-builder/validate` and `/curriculum-builder/publish`; Admin `CurriculumBuilder.tsx`; saved drafts require migration 009 | 2026-10-22: focused curriculum/mapping/audience rules passed 22/22; backend typecheck and frontend build passed | Verify persistence, transactional audience writes, and rollback in an isolated DB; reconcile curriculum source data | ACAD-02; safe isolated DB test environment |
| OFFER-01 | Course components, term offerings, audiences, batches, electives | **IMPLEMENTED, PARTIALLY VERIFIED** | Existing `course_offerings`/`offering_audiences` tables and master-data routes; curriculum publish now links each component offering to explicitly selected, context-validated divisions | 2026-10-22: database-independent audience context/uniqueness tests passed; no DB-backed workflow test | Verify offering/audience coverage and batch consistency in an isolated DB; records are VERIFY pending review | CURR-01; safe isolated DB test environment |
| PREF-01 | Faculty subject preference submission and Admin review | **IMPLEMENTED, PARTIALLY VERIFIED** | `/api/faculty-submissions/mine`, `/submit`, reviewer list/detail/review routes; `submissionService.ts`; Faculty Preferences and Admin Submissions pages | Prior authenticated API/database/browser-readback scenario reported for submission 8; current read-only DB query reconfirmed accepted status, three preferences, reviewer details; this audit's preference/rule tests passed | Re-run full UI/API flow after safe test setup; verify current UI actions click through reliably; confirm exact-three rule with the university | Faculty profile and published curriculum context |
| PREF-02 | Faculty availability and UNKNOWN handling | **IMPLEMENTED, PARTIALLY VERIFIED** | Faculty availability API/UI; explicit AVAILABLE/UNAVAILABLE/UNKNOWN records and overlap/time validation | Prior API persistence/readback reported; this task's allocation-rule tests cover missing/unverified availability gating; current DB was not modified | Safe persistence tests remain; actual day/time matching is validated only once timetable sessions exist | PREF-01; availability policy |
| ALLOC-01 | Faculty assignment planning, editing, validation, finalization | **IMPLEMENTED, PARTIALLY VERIFIED** | `backend/src/routes/assignments.ts` (`/allocation/contexts`, `/plan`, `/validate`, `/finalize`); Admin `AllocationPlanner.tsx`; assignment APIs | Database-independent tests cover missing/unverified availability, curriculum/faculty/role data, and inactive sections; latest focused run passed 22/22; DB-backed finalization/approval tests not run | Verify faculty eligibility and source-preference state/context checks; exercise approval/finalization in an approved isolated DB | OFFER-01, PREF-01, PREF-02 |
| ALLOC-02 | Workload calculation and limits | **IMPLEMENTED, PARTIALLY VERIFIED** | `workloadService.ts`, `allocationRules.ts`, designation/workload policy tables and workload pages | This audit: pure workload/allocation tests passed; prior API tests are documented in `HANDOVER.md` | Confirm workload counting policies and limits; reference seed labels limits `VERIFY` and special activity counting `UNCONFIRMED`, so no institutional limits should be treated as verified | Institutional workload policy; ALLOC-01 |
| ROOM-01 | Room/lab records, capabilities, and availability setup | **IMPLEMENTED, PARTIALLY VERIFIED** | `rooms`, `room_types`, `room_availability`; Admin `RoomsPage.tsx`; migration 008 adds opt-in classroom practical approval (not applied) | Read-only `slotify_dev`: 2 synthetic demo rooms, no provenance; not the reported 8 classrooms + 4 labs | Verify actual inventory, capacity, equipment, practical approval, and availability against authoritative sources | ACAD-01 |
| ROOM-02 | Room availability and timetable conflict enforcement | **IMPLEMENTED, PARTIALLY VERIFIED** | Timetable validation checks overlap, explicit room availability, capacity, room type and practical approval | Pure tests cover availability/capacity/suitability; database-backed tests not run | Verify actual room data; calendar and end-to-end tests remain blocked | ROOM-01, TT-VAL-01 |
| IMPORT-01 | CSE workload extraction, preview, staging, and review | **PARTIALLY IMPLEMENTED** | `workloadImportPreview.ts`, `workloadImportService.ts`, `/api/workload-imports`, Admin Workload Import page; extraction/preview artifacts under `docs/imports/` | Preview documentation reports 0 ready, 32 needing review, 7 blocked (39 serials); this audit confirmed 39 staged rows and no master-data/assignment changes in the import summary; eight preview tests passed | Resolve identities, term/semester/section/batch and course/component mappings from authorized sources; resolve missing row 38 and ambiguous values; do not promote preview data as verified | Institutional source confirmation; ACAD-02, OFFER-01 |
| TT-00 | Timetable version/session schema and version APIs | **IMPLEMENTED, PARTIALLY VERIFIED** | Migration 002 defines version, session, audience and faculty relations; version-scoped APIs now list/read sessions and expose verified session options; DRAFT-only create/update/delete APIs use existing tables; Admin Timetable Versions includes session management | Database-independent slot/request/validation-rule tests passed; backend typecheck and frontend build passed. Database-backed API and browser workflows were not run | Verify session CRUD, rollback, RBAC and existing validation behavior in an approved isolated DB; manual sessions are restricted to one valid offering audience per session | Safe isolated DB test environment; TT-VAL-01 |
| TT-VAL-01 | Timetable validation engine | **IMPLEMENTED, PARTIALLY VERIFIED** | `validationService.ts`, `POST /api/timetable/validate`, `ValidationPage.tsx`; checks overlap, audience scope, capacity/suitability, explicit availability, slots, breaks, operating bounds, and Saturday cutoff; session writes call its read-only validator before transaction commit | Latest focused database-independent run passed 26/26 across session rules, allocation and scheduling rules; live timetable validation and API tests were not run because `slotify_test` is incomplete | Add calendar after policy/schema approval; verify validation persistence and session-write rollback in an approved isolated DB | PREF-02, ROOM-02, safe isolated DB test environment |
| TT-CONFIG-01 | Term scheduling configuration readiness | **IMPLEMENTED, BLOCKED BY CURRENT DATA** | Pure checks in `schedulingConfiguration.ts`; read-only `GET /api/timetable/configuration/:termId`; Admin Validation page | Read-only snapshot: term 1 has 0 active divisions, term 2 has 2 synthetic divisions; 2 synthetic rooms only; no calendar support; both terms return `ready=false` | Apply migration 008 after approval; configure verified sections, rooms, day grids, availability and workload rules; add calendar | ACAD-02, ROOM-01, approved calendar policy |
| TT-GEN-01 | Automatic timetable generation | **NOT IMPLEMENTED / CONFIGURATION BLOCKED** | Generation-run schema exists, but no generator service or generation endpoint is registered | Readiness cannot pass for actual current data | Resolve exact mappings, verified resources/workload, grids and calendar; do not begin until readiness passes | TT-VAL-01, TT-CONFIG-01; verified allocations and approved calendar |
| TT-PUB-01 | Timetable review, approval, and publishing | **IMPLEMENTED, NOT INTEGRATION-VERIFIED** | Existing lifecycle statuses/actions/triggers; permission-checked submit-review, request-changes, approve, and publish routes; Admin Timetable Versions controls; atomic archive-and-replace publication | Database-independent lifecycle/context/authorization tests passed 12/12; backend typecheck and frontend build passed; no DB-backed or browser workflow was run | Verify transition triggers, rollback, permissions, historical publication replacement, and faculty readback in an approved disposable DB/browser session; student reads require student-to-division mapping | TT-VAL-01; verified schedule data; safe isolated DB test environment |
| FAC-01 | Faculty portal | **PARTIALLY IMPLEMENTED** | Dashboard, preferences, availability, teaching track, assigned subjects, workload, profile; personal timetable page explicitly defers to generator/publishing | Preference/availability API persistence has prior evidence; this audit did not perform UI interactions | Complete faculty timetable view after publication; repeat submission/review workflow in a reliable browser session | PREF-01, TT-PUB-01 |
| STU-01 | Student profile and section/elective mapping | **NOT IMPLEMENTED** | No `student_profiles` table or corresponding backend route found | Current schema inspection confirms absence | Define privacy-safe student-to-section/elective mapping, then add migration/API and authorization tests | Institutional enrollment model |
| STU-02 | Student subjects and timetable | **PARTIALLY IMPLEMENTED** | Student pages exist; subjects page explicitly displays all active courses because student scoping is unavailable; timetable page is a gap notice | Code inspection only; no student login/browser verification this audit | Scope subjects to the authenticated student's program/semester/section; show only published timetable after mapping exists | STU-01, TT-PUB-01 |
| REP-01 | Workload/timetable reports and exports | **NOT IMPLEMENTED** | No report/export routes or export UI found; dashboards show basic database-derived summaries | No export workflow exists | Define audiences and formats; add reports/export after publishing and data scoping | TT-PUB-01, STU-01 |
| AUD-01 | Audit history and operational traceability | **PARTIALLY IMPLEMENTED** | `audit_logs`; submission, review, assignment, import, and some timetable-version actions write audit rows | Historical workflow evidence; no broad audit-completeness test run | Cover master-data changes and timetable validation/approval/publishing; verify append-only/retention requirements | Confirmed audit policy |
| TEST-01 | Safe automated integration and database test environment | **BLOCKED** | Vitest global setup now requires explicit reset consent, loopback MySQL, and a uniquely named `slotify_test_disposable_<unique_suffix>` database before destructive setup; API/schema tests remain database-backed | This task did not run the DB-backed suite. Existing `slotify_test` remains partial (47 tables, only 001 recorded, some later tables present) and is rejected by the guard. | Have an authorized DBA provision and approve a disposable isolated DB; verify migration/setup safety there before running API/schema tests | Approved disposable test DB |
| REQ-01 | Acceptance against actual university specification and policy | **BLOCKED** | `docs/DEVIATIONS.md` states the Word scope and master-data workbook were unavailable; `docs/DECISIONS.md` marks several rules unresolved/needs confirmation | No authoritative source reconciliation can be evidenced | Obtain approved specification/workbook and confirm workload, parity, preference count, coordinator, Saturday, and lab policies | University stakeholders/source documents |

### Status counts

| Status | Count |
|---|---:|
| COMPLETE & VERIFIED | 1 |
| IMPLEMENTED, PARTIALLY VERIFIED | 10 |
| IMPLEMENTED, NOT VERIFIED | 2 |
| IMPLEMENTED, BLOCKED BY CURRENT DATA | 1 |
| PARTIALLY IMPLEMENTED | 5 |
| NOT IMPLEMENTED | 4 |
| BROKEN | 0 |
| BLOCKED | 2 |
| **Total inventory rows** | **25** |

“BROKEN: 0” means no additional reproducible feature failure was independently tested in this audit; it does not mean the project has no confirmed defects or gaps. Confirmed implementation gaps are described in sections 4–5.

### 2.1 Scheduling requirements readiness (2026-10-21)

Owner-confirmed rules and their enforcement status are captured in `docs/SCHEDULING_REQUIREMENTS.md`. The owner confirmed 12 active divisions per running term, four per each of its three parity-specific semesters (odd 3/5/7, even 4/6/8), plus one shared physical inventory of 8 classrooms and 4 labs. Earlier conflicting division interpretations are superseded.

- **Division mismatch:** Term 1 has zero active divisions; term 2 has two active synthetic Semester 3 divisions, not the required 12. No division records were changed.
- **Resource mismatch:** `slotify_dev` has two synthetic rooms (one classroom and one lab); ten reported resources are absent. No resource data was inferred or changed.
- **Grid/calendar gaps:** Term 1 has no day grid; term 2 has synthetic two-hour teaching slots and teaching time overlapping lunch. No holiday/exam calendar exists.
- **Implementation boundary:** The read-only configuration check and session validator now report/block these gaps. Migration 008 was created but not run; the validator reports its absence safely. Calendar enforcement is unsupported and blocks readiness. Neither database was modified.

## 3. Completed work with evidence

- Backend and frontend are connected through the `/api` Express app and Vite proxy. In this audit, backend and frontend health requests returned HTTP 200.
- Verification for this configuration task: `cd backend; npm run typecheck` passed; `cd backend; npx tsx --test tests/schedulingConfiguration.node.test.ts tests/scheduleRules.node.test.ts` passed 15/15; `cd frontend; npm run build` passed with the existing Vite chunk-size warning (519.19 kB minified, 132.16 kB gzip).
- Read-only `getSchedulingConfiguration()` checks against terms 1 and 2 passed. Both returned `ready=false` with the expected blockers: incomplete semester/division mappings, only two synthetic rooms, missing practical-approval migration, unverified workload policies, and no calendar; term 2 also has unverified divisions and incomplete/invalid grid and room availability.
- Allocation validation now treats missing verified AVAILABLE windows, unverified curriculum/division/faculty/assignment-role data, and missing workload rules as blocking errors. Direct single-assignment approval applies the same data/availability checks and requires a workload rule. Version creation rejects repeated or inactive section selections; version number allocation remains serialized by a term lock and schema uniqueness, and the schema enforces one published version per term.
- Default Vitest database setup now refuses to run unless `backend/.env` explicitly opts in to resetting a locally hosted database named `slotify_test_disposable_<unique_suffix>`. It will not target `slotify_dev` or the existing `slotify_test`; no database-backed tests were run.
- Backend TypeScript typecheck passed. Frontend production build passed, including its TypeScript build step.
- Database-independent validation exists for curriculum construction, preference ranking, availability windows, review transitions, allocation workload/coverage, and workload-import preview.
- Faculty preferences and review are separate from teaching assignments. Preference submission requires exactly three distinct course choices; draft saves can be shorter. This exact-three requirement remains a policy item to confirm, not a verified university rule.
- The prior isolated API workflow for submission 8 is recorded in the session history: submission, refresh/readback, Admin acceptance, allocation preference readback. The current audit independently reconfirmed its saved status/reviewer data and that it has three preferences and no assignments. The prior workflow was not a browser-only click-through.
- Curriculum and timetable structures are not wholly hypothetical: the current development schema has all nine migrations recorded, and the database contains academic, curriculum, offerings, assignments, versions, sessions, and workload-import records. Their presence does not establish institutional validity.
- The workload source was extracted without filling the missing serial row or silently reconciling ambiguous subject/faculty identities. The preview is still a review tool: it reports 0 ready, 32 needs review, and 7 blocked.

## 4. Partial and unverified work

- No complete browser-only end-to-end flow was conducted in this audit. Prior preference/review actions were performed through authenticated APIs and confirmed by database/browser readback; form buttons were not reliably operable in that earlier session.
- Database-backed API, constraint, and timetable validator tests were not run. The current `slotify_test` state is partial and the default suite resets it before running.
- The Admin allocation workflow has a usable planning/finalization API and UI, but availability and eligibility policies are not complete enough to treat finalization as safe for scheduling.
- Room availability can be configured and timetable validation blocks missing, UNKNOWN, or unavailable coverage. Database-backed verification remains pending.
- Pure timetable constraint functions now block missing/UNKNOWN faculty availability, capacity gaps/excess, invalid slots, configured breaks, operating bounds, and practical-room suitability. The database-backed validator/API suite remains unrun; missing academic-calendar support remains a readiness blocker.
- Timetable versions can be listed/read and empty drafts created. There is no generation endpoint, no session editing workflow identified, and no timetable review/approval/publish API.
- The student portal is not section-scoped. Student timetable/profile linkage is absent.
- Faculty timetable, student timetable, and several student data views are honest placeholders rather than functional schedules.
- The root README says the frontend is “not started,” while the frontend application exists; handover/progress documents also contain historical test counts and milestone statements. Treat `docs/PROJECT_STATUS.md` as the current audit ledger and update the other documentation only as a separate, scoped task.
- The exact source university specification/workbook is not present, so institutional acceptance cannot be claimed. Workload rules currently marked VERIFY/UNCONFIRMED are not verified limits.

## 5. Known bugs and risks

### Confirmed correctness/data-integrity gaps

1. **Time-specific allocation availability cannot be determined before sessions exist.** Allocation finalization now requires at least one verified AVAILABLE window and blocks when none exists; actual session interval matching remains the timetable validator's responsibility.
2. **Academic calendar restrictions are unsupported.** No holiday/examination calendar exists, so configuration readiness reports a blocking error until a calendar model and enforcement are added.
3. **Room suitability is only partially modeled.** Migration 008 adds explicit practical approval; equipment/course capabilities remain free text and require authoritative resource data.
4. **Student-to-section mapping is absent.** The Student subjects page exposes all active courses rather than courses scoped to the authenticated student.

### Confirmed project/test risks

- The default test setup is destructive to `slotify_test` by design. The current database is already inconsistent/partial, and rebuilding it is not authorized by this audit.
- MySQL DDL autocommits. A failed migration can leave partially created tables; the current test DB's migration marker/table mismatch is consistent with an incomplete migration state. Do not infer recovery steps from `README.md`'s reset suggestion.
- There is no Git metadata in this workspace, so status/diff evidence is unavailable.
- Frontend production build reports a 519.19 kB minified JS chunk (over Vite's 500 kB warning threshold; gzip 132.16 kB).

### Policy/architecture risks (not implementation defects by themselves)

- Workload limit seed values are `VERIFY`; special workload counting policies are `UNCONFIRMED`.
- Exact three-preference submission, semester parity, Saturday periods, consecutive labs across breaks, Coordinator permissions, course-code uniqueness, and assignment approval semantics need institutional confirmation.
- `curriculum_courses.group_id` intentionally lacks a foreign key because the curriculum is term-independent while elective groups are term-specific.
- Existing role permissions for Coordinator are provisional.
- The two-digit migration prefixes are duplicated (`002_*`, `003_*`); lexical ordering currently determines execution order. Avoid renaming applied migrations; document/validate ordering for future migrations.

## 6. Prioritized remaining roadmap

### SAFE-01 — Enforce UNKNOWN and missing availability as a hard scheduling gate

- **Priority:** P0
- **Status:** Partially implemented; database/API verification and the explicit authorized override workflow remain incomplete.
- **Objective:** Make allocation finalization and timetable validation consistent with approved Decision H: unknown availability blocks by default; any override is explicit, authorized, reasoned, and auditable.
- **Dependencies:** Existing preference/availability model; confirm that Decision H remains the approved policy before implementation.
- **Implementation steps:** Model missing availability as UNKNOWN for each scheduled time; classify UNKNOWN overlaps as blocking; prevent allocation finalization while required availability is unknown; connect any exception to the existing override actor/reason fields and audit trail; ensure validation/version status reflects the gate.
- **Acceptance criteria:** No schedule with missing or UNKNOWN required availability can be finalized/passed/published by default; explicit UNAVAILABLE conflicts remain blocking; an override works only through an authorized action with reason and actor; no availability remains silently treated as available.
- **Required tests:** Pure rule tests for missing/UNKNOWN/UNAVAILABLE; API authorization and state-transition tests; database-backed tests for override/version gates in a disposable test database; read-only verification of persisted actor/reason.
- **Definition of done:** All checks use one consistent rule, API responses identify faculty/session/reason, and all focused tests pass without touching `slotify_dev`.

### TEST-01 — Establish a safe isolated database-test environment

- **Priority:** P1
- **Objective:** Restore trustworthy DB-backed test coverage without risking existing `slotify_dev` or `slotify_test` data.
- **Dependencies:** Explicit approval and a verified backup/recovery/isolation plan.
- **Implementation steps:** Preserve the current `slotify_test` state for diagnosis; create/use a separately named local disposable test database only with approval; set `SLOTIFY_TEST_DB_NAME=slotify_test_disposable_<unique_suffix>` and `SLOTIFY_ALLOW_DISPOSABLE_DB_RESET=YES` in `backend/.env`; review reset/migration scripts and safeguards; run schema/API tests only against that isolated database. MySQL error 1419 requires a DBA-approved migration procedure; do not change binary logging/global trust settings or grant broad privileges.
- **Acceptance criteria:** Test configuration proves the target database name before any destructive setup; `slotify_dev` is unreachable from the test process; test schema is fully migrated and reproducible.
- **Required tests:** Configuration guard tests, migration smoke test, schema constraints, API workflow suites.
- **Definition of done:** A repeatable safe test command and explicit cleanup procedure are documented; neither protected database was reset.

### ROOM-02 — Enforce configured room availability

- **Priority:** P1
- **Objective:** Reject scheduled room use that overlaps known unavailable windows and expose unknown room availability clearly.
- **Dependencies:** ROOM-01; define how missing room availability is interpreted.
- **Implementation steps:** Add interval checks against room availability to the validator; clarify hard/soft behavior and unknown handling; include room and time in issues.
- **Acceptance criteria:** A conflicting room window is reported with the correct session/room/time; non-overlapping availability passes; unknown is not described as confirmed availability.
- **Required tests:** Pure interval tests and database-backed validator cases for available, unavailable, and unrecorded room availability.
- **Definition of done:** Validator and Admin Validation page present actionable room issues, and allocation/publication gates honor configured severity.

### ALLOC-01 — Harden allocation eligibility and preference provenance

- **Priority:** P1
- **Objective:** Ensure assignment recommendations and source-preference links are current and valid, and that only represented eligibility data is enforced.
- **Dependencies:** SAFE-01, ACAD-02, PREF-01.
- **Implementation steps:** Require source preferences to match faculty, term, semester, course/component, and accepted review state; determine whether qualifications exist in authoritative data before advertising eligibility checks; avoid inventing qualifications/policy.
- **Acceptance criteria:** Pending/returned/stale/mismatched preferences cannot be treated as accepted sources; valid accepted preferences show correct ranks; preferences remain recommendations, not automatic assignments.
- **Required tests:** Pure and API tests for accepted/pending/returned/context mismatch and unauthorized assignment writes.
- **Definition of done:** Planner and backend validation agree on current preference state and context.

### IMPORT-01 — Resolve workload source rows against approved records

- **Priority:** P1
- **Objective:** Finish review of the CSE Even 2026 staging data without fabricating identities or overwriting institutional records.
- **Dependencies:** Approved source documents and named reviewers; ACAD-02/OFFER-01.
- **Implementation steps:** Reconcile faculty identities, department/term/semester/section/batch and course/component mappings; resolve ambiguous row 25, missing row 38, duplicate-name questions, and workload arithmetic; preserve source provenance and decisions.
- **Acceptance criteria:** Every imported mapping is supported by approved evidence; unresolved/blocked rows remain excluded from production assignments; resulting records show verified provenance/status.
- **Required tests:** Preview regression tests, mapping validation tests, staged-import idempotency and no-overwrite tests in a safe isolated database.
- **Definition of done:** Approved rows are explicitly separated from unresolved rows and a read-only report matches persisted provenance.

### REQ-01 — Confirm scheduling and workload policy

- **Priority:** P1
- **Objective:** Convert open assumptions into approved, documented requirements before automatic scheduling.
- **Dependencies:** University specification/workbook and authorized stakeholder decisions.
- **Implementation steps:** Reconcile the 41-entity source diagram and available institutional documents; confirm preference count, workload limits/counting, Coordinator role, Saturday grid/cutoff, lab breaks, term parity, capacity severity, and curriculum/section/elective scope.
- **Acceptance criteria:** Each required policy has an authoritative source, owner, approval, and testable rule; unresolved items remain explicitly blocked.
- **Required tests:** Requirement-to-test traceability review.
- **Definition of done:** `docs/DECISIONS.md` reflects approved decisions and no unverified value is represented as institutional policy.

### TT-GEN-01 — Implement timetable generation only after prerequisites

- **Priority:** P2
- **Objective:** Generate a whole-week timetable for selected terms/sections from confirmed offerings, audiences, assignments, rooms, and teaching grids.
- **Dependencies:** SAFE-01, TEST-01, ROOM-02, ALLOC-01, IMPORT-01 as needed, REQ-01, TT-VAL-01.
- **Implementation steps:** Define generation scope and run lifecycle; model hard and soft constraints; use configured day/slot/break data; preserve consecutive lab requirements; handle infeasible runs/unplaced requirements; persist version/session output transactionally and retain diagnostics.
- **Acceptance criteria:** All required teaching is either placed or explicitly reported unplaced; no faculty/room/section/batch conflicts; unknown availability is blocked unless authorized; generated data is reproducible and remains a draft.
- **Required tests:** Scheduler unit/property tests, integration tests in isolated DB, infeasibility tests, conflict validation, multi-section/lab scenarios.
- **Definition of done:** A real generation run creates a persisted draft with complete diagnostics; no fabricated success or mock timetable.

### TT-PUB-01 — Add timetable review, approval, and publication

- **Priority:** P2
- **Objective:** Implement a permission-enforced timetable lifecycle after a valid generated draft exists.
- **Dependencies:** TT-GEN-01, TT-VAL-01, SAFE-01, REQ-01.
- **Implementation steps:** Define allowed transitions and reviewer role; implement review/return/approve/publish APIs with transactions and audit; honor unknown-availability gates; add UI actions and immutable published-version handling.
- **Acceptance criteria:** Invalid or unresolved versions cannot advance; actor, timestamp, and reason are persisted; published history is immutable and only one published version per term exists.
- **Required tests:** State transition, authorization, transaction, unknown-override, immutability, and browser workflow tests.
- **Definition of done:** A complete authorized draft-to-published lifecycle is verified against a safe database and browser.

### PORT-01 — Complete scoped portals, reporting, and deployment readiness

- **Priority:** P3
- **Objective:** Deliver usable published timetable views and operational reporting.
- **Dependencies:** STU-01, TT-PUB-01, REP-01.
- **Implementation steps:** Add student profiles/section mapping; faculty and student published-timetable views; scoped course lists; workload/room/timetable reports and exports; add performance/accessibility/deployment checks.
- **Acceptance criteria:** Each role sees only authorized records; exports match persisted published data; no placeholder page claims a timetable exists when none is published.
- **Required tests:** Authorization, role-specific API/UI, export content, responsive/browser, and deployment smoke tests.
- **Definition of done:** Role-scoped portal and report workflows pass end-to-end against real persisted records.

## 7. Verification ledger

| Date | Command/workflow | Result | Evidence | Database touched? | Limitations |
|---|---|---|---|---|---|
| 2026-10-21 | `backend`: `npm run typecheck` | PASS | TypeScript completed with exit code 0 | No | Does not exercise runtime/database behavior |
| 2026-10-21 | `frontend`: `npm run build` | PASS | `tsc` and Vite succeeded; 1,658 modules; JS chunk 516.10 kB minified | No | Build regenerated `frontend/dist` output; Vite >500 kB warning; without Git metadata, pre/post generated artifact differences cannot be compared |
| 2026-10-21 | `backend`: `npx tsx --test tests/curriculumBuilder.node.test.ts tests/submissionPreferences.node.test.ts tests/submissionRules.node.test.ts tests/workloadImportPreview.node.test.ts` | PASS, 21/21 | Curriculum 5; preference validation 4; submission rules 4; import preview 8 | No | Pure/database-independent tests only |
| 2026-10-21 | `backend`: `npx vitest run --config <temporary safe config> tests/allocationRules.test.ts` | PASS, 5/5 | Allocation/workload pure rules passed; temporary config disabled database `globalSetup` and was removed after test | No | Vite emitted CJS Node API deprecation warning |
| 2026-10-21 | `curl.exe` GET `http://localhost:4000/api/health` and `http://localhost:5173/` | PASS, HTTP 200 each | Backend health and frontend root responded | No | Not a login or workflow test |
| 2026-10-21 | Read-only queries to `information_schema`, migration marker, and selected demo/import summary rows | PASS | Dev: 52 tables/120 FKs/all nine migrations; test: 47 tables/103 FKs/only 001 recorded with partial later tables; demo and import records read back | Yes, SELECT only | No repair, reset, migration, or database-backed test was performed |
| 2026-10-21 | `backend`: `npm run typecheck` | PASS | TypeScript completed with exit code 0 after Saturday cutoff alignment | No | Does not exercise runtime/database behavior |
| 2026-10-21 | `backend`: `npx tsx --test tests/scheduleRules.node.test.ts` | PASS, 2/2 | Confirmed Saturday cutoff and term-configured weekday closing behavior | No | Database-independent unit coverage; no timetable integration/database test |
| 2026-10-21 | `frontend`: `npm run build` | PASS | TypeScript and Vite succeeded; 1,658 modules; JS chunk 516.12 kB minified | No | Existing >500 kB chunk warning |
| 2026-10-21 | `backend`: `npm run typecheck` | PASS | TypeScript completed after scheduling-configuration implementation | No | No runtime/database execution |
| 2026-10-21 | `backend`: `npx tsx --test tests/schedulingConfiguration.node.test.ts tests/scheduleRules.node.test.ts` | PASS, 11/11 | Division parity/counts, shared room inventory, day grid, breaks, Sunday, slot match, availability, capacity, practical permission, lab periods, calendar/workload readiness, and Saturday cutoff | No | Database-independent unit coverage only |
| 2026-10-21 | `frontend`: `npm run build` | PASS | TypeScript and Vite succeeded; 1,658 modules; JS chunk 519.22 kB minified | No | Existing >500 kB bundle warning |
| 2026-10-21 | Read-only `slotify_dev` configuration queries | PASS | Active terms: 0 divisions for EVEN term 1; 2 synthetic divisions in ODD term 2; 2 synthetic rooms; grid/calendar details documented in `SCHEDULING_REQUIREMENTS.md` | Yes, SELECT only | Current data is synthetic/incomplete; no migration or write executed |
| 2026-10-21 | `backend`: `npm run typecheck` | PASS | TypeScript completed after configuration, migration-compatibility, audience-scope, and capacity-validation changes | No | Database-backed runtime validation was not exercised |
| 2026-10-21 | `backend`: `npx tsx --test tests/schedulingConfiguration.node.test.ts tests/scheduleRules.node.test.ts` | PASS, 15/15 | Parity/mapping/divisions, shared room inventory, schedule slots/bounds/breaks, availability, capacity/practical suitability, audience scope, lab periods, and calendar/workload readiness | No | Pure database-independent tests |
| 2026-10-21 | `frontend`: `npm run build` | PASS | TypeScript and Vite succeeded; 1,658 modules; JS chunk 519.19 kB minified / 132.16 kB gzip | No | Existing >500 kB chunk-size warning |
| 2026-10-21 | Read-only `getSchedulingConfiguration()` for terms 1 and 2 | PASS | Both terms returned `ready=false` and reported their incomplete configurations; no records were changed | Yes, SELECT only | Database-backed timetable validation and API tests were not run |
| 2026-10-21 | Database-backed test setup / migration | NOT RUN | `slotify_test` remains incomplete and default Vitest global setup resets it; migration runner applies MySQL DDL with auto-commit | No | Requires separately approved safe test DB/migration plan |
| 2026-10-21 | `backend`: `npm run typecheck` | PASS | TypeScript completed with exit code 0 after allocation finalization/approval safeguards and frontend response-type alignment | No | Does not exercise database-backed behavior |
| 2026-10-21 | `backend`: `npx tsx --test tests/allocationRules.node.test.ts tests/testDatabaseSafety.node.test.ts tests/schedulingConfiguration.node.test.ts tests/scheduleRules.node.test.ts` | PASS, 22/22 | Allocation availability/finalization rules, safe-test-database guard, scheduling configuration, and time-slot rules | No | Pure/database-independent tests; no API or DB workflow execution |
| 2026-10-21 | `frontend`: `npm run build` | PASS | TypeScript and Vite succeeded; 1,658 modules; JS chunk 519.21 kB minified | No | Existing >500 kB chunk-size warning |
| 2026-10-21 | `backend`: `npm run typecheck` | PASS | TypeScript completed with exit code 0 after timetable session routes/services were added | No | Does not exercise DB-backed session writes |
| 2026-10-21 | `backend`: `npx tsx --test tests/timetableSessionRules.node.test.ts tests/allocationRules.node.test.ts tests/testDatabaseSafety.node.test.ts tests/schedulingConfiguration.node.test.ts tests/scheduleRules.node.test.ts` | PASS, 26/26 | Session request schema, contiguous teaching-slot selection, validation-error comparison, allocation and scheduling rules | No | Pure/database-independent coverage; session CRUD, authorization, and rollback were not exercised |
| 2026-10-21 | `frontend`: `npm run build` | PASS | TypeScript and Vite succeeded; 1,658 modules; JS chunk 529.31 kB minified / 134.44 kB gzip | No | Existing >500 kB chunk-size warning |
| 2026-10-21 | `rg` stale Saturday cutoff scan | PASS | No stale 13:30 Saturday cutoff references remain; matches are lunch interval/context only | No | Text scan, not a behavior test |
| 2026-10-22 | `backend`: `npm run typecheck` | PASS | TypeScript completed with exit code 0 after academic workflow updates | No | No database-backed routes were exercised |
| 2026-10-22 | `backend`: `npx tsx --test tests/curriculumBuilder.node.test.ts tests/curriculumDraftRules.node.test.ts tests/curriculumAudienceRules.node.test.ts tests/curriculumSelection.node.test.ts tests/academicTermRules.node.test.ts` | PASS, 22/22 | Parity and mapping filters, incomplete/legacy draft serialization, context and version rules, offering-audience validation, duplicate prevention | No | Pure/database-independent tests; no route authorization or transactional DB execution |
| 2026-10-22 | `frontend`: `npm run build` | PASS | TypeScript and Vite succeeded; 1,663 modules; JS chunk 550.83 kB minified / 140.11 kB gzip | No | Existing >500 kB chunk-size warning |
| 2026-10-22 | Migration 009 safety inspection | PASS | Single additive `CREATE TABLE curriculum_drafts`; rollback instruction is documented; migration was not applied | No | MySQL parsing/foreign-key execution was not tested |
| 2026-10-22 | Admin curriculum browser workflow | NOT RUN | No shared browser page/session was available; built UI only | No | Requires authenticated browser and safe API/database environment |
| Earlier session, reported in `HANDOVER.md` / `BACKEND_PROGRESS.md` (2026-10-20) | Historical `npm test` and browser/API work | Historical report: 224/224 backend tests passed; historical typechecks/builds passed | Documents describe test run against `slotify_test` and prior faculty preference page checks | Historical test touched `slotify_test`; no dev reset reported | Not rerun; current test DB inspection is inconsistent/partial; earlier browser work did not complete all write/review actions through UI clicks |

No database-backed tests were executed in this audit. Earlier test totals in archived milestone notes vary; do not substitute an old result for a fresh run.

## 8. Decision log and open questions

### Confirmed project rules/architecture (verify against authoritative sources before deployment)

- Authentication is cookie-based with CSRF protection and permission checks in backend routes.
- Faculty preferences are requests, not assignments. The planner uses accepted preferences for matching academic contexts.
- Preference drafts can contain fewer than three entries; submission currently requires exactly three distinct courses. The exact required count needs university confirmation.
- Availability supports AVAILABLE, UNAVAILABLE, and UNKNOWN; absence of a record must not be silently treated as confirmed availability.
- Timetable versions have immutable-published database triggers and an unknown-availability gate in the schema, but the complete lifecycle API is missing.
- Saturday teaching has an owner-confirmed 12:30 PM cutoff; exact Saturday periods are not configured/confirmed.
- Workload limits/counting rules must only be enforced when explicitly verified.

### Unresolved or assumed

- Authoritative Word specification and master-data workbook were unavailable per `docs/DEVIATIONS.md`.
- Whether three preferences are mandatory per institutional policy.
- Verified workload hour limits and how lab assistants, projects, SDP, and minor projects count.
- Coordinator permissions and review responsibilities.
- Saturday period grid, break/lab consecutiveness rules, Semester VII patterns, fractional-hour scheduling behavior, course-code uniqueness.
- Validation treats missing/over-capacity as blocking; define any authorized exception workflow before one is added.
- Curriculum group/elective modeling and faculty qualification eligibility.
- Assignment approval actor/role semantics and student-to-section/elective membership model.

Do not convert assumptions into code defaults or claim university acceptance until decisions have an authoritative source and owner.

## 9. Next-session handoff

- **Current state:** Admin/Faculty foundations, academic configuration, curriculum, preferences/review, assignment planning/workload, workload-import review, timetable validation, and version-scoped draft session management exist. Faculty profile reads now preserve an explicit nullable result. A faculty-scoped read-only timetable API and weekly view expose only published sessions for the authenticated faculty member’s approved assignments. Allocation finalization and individual assignment approval block missing or unverified faculty availability. Approval/publication, generation, calendar support, and student-to-section mapping do not exist.
- **Last independently verified milestone:** On 2026-10-21, backend typecheck passed, 31 database-independent Node tests passed, and the frontend production build passed. The checks did not exercise authenticated API/database behavior. No migration or database write occurred.
- **Exact next task:** Decide whether to add a persisted curriculum-draft table and migration (the current builder draft is in-memory only); then provision an owner/DBA-approved local disposable integration-test database and verify authorized faculty timetable access and the future publication lifecycle against that database.
- **Inspect first:** `backend/src/services/validationService.ts`, `backend/src/services/allocationRules.ts`, `backend/src/routes/assignments.ts` (`/allocation/finalize`), `backend/src/routes/timetable.ts`, migration `database/migrations/002_timetable.sql`, `docs/DECISIONS.md`, and the relevant allocation/submission/timetable tests.
- **Dependencies/risks:** Decision H says unknown availability defaults to blocked; allocation finalization and direct approval now enforce the missing/unverified-availability block. `slotify_test` is incomplete and the guarded Vitest setup can reset only an explicitly approved disposable local target. Do not run database-backed tests, migrations, or seeds until that target is provisioned and approved. Never use `slotify_dev` for test setup.
- **Safe commands:** `backend`: `npm run typecheck`; `frontend`: `npm run build`; the four `tsx --test` suites listed in the verification ledger; allocation Vitest only with a safe config that omits global setup. Health requests and read-only SQL are safe.
- **Acceptance criteria:** Configuration readiness reports no blockers for an approved complete term; missing/UNKNOWN faculty and room availability, capacity errors, invalid slots and breaks block timetable validation; calendar restrictions are checked; regression tests pass without touching either protected database.

## 10. Academic mapping and faculty timetable update — 2026-10-21

- Faculty profile query functions use a shared nullable query contract. An unlinked profile is represented as `null`, while loading, request failure, and missing-profile states are distinct in the faculty portal.
- Academic structure now constrains active term-semester mappings to the confirmed parity sets: ODD = 3/5/7 and EVEN = 4/6/8. An administrator can idempotently map existing active semester records for a selected term/program. The action does not create semester records or reactivate inactive mappings. Curriculum and faculty semester options apply the same parity rule.
- Read-only inspection of `slotify_dev` found demo-labelled 2025-26 and DEMO 2026-27 academic years; an EVEN term and a DEMO ODD term; only semester 3 records for each of the two demo schemes; two active semester mappings for the DEMO ODD term and none for the EVEN term. No 4th/5th/6th/7th/8th semester records were present. The current records therefore do not demonstrate a complete institutional configuration and must not be treated as real academic data.
- The faculty account used for the observed profile-query error has no active faculty profile link. The database also contains two scheduled sessions but zero PUBLISHED timetable versions. The faculty view consequently shows a missing-profile or no-published-schedule state; it does not expose draft sessions or invent a chart.
- New read-only faculty endpoints derive identity from the authenticated user, list approved assignment contexts, and return sessions only when the version is PUBLISHED and the faculty has a matching approved assignment. The page filters by academic year, parity, term, and authorized semester.
- Curriculum builder rows remain in-memory only. No existing curriculum-draft table/API was found. A persisted draft requires an additive schema migration and API; migration design/application is deferred for owner confirmation. No migration, seed, or database write was performed.
- **Verification:** `backend npm run typecheck` passed; focused `npx tsx --test` run passed 31/31; `frontend npm run build` passed. Vite emitted its existing >500 kB chunk warning. Database-backed integration and authenticated browser testing were not run because `slotify_test` is incomplete and the observed account has no faculty profile.

### Progress-update procedure

At the end of every future implementation session:

1. Update the relevant dashboard row based on actual evidence, not code presence.
2. Record changed files, endpoints, migrations, and database records separately.
3. Record exact test commands, pass/fail counts, and whether each touched a database.
4. Preserve historical ledger entries; append new evidence instead of rewriting old results as current.
5. Document defects, policy questions, and limitations; do not present assumptions as confirmed requirements.
6. Update task dependencies, priorities, acceptance criteria, and the next-session handoff.
7. Keep `slotify_dev` and `slotify_test` safe; state any database backup/recovery approval before destructive test setup.
