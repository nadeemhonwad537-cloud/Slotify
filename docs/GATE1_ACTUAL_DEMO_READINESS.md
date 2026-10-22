# Slotify Gate 1 Actual Demo Readiness

**Audit date:** 2026-10-22  
**Scope:** Read-only implementation inspection plus freshly executed database-independent checks.  
**Change policy:** No application, schema, migration, credentials, or database changes were made. This report is the only new file.

## A. Executive summary

### Verdict

**The application is not verified as a complete end-to-end product, but a limited, read-only demonstration may be possible** if an authorized account and approved-to-display existing data are available. No app server was running on ports 4000 or 5173 when checked. I did not start one: the backend reads its configured database and the workspace does not provide a verified safe demo database, authorized demo credentials, or a shared authenticated browser session.

The strongest safe demo candidate is the Admin **Validation & Conflicts** page's read-only **Check Configuration** action, or **Dry Run (Preview)** for an existing timetable version. The API implementation marks both paths read-only. They have not been exercised against actual data in this audit, so their output and operational behavior remain unverified. Do not use **Run & Save**, edit forms, lifecycle actions, or publication for a demo against real records.

The latest Requirements Package/FRD, Student Handbook, and Gate 1 Presentation were not found in the repository or Downloads search. The items below therefore map the 28 topics in the user's audit checklist, not official FRD wording or IDs. No FRD IDs, acceptance criteria, KPIs, or document statements are inferred.

### Checklist-topic counts

These counts cover the 28 checklist topics provided in the request. They are **not** counts of official FRs, and the status is an implementation-level classification, separate from verification evidence.

| Primary implementation status | Count | Meaning in this report |
|---|---:|---|
| PASS | 0 | No feature met a full end-to-end verification bar. |
| PARTIAL | 24 | Some relevant code/rules/UI exist; scope or required execution-path verification is incomplete. |
| FAIL | 0 | No safe live workflow was executed to reproduce a runtime failure. Source-visible gaps are called out without mislabeling them as reproduced runtime failures. |
| BLOCKED | 2 | Required official requirement inputs or verified student enrollment mapping are absent. |
| NOT IMPLEMENTED | 2 | No automatic generator and no unplaced-session reporting path were found. |
| NOT TESTED | 0 | Each checklist topic has at least an implementation inspection or an explicit dependency finding; many remain dynamically unverified. |

**Verification status:** 0 authenticated UI → API → database workflows verified; 85 database-independent Node tests passed; backend and frontend typechecks passed; frontend production build passed with a chunk-size warning.

### Critical limitations

- The approved disposable MySQL database was previously reported absent; its creation was denied. This audit did not retry creation or query either protected database.
- The Vitest suite invokes database reset and migrations from `globalSetup.ts`; it was not run.
- The prior read-only audit recorded migration tracking through 007 and 008/009 unapplied. That state was not re-queried. The code explicitly handles the possibility that migration 009's `curriculum_drafts` table and migration 008's practical-room approval field are unavailable.
- Student-to-section/elective mapping is absent. The student subjects UI explicitly shows all active courses, not the signed-in student's own courses.
- Automatic timetable generation is explicitly a separate, unimplemented milestone. A version-creation endpoint creates an empty draft.
- A database-backed API or browser workflow cannot be claimed as passed based on the Node rule tests, typechecks, or build.

## B. Requirement traceability

**Traceability limitation:** The Requirement ID field is “Not available” because no FRD was found. The Requirement column uses the user's checklist topic labels as audit prompts, not exact approved requirements. “Demo-ready?” means whether the feature can responsibly be shown as satisfying a requirement today, not whether a UI or code path exists.

| Requirement ID | Requirement / checklist topic (not FRD wording) | Code evidence | Test performed | Actual result | Status | Demo-ready? |
|---|---|---|---|---|---|---|
| Not available | 1. Authentication and role-based access | [auth.ts](../backend/src/routes/auth.ts), [auth.ts middleware](../backend/src/middleware/auth.ts), [security.ts](../backend/src/middleware/security.ts), [AppRouter](../frontend/src/router/index.tsx) | 85 Node tests include rule/safety coverage; no authenticated API/browser test run | HttpOnly access/refresh cookies, CSRF flow, `authenticate`, role-permission lookup, and frontend role routes exist. Real login, logout, refresh, role denial, and cookie behavior were not exercised. | PARTIAL; runtime verification blocked | Limited only with an authorized account; do not claim verified RBAC |
| Not available | 2. Academic years, terms, programs, semesters, divisions | [AcademicStructurePage](../frontend/src/pages/admin/AcademicStructurePage.tsx), [masterdata.ts](../backend/src/routes/masterdata.ts), [academicTermRules.ts](../backend/src/services/academicTermRules.ts) | `npx tsx --test tests\*.node.test.ts`; parity/mapping cases passed | UI, routes, schema-facing CRUD and parity rules exist. No authenticated CRUD or persisted reload was tested. | PARTIAL | Read-only page inspection only, if approved data/account exists |
| Not available | 3. Duplicate and invalid academic-context validation | [masterdata.ts](../backend/src/routes/masterdata.ts), [curriculumBuilder.ts](../backend/src/services/curriculumBuilder.ts), [curriculumSelection.ts](../backend/src/services/curriculumSelection.ts) | Same Node suite; context, duplicate, parity and audience rule tests passed | Business rules reject invalid parity, duplicate audience choices, and several cross-context cases. API/database rejection behavior was not exercised. | PARTIAL | Show unit-test evidence only; not operationally verified |
| Not available | 4. Curriculum subjects, components, contact hours | [CoursesPage](../frontend/src/pages/admin/CoursesPage.tsx), [CurriculumBuilder](../frontend/src/pages/admin/CurriculumBuilder.tsx), [curriculumBuilder.ts](../backend/src/services/curriculumBuilder.ts) | Same Node suite; curriculum totals/components/draft serialization cases passed | Subject/component editor and validations exist. Published records are marked `VERIFY`; no persisted curriculum was created/read back in this audit. | PARTIAL | Limited UI walkthrough; no write or persistence claim |
| Not available | 5. Curriculum draft save, reload, update, delete | [masterdata.ts](../backend/src/routes/masterdata.ts), [curriculumDraftRules.ts](../backend/src/services/curriculumDraftRules.ts), [curriculumDraftEditor.ts](../backend/src/services/curriculumDraftEditor.ts) | Same Node suite; serialization and stale-version rules passed | CRUD endpoints use context checks, optimistic version checks and transactions. They return an explicit unavailable response if the draft table is missing; migration 009 was not applied in the prior recorded DB inspection. No API persistence test was run. | PARTIAL; DB/migration verification blocked | No live draft demo without verified migration state |
| Not available | 6. Curriculum publication and transactional integrity | [masterdata.ts](../backend/src/routes/masterdata.ts), [pool.ts](../backend/src/db/pool.ts), [curriculumAudienceRules.ts](../backend/src/services/curriculumAudienceRules.ts) | Same Node suite; curriculum rule tests passed; no DB rollback test | Publish creates course/component/offering/audience/curriculum rows inside `withTransaction` and consumes a supplied saved draft in the same transaction. Rollback and actual schema compatibility are unverified. | PARTIAL | Do not publish during demo |
| Not available | 7. Faculty profiles and authenticated profile linkage | [submissions.ts](../backend/src/routes/submissions.ts), [facultyProfileQuery.ts](../backend/src/services/facultyProfileQuery.ts), [facultyProfileQuery.node.test.ts](../backend/tests/facultyProfileQuery.node.test.ts) | Same Node suite; profile query handles linked profile, null and null-like response | The own-profile endpoint derives the account from `req.user`; helper tests pass. No authenticated identity-to-DB linkage was run. | PARTIAL | Limited; no cross-account access claim |
| Not available | 8. Faculty preferences | [submissions.ts](../backend/src/routes/submissions.ts), [submissionService.ts](../backend/src/services/submissionService.ts), [PreferencesPage](../frontend/src/pages/faculty/PreferencesPage.tsx), [submissionPreferences.node.test.ts](../backend/tests/submissionPreferences.node.test.ts) | Same Node suite; preference count, duplicates and submission rules passed | Preference draft/submit code and editor states exist. Save/reload/review behavior against DB and real faculty identity is unverified. | PARTIAL | Do not submit or alter a real faculty preference |
| Not available | 9. Faculty availability and override behavior | [submissions.ts](../backend/src/routes/submissions.ts), [validationService.ts](../backend/src/services/validationService.ts), [AvailabilityPage](../frontend/src/pages/faculty/AvailabilityPage.tsx), [facultyAvailabilityEditor.node.test.ts](../backend/tests/facultyAvailabilityEditor.node.test.ts) | Same Node suite; malformed/overlapping ranges and editor loading states passed | Availability rules exist; UNKNOWN is blocking. The existing timetable availability override marker is not honored as an override; validation/lifecycle remains blocking for unresolved availability. No live save or override test. | PARTIAL; override support absent | Do not demonstrate override as supported |
| Not available | 10. Classroom and laboratory management | [RoomsPage](../frontend/src/pages/admin/RoomsPage.tsx), [masterdata.ts](../backend/src/routes/masterdata.ts), [schedulingConfigurationService.ts](../backend/src/services/schedulingConfigurationService.ts) | Same Node suite; configuration rules cover active rooms, capacity and practical approval cases | Room CRUD and configuration reads exist. Migration 008 practical approval support is conditional; no live room CRUD or schema test. | PARTIAL | Read-only inspection only |
| Not available | 11. Room suitability and capacity validation | [schedulingConfiguration.ts](../backend/src/services/schedulingConfiguration.ts), [validationService.ts](../backend/src/services/validationService.ts), [schedulingConfiguration.node.test.ts](../backend/tests/schedulingConfiguration.node.test.ts) | Same Node suite; capacity and explicit classroom-practical approval rule tests passed | Rule layer rejects missing/exceeded capacity and unapproved classroom practical use; persisted validation and migration-dependent behavior remain unverified. | PARTIAL | Demo a test result, not a live timetable outcome |
| Not available | 12. Faculty, curriculum, and division assignments | [assignments.ts](../backend/src/routes/assignments.ts), [AssignmentsPage](../frontend/src/pages/admin/AssignmentsPage.tsx), [allocationRules.ts](../backend/src/services/allocationRules.ts) | Same Node suite; allocation eligibility/finalization rules passed | Allocation planning/finalization and assignment CRUD/approval paths exist. Database writes, authorization, downstream readiness and rollback were not exercised. | PARTIAL | No real assignment changes |
| Not available | 13. Faculty workload calculations | [workloadService.ts](../backend/src/services/workloadService.ts), [assignments.ts](../backend/src/routes/assignments.ts), [workloadService tests via allocationRules.node.test.ts](../backend/tests/allocationRules.node.test.ts) | Same Node suite; workload status/enforcement rule tests passed | Workload separates confirmed/unconfirmed hours and returns warning states for missing verified policy. Actual workload query results and DB policy data are not validated here. | PARTIAL | Demonstrate only as code/test evidence |
| Not available | 14. Timetable version creation, editing, validation | [timetable.ts](../backend/src/routes/timetable.ts), [timetableSessionService.ts](../backend/src/services/timetableSessionService.ts), [TimetableVersionsPage](../frontend/src/pages/admin/TimetableVersionsPage.tsx) | Same Node suite; session-option/context rules passed | Version API creates an empty draft; manual session CRUD is draft-only and uses version locks/validation. No DB write/readback or browser test. | PARTIAL | Safe only to inspect existing records; do not create/edit |
| Not available | 15. Division, faculty, classroom, laboratory conflict detection | [validationService.ts](../backend/src/services/validationService.ts), [scheduleRules.ts](../backend/src/rules/scheduleRules.ts), [ValidationPage](../frontend/src/pages/admin/ValidationPage.tsx) | Same Node suite; constraint rules covered in unit/helper tests | Conflict-checking implementation exists for faculty overlap, room double booking, audience overlap, availability and other constraints. A real timetable validation was not executed. | PARTIAL | Use Dry Run only if approved existing data/account is available |
| Not available | 16. Consecutive practical sessions and batch rules | [schedulingConfiguration.ts](../backend/src/services/schedulingConfiguration.ts), [timetableSessionRules.ts](../backend/src/services/timetableSessionRules.ts), [timetableSessionRules.node.test.ts](../backend/tests/timetableSessionRules.node.test.ts) | Same Node suite; consecutive-slot, audience and batch-scope tests passed | Helpers enforce adjacent slots and division/batch audience rules. No persisted practical timetable was tested; cross-break policy remains unconfirmed/not enforced per audit notes. | PARTIAL | Show test evidence with limitation |
| Not available | 17. Coordinated generation across all term divisions | [timetable.ts](../backend/src/routes/timetable.ts), [admin.ts](../backend/src/routes/admin.ts) | Source inspection/search; no generator test | No automatic generation algorithm or callable generation endpoint was found. The version endpoint explicitly creates an empty draft. | NOT IMPLEMENTED | No |
| Not available | 18. Unplaced-session and infeasibility reporting | [timetable.ts](../backend/src/routes/timetable.ts), [validationService.ts](../backend/src/services/validationService.ts) | Source inspection; no generation/infeasibility test | Validator emits constraint issues, but no generator exists to report unplaced generated sessions or a generator feasibility result. | NOT IMPLEMENTED | No |
| Not available | 19. Draft, review, approval, publication, change-request, archival lifecycle | [timetable.ts](../backend/src/routes/timetable.ts), [timetableLifecycleService.ts](../backend/src/services/timetableLifecycleService.ts), [TimetableVersionsPage](../frontend/src/pages/admin/TimetableVersionsPage.tsx) | Same Node suite; lifecycle state/permission helper tests passed | Transition code, audit/action records and UI controls exist. No real role grant, transaction, trigger, API or UI transition was exercised. | PARTIAL | Discuss only as implemented but unverified; do not click lifecycle actions |
| Not available | 20. Publication authorization, history, rollback safety | [timetableLifecycleService.ts](../backend/src/services/timetableLifecycleService.ts), [pool.ts](../backend/src/db/pool.ts), [timetableLifecycleRules.node.test.ts](../backend/tests/timetableLifecycleRules.node.test.ts) | Same Node suite; publish precondition and actor-role helper tests passed | Code locks the term/version, revalidates, archives the prior publication, records history and publishes in a transaction. Actual atomicity, DB uniqueness constraint, and deployed permissions were not tested. | PARTIAL | Do not publish or claim rollback verified |
| Not available | 21. Faculty restricted to own published timetable | [facultyTimetableService.ts](../backend/src/services/facultyTimetableService.ts), [timetable.ts](../backend/src/routes/timetable.ts), [facultyTimetableQuery.node.test.ts](../backend/tests/facultyTimetableQuery.node.test.ts) | Same Node suite; profile-specific cache key isolation test passed | Query scopes through authenticated user → active faculty profile → approved assignment → PUBLISHED version. No API/account-switch/browser verification. | PARTIAL | Show the scope design, not verified access |
| Not available | 22. Student restricted to verified division timetable | [Student TimetablePage](../frontend/src/pages/student/TimetablePage.tsx), [Student SubjectsPage](../frontend/src/pages/student/SubjectsPage.tsx), [backend routes](../backend/src/routes) | Source inspection; no student mapping test | Student timetable explicitly reports unavailable. Student subjects currently requests active courses system-wide. No student profile/division mapping or student-scoped timetable API was found. | BLOCKED; required mapping/API absent | No; explain as a known gap |
| Not available | 23. Readiness checks and prerequisite validation | [schedulingConfigurationService.ts](../backend/src/services/schedulingConfigurationService.ts), [schedulingConfiguration.ts](../backend/src/services/schedulingConfiguration.ts), [ValidationPage](../frontend/src/pages/admin/ValidationPage.tsx) | Same Node suite; mapping, divisions, rooms, teaching grid, workload and suitability rule tests passed | GET readiness aggregates live academic configuration and returns issue details. It was not called against a database; institutional assumptions (including expected room/division counts) need confirmation. | PARTIAL | Best read-only demo candidate if existing data is approved |
| Not available | 24. Import preview and validation | [workloadImports.ts](../backend/src/routes/workloadImports.ts), [workloadImportPreview.ts](../backend/src/services/workloadImportPreview.ts), [WorkloadImportPage](../frontend/src/pages/admin/WorkloadImportPage.tsx) | Same Node suite; source serial, duplicate, mapping and preview-only tests passed | Preview parsing/mapping logic exists and preview is marked `PREVIEW_ONLY`/`writesPerformed: false`; an authenticated upload/confirmation/promotion workflow was not demonstrated. | PARTIAL | Preview only; do not import/promote |
| Not available | 25. Audit/history traceability | [audit.ts](../backend/src/services/audit.ts), [timetableLifecycleService.ts](../backend/src/services/timetableLifecycleService.ts), [submissions.ts](../backend/src/routes/submissions.ts) | Same Node suite includes lifecycle rules; no audit readback test | Several lifecycle, curriculum and faculty actions write audit/action entries. Coverage, append-only behavior, timestamps and actor values were not checked in DB. | PARTIAL | Do not claim complete audit coverage |
| Not available | 26. Data integrity and security | [pool.ts](../backend/src/db/pool.ts), [auth.ts middleware](../backend/src/middleware/auth.ts), [security.ts](../backend/src/middleware/security.ts), [migrations](../database/migrations) | Typechecks and safe Node rules passed; DB constraints/API auth tests not run | Parameterized query helpers, transaction wrapper, permission middleware, security middleware and schema migrations exist. Deployed schema constraints, CSRF, session revocation and authorization were not verified. | PARTIAL | Avoid security/integrity certification claims |
| Not available | 27. Reports, exports, usability | [admin.ts](../backend/src/routes/admin.ts), [AdminShell](../frontend/src/components/layout/AdminShell.tsx), current role pages | Source inventory; no report/export or browser usability test | Dashboard summaries and role navigation exist; the prior audit found no general reporting/export route or page. Usability, accessibility and presentation behavior were not measured. | PARTIAL; general reporting/export absent | Limited UI walkthrough only |
| Not available | 28. Additional requirements / KPIs / priorities / other Gate 1 criteria | No accessible FRD, use-case, KPI or official engine-definition document | Searched repository and Downloads; no source documents found | Cannot enumerate or assess any additional actual requirements without the baseline documents. | BLOCKED | No claims about unprovided criteria |

## C. Feature-by-feature audit notes

### Implemented in code, not proven end to end

- Role-protected routes, cookie-based authentication, CSRF hooks, and database-backed permissions are present, but no login/logout/role-denial path was run.
- Academic structure, curriculum, faculty preference/availability, rooms, assignment/workload, timetable sessions, validation, and lifecycle have UI/API/business-rule code. Their create/save/reload/authorization behavior against a live database remains unverified.
- Timetable validation is **manual constraint checking**, not automatic timetable generation. It checks session references/context and rules such as overlaps, capacity, suitability, availability, teaching slots and consecutive periods.
- Timetable lifecycle UI and service expose submit-for-review, request-changes, approval, publication and archived replacement behavior. Only pure rule helpers were tested in this run; database transitions, permissions and rollback are unverified.
- Workload import has a preview/validation path. Preview-only tests do not prove a safe end-to-end import/promotion workflow.

### Explicit missing/blocked behavior

- **Automatic generation:** no algorithm or callable application endpoint; only empty draft creation and manual session editing were found.
- **Unplaced sessions:** no generator means no unplaced-session result path. Validation issues are not a substitute.
- **Student timetable:** no trusted student-to-division/elective mapping. Student timetable page presents an explicit unavailable notice; student subjects are not individually scoped.
- **Curriculum drafts:** API checks for `curriculum_drafts`; if absent, it responds with a migration-required error. Prior audit notes say migration 009 was not recorded as applied. Do not assume draft persistence is available in the current database.
- **Room practical approval:** validation checks for `practical_approved`; absent support blocks practical suitability. Prior audit notes say migration 008 was not recorded as applied.
- **Availability overrides:** current unknown-availability rules block; no verified supported override behavior was demonstrated.
- **Reports/exports:** no general reporting/export implementation was identified in the existing audit inventory.
- **Official FRD and KPIs:** unavailable, so exact traceability, targets, priorities, and approval criteria remain unresolved.

## D. Four-engine verification

The mapping below preserves the definitions supplied in the audit request. No official project-guide definition was available to confirm terminology.

| Engine | Actual implementation and evidence | Tests supporting claim | Missing / designed-only work | Realistic demonstration |
|---|---|---|---|---|
| **E1 — DSA: constraints/generation** | Constraint validation in `computeValidation` in [validationService.ts](../backend/src/services/validationService.ts), domain checks in [schedulingConfiguration.ts](../backend/src/services/schedulingConfiguration.ts), and validation UI in [ValidationPage.tsx](../frontend/src/pages/admin/ValidationPage.tsx). | The 85-test Node run included scheduling/configuration and session rule tests, e.g. “capacity excess and missing size are blocking; classroom practical needs explicit approval” and “slot options only include adjacent periods without a time gap.” | No automatic generator, coordinated search/heuristic, unplaced output or measured generation performance. No live timetable was validated. | With authorized access and approved existing data, use **Academic Term Configuration Readiness → Check Configuration** (read-only). Optionally use **Dry Run (Preview)** for an existing version only. Label output as validation, not generation. |
| **E2 — Web Development: workflows** | Role router in [index.tsx](../frontend/src/router/index.tsx); backend mounting in [app.ts](../backend/src/app.ts); feature pages call APIs, including [TimetableVersionsPage.tsx](../frontend/src/pages/admin/TimetableVersionsPage.tsx). | Typechecks/build passed; UI-state and business-rule Node tests passed. | No browser session, API integration or database roundtrip was tested; a working backend was not running. | Read-only role navigation and data display with an authorized account and approved dataset. Do not submit forms or claim end-to-end behavior. |
| **E3 — Operating Systems: concurrency/resource coordination** | `withTransaction` in [pool.ts](../backend/src/db/pool.ts), term/version `FOR UPDATE` locks in [timetableLifecycleService.ts](../backend/src/services/timetableLifecycleService.ts), version lock in [timetableSessionService.ts](../backend/src/services/timetableSessionService.ts), and term lock when allocating version numbers in [timetable.ts](../backend/src/routes/timetable.ts). | Rule helpers cover lifecycle and stale-version conditions; the Node suite has no concurrent database test. | Locks/transactions are code evidence of some concurrency control, not proof of safe simultaneous operations and not a separate OS scheduling engine. No races, contention, retries or deadlock behavior were tested. | Do not stage concurrent edits on real data. A future safe demo needs a disposable DB and two controlled clients racing on a synthetic version, with conflict/rollback assertions. |
| **E4 — DBMS: persistence/integrity** | MySQL pool and transaction helper in [pool.ts](../backend/src/db/pool.ts); migration files in [database/migrations](../database/migrations); curriculum, assignment, session and lifecycle SQL in their route/service files. | Static/type and pure rules only. The DB integration suite was intentionally not run. | Current applied migration state, SQL constraints, persisted draft/session roundtrip, rollback, triggers and live transaction behavior were not verified during this audit. | No live persistence demo can be certified. Use an isolated approved disposable schema after DBA provisioning, then prove create/read/update/rollback without touching protected databases. |

## E. Demo runbook

### Preconditions and safe boundaries

1. Use only an existing authorized account. Do not invent, request, or expose credentials in this report.
2. Confirm the account is approved for the audience and the displayed data may be shown to the guide.
3. Do not create, edit, import, submit, approve, publish, retire, or delete records. Do not use `Run & Save`.
4. The backend uses environment configuration from `backend/.env`; do not edit it. Existing notes identify `slotify_dev` as the local development target. Starting the application or using its write controls against that database is not part of this verified audit.
5. No server was running on ports 4000/5173 during the audit, and no authenticated browser page was shared. The runbook below is a manual procedure, not a performed test.

### Optional local startup (not executed in this audit)

If the project owner has confirmed the existing local development setup is appropriate for a read-only screen demonstration:

**Terminal 1**

```powershell
Set-Location 'C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\backend'
npm run dev
```

**Terminal 2**

```powershell
Set-Location 'C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\frontend'
npm run dev
```

Open `http://localhost:5173/login`. Vite proxies `/api` to `http://localhost:4000`. Use only an already-provisioned authorized account. These commands were not run; a server startup does not establish database or workflow correctness.

### Safest candidate walkthrough: readiness

Precondition: authorized Admin account, term data approved for display, no data mutations.

1. Sign in through `/login`.
2. Open Admin navigation **Validation & Conflicts** (`/admin/validation`).
3. In **Academic Term Configuration Readiness**, select an existing term.
4. Click **Check Configuration**.
5. Inspect whether the page reports ready/blocked, active division count, expected semesters, active room count, and listed issues.
6. Explain that this reads configured data and checks readiness; it does not generate or save a timetable.

Expected from source: the page calls `GET /api/timetable/configuration/:termId`; backend assembles configuration and applies scheduling rules. **Actual response is not known until this manual step is performed.** Capture a screenshot only if the owner approves the underlying data for display.

### Optional existing-version preview (read-only)

Precondition: same, plus an existing version that may be displayed and permission to run timetable validation.

1. On **Validation & Conflicts**, choose an existing version in the version selector.
2. Click **Dry Run (Preview)** (not **Run & Save**).
3. Review the displayed errors/warnings. Do not attempt a correction in the version.

Expected from source: `POST /api/timetable/validate` with `dry_run: true` calls `computeValidation` and returns results without persistence. This path still reads the configured database and requires permission; no result was collected here.

### What not to demonstrate

- Do not click **New Version**, **Add Session**, **Save Changes**, **Run & Save**, **Submit for review**, **Approve for publication**, **Publish timetable**, **Request Changes**, import/promote, or CRUD controls.
- Do not claim an automatic timetable generator, student timetable, working availability override, end-to-end authentication, DB persistence, publication rollback, or measured KPI.
- Do not use student subjects as proof of student-scoped data; its page warns that it lists all active courses.

## F. Missing requirements and blockers

| Priority | Gap / blocker | Dependency | Smallest safe next step |
|---|---|---|---|
| P0 — integrity/security evidence | Auth, permissions, DB constraints, lifecycle atomicity not verified at required runtime level | Approved isolated DB and synthetic role accounts | DBA provisions the already-approved disposable target. Then run API/integration tests against it only; verify permissions and rollback. |
| P1 — core functionality | Automatic coordinated generator absent | Verified scheduling configuration, assignments, validation, and official constraints | Keep it explicitly planned until the prerequisites pass; implement only against the existing domain model after requirement baseline approval. |
| P1 — student access | No student-to-division/elective mapping or scoped API | Approved institutional enrollment model and identity source | Obtain an approved mapping model; do not guess student assignments. |
| P1 — curriculum persistence | Draft persistence requires migration 009, current application state uncertain | Isolated DB and migration prerequisite review | Verify on disposable DB only; do not apply 009 to protected DBs. |
| P1 — practical suitability | Explicit classroom practical approval requires migration 008 | Isolated DB and room-policy approval | Verify migration prerequisites and behavior on disposable DB; no existing DB migration. |
| P1 — override behavior | Override marker is not accepted by validator | Approved policy and lifecycle permission/audit model | Confirm policy first; then design implementation/test plan. |
| P2 — evidence gap | No authenticated browser/API→DB test in this run | Authorized test accounts, safe browser session, disposable DB | Capture actual role-scoped workflow evidence and test output after safe environment is ready. |
| P2 — requirements traceability | Official FRD, use cases, KPIs, handbook, presentation absent | Latest approved documents | Add the approved source documents to the workspace and redo ID-level mapping without changing the baseline. |
| P2 — reports/exports | No general report/export workflow identified | Approved report requirements | Confirm whether required; implement only if in the approved baseline. |

## G. Evidence register

### Newly collected on 2026-10-22

| Evidence | Command / inspection | Result |
|---|---|---|
| Backend types | From `backend`: `npm run typecheck` | Exit 0; `tsc --noEmit -p tsconfig.json` passed. |
| Database-independent tests | From `backend`: `npx tsx --test tests\*.node.test.ts` | Exit 0; **85 tests, 85 passed, 0 failed, 0 skipped/cancelled**; duration reported 4603 ms. |
| Frontend types | From `frontend`: `npm run typecheck` | Exit 0; passed. |
| Frontend production build | From `frontend`: `npm run build` | Exit 0; TypeScript and Vite build passed. Vite warning: main JS chunk `564.03 kB`, exceeding the 500 kB advisory threshold. |
| Server availability | `Get-NetTCPConnection -State Listen -LocalPort 4000,5173` | No listeners returned. App not started. |
| Browser availability | Integrated browser tools are available, but no authenticated browser page was shared and no app server was running. | No browser workflow/screenshot captured. |
| Gate 1 document availability | Search of repository and Downloads for Gate 1/requirements/FRD/handbook document formats | No matching `.docx`, `.pptx`, or `.pdf` source document found. |
| Test safety | Inspected [vitest.config.ts](../backend/vitest.config.ts) and [globalSetup.ts](../backend/tests/globalSetup.ts) | Vitest global setup calls `resetDatabase()` and `runMigrations({ seed: true })`; `npm test` was therefore not run. |

Representative tests included in the 85-test run (not a separate API/E2E run):

- “odd terms allow only semesters 3, 5 and 7” — [academicTermRules.node.test.ts](../backend/tests/academicTermRules.node.test.ts)
- “capacity excess and missing size are blocking; classroom practical needs explicit approval” — [schedulingConfiguration.node.test.ts](../backend/tests/schedulingConfiguration.node.test.ts)
- “availability refetch errors block editing even when cached submission data exists” — [facultyAvailabilityEditor.node.test.ts](../backend/tests/facultyAvailabilityEditor.node.test.ts)
- “faculty timetable cache keys are isolated by faculty profile” — [facultyTimetableQuery.node.test.ts](../backend/tests/facultyTimetableQuery.node.test.ts)
- “publishing requires an approved version, a clean validation, sessions, and resolved availability” — [timetableLifecycleRules.node.test.ts](../backend/tests/timetableLifecycleRules.node.test.ts)
- “slot options only include adjacent periods without a time gap” — [timetableSessionRules.node.test.ts](../backend/tests/timetableSessionRules.node.test.ts)
- “parses all source serial numbers and preserves the missing row without inventing values” — [workloadImportPreview.node.test.ts](../backend/tests/workloadImportPreview.node.test.ts)

### Prior evidence, not freshly repeated here

- [FUNCTIONAL_AUDIT.md](./FUNCTIONAL_AUDIT.md), [TEST_PLAN.md](./TEST_PLAN.md), [PROJECT_STATUS.md](./PROJECT_STATUS.md), root [HANDOVER.md](../HANDOVER.md), and [BACKEND_PROGRESS.md](./BACKEND_PROGRESS.md) record an earlier read-only inspection: `slotify_dev` had 52 base tables and migration tracking through 007; migrations 008 and 009 were not recorded; approved disposable target `slotify_test_disposable_audit_20261022_1219` was absent; creation was denied with `ER_DBACCESS_DENIED_ERROR`. These facts were not re-queried during this audit.
- Earlier browser verification notes in handover/project docs refer to past faculty read-only walkthroughs. They are historical evidence only; this audit did not reproduce those steps.
- No screenshots, network traces, API responses, DB transaction results, or browser console records were captured during this audit.

## H. Gate 1 presentation claims

### Safe to claim as implemented and verified (limited to the actual verification level)

- Backend and frontend typechecks passed on 2026-10-22.
- 85 database-independent Node tests passed on 2026-10-22.
- Frontend production bundle built successfully; it emitted a chunk-size advisory.
- Unit/helper coverage exists for academic parity rules, curriculum validation, workload/allocation rules, availability editor states, scheduling constraints, lifecycle preconditions, and workload import preview parsing.

Do **not** translate these into “the application is fully verified”; no end-to-end workflow was run.

### Safe to demonstrate only with a limitation disclosed

- Existing Admin/Faculty/Student page structure and role-specific navigation, if an authorized account is available.
- Admin **Validation & Conflicts** read-only configuration check.
- **Dry Run (Preview)** for an existing timetable version, if the account has permission and data is approved for display.
- Existing timetable version/session/lifecycle UI as a code-backed interface only; do not mutate real records.
- Curriculum builder, room, assignment, preference, availability and import-preview screens as UI/code demonstrations only; database persistence was not verified.

### Must be described as planned, incomplete, blocked, or unverified

- Automatic timetable generation, coordinated scheduling, and infeasibility/unplaced-session results.
- Student-specific subjects or published timetable access.
- Curriculum draft persistence unless migration/schema availability is safely verified.
- Practical room suitability on a deployed schema unless migration 008 is safely verified.
- Availability overrides.
- Full auth/RBAC, persistence, transaction/rollback, audit completeness, account isolation, and publication behavior.
- General reporting/exports and all unprovided KPI targets.
- Any official FR mapping, priority, use-case coverage, or presentation/handbook consistency conclusion while those source documents are absent.

## I. Prioritized remediation plan

1. **Obtain the current approved FRD, handbook, presentation and project-guide engine definitions.** Populate official requirement IDs and exact wording before claiming traceability.
2. **Restore safe integration-test capability.** Have an authorized DBA provision the already-approved empty disposable schema; verify loopback host, exact DB name, no valuable data, reset guard and explicit consent before invoking Vitest. Never use `slotify_dev` or `slotify_test`.
3. **Verify existing critical paths before adding features.** On the disposable DB, cover login/role denial, curriculum draft save/reload/stale update/delete, publish rollback, room/availability validation, assignments/workload, timetable session edits and lifecycle transitions.
4. **Resolve policy/schema dependencies.** Verify migration prerequisites for 008/009 only in the disposable environment; confirm availability override, workload, calendars, room inventory and lifecycle permission policies with the institution.
5. **Define student mapping and generator prerequisites.** Obtain an authoritative enrollment mapping; then validate readiness, assignments, shared resources and term constraints before implementing a coordinated generator.

## Completion statement

This report is an evidence-based implementation and demo-readiness review, **not** a completed FRD compliance audit. The functional application was not started, no authenticated workflow was run, and no database was touched. The current honest demonstration is a source/test/build walkthrough or a strictly read-only UI walkthrough with an authorized account and approved existing data. Automatic generation, student timetable scoping, database persistence, and publication integrity must not be presented as verified.
