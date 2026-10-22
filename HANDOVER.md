# Slotify handover

## Current checkpoint — Timetable review and publication workflow (2026-10-22)

- Reused the existing `DRAFT`, `VALIDATED`, `IN_REVIEW`, `APPROVED`, `PUBLISHED`, and `ARCHIVED` states, `approval_actions`, `audit_logs`, and role permissions; no migration or database write was needed.
- Reference permission seed grants ADMIN `timetable:review` and provisional `timetable:publish`; COORDINATOR `timetable:review` and `timetable:approve` are provisional. Routes enforce these permissions, but live database role grants were not queried. `REJECTED` remains an existing status without a reject action in this workflow.
- Added permission-checked submit-for-review, request-changes, approve, and publish transitions. Each review/approval/publication gate reruns persisted timetable validation; the publish transaction serializes on the term, archives any current publication, publishes the replacement, and records audit/history actions atomically.
- Extended timetable validation to block empty versions, academic-context/audience mismatches, inactive or unverified core references, and faculty assignments that no longer match an active verified profile and scheduled audience.
- Admin Timetable Versions now displays validation findings, status/context, review actions, approval history, and the current versus archived publication history.
- Faculty reads remain authenticated-profile-scoped and PUBLISHED-only. The Student timetable remains unavailable because no student-to-section/elective mapping or student-scoped API exists. Automatic generation remains unimplemented.
- Verification: backend typecheck passed; focused database-independent tests passed (12/12); frontend production build passed with the existing Vite chunk-size warning. No browser, DB-backed tests, database writes, or migrations were run. `slotify_test` remains incomplete and untouched.

## Current checkpoint — Draft timetable session management (2026-10-21)

- Added version-scoped session list/detail/options APIs and draft-only create/update/delete APIs, reusing the existing session, audience, faculty and version tables.
- Session writes lock and verify the DRAFT version, derive date/time from verified configured teaching slots, require an in-version offering audience and approved verified faculty assignments, and run the existing timetable validator inside the write transaction. New validation errors roll the change back.
- The Timetable Versions page now lists sessions and supports draft add/edit/delete, with confirmation, validation errors, success notices, refreshes and a read-only state for non-DRAFT versions.
- Allocation finalization and individual assignment approval continue to block missing/unverified availability and other required verification gaps.
- Backend typecheck passed; focused database-independent tests passed (26/26); frontend production build passed with the existing Vite chunk warning. No database-backed tests, migrations, database writes, or browser workflow were run for session management.
- Existing `slotify_test` remains incomplete. Database-backed tests require an explicitly approved local disposable test database; neither it nor `slotify_dev` was touched.

## Previous checkpoint — Allocation safety and timetable configuration (2026-10-21)

- The default Vitest setup requires explicit consent and a local `slotify_test_disposable_<unique_suffix>` target.
- MySQL error 1419 guidance directs operators to stop and consult a DBA rather than changing binary logging/global settings, granting broad privileges, or resetting a database.

## Previous checkpoint — Faculty preference flow recovery (2026-10-20)

- Confirmed the project directory has no Git metadata; `git status` is unavailable here.
- Fixed the faculty preference page's role-based profile lookup by adding `GET /api/faculty-submissions/mine/profile`, which returns only the authenticated faculty member's active profile (or `null`). Updated all faculty pages that previously called the restricted admin/reviewer faculty list.
- Updated `FacultyShell` to skip its submission gate lookups on the preferences route, so that the form can load rather than being blocked by the lookups it itself needs.
- Browser verified with the provided faculty account: login, linked profile, active term, five offered subjects, preference selection/order, availability controls, and review summary all rendered. Test selections were not saved or submitted.
- A later browser reload showed `UNAUTHENTICATED`; signing in again restored the page. The access cookie is short-lived by design; this was an expired session, not a remaining preferences-page permission error.
- Historical backend tests: **224/224 passed** (`npm test`; the then-current Vitest global setup rebuilt `slotify_test`; that setup has since been changed to require an explicitly approved disposable target).
- Backend typecheck/build and frontend typecheck/build all passed.
- Faculty workflow endpoints persist drafts/availability and have API integration tests. Live browser verification stopped before saving/submitting, to avoid changing the account's real preferences.
- The application currently caps preferences at three and requires exactly three to submit. The source university specification/workbook is unavailable, so the exact required count is still an unverified policy assumption; confirm it before changing this behavior.

### Gaps at the 2026-10-21 checkpoint

- Timetable generation remained unimplemented; approval/publishing was implemented in the 2026-10-22 checkpoint above.
- Student section mapping remains a schema/workflow gap.
- No end-to-end write was made to the shared development account during browser verification.

### Start commands

```powershell
# Terminal 1
Set-Location .\backend
npm run dev

# Terminal 2
Set-Location .\frontend
npm run dev
```

The backend requires `backend/.env` configured for `slotify_dev`. Database-backed Vitest runs require `SLOTIFY_TEST_DB_NAME=slotify_test_disposable_<unique_suffix>` and `SLOTIFY_ALLOW_DISPOSABLE_DB_RESET=YES`; do not point the test runner at `slotify_dev` or the existing `slotify_test`. Never run `npm run db:reset` against `slotify_dev`.

## Historical implementation notes

The notes below document earlier implementation milestones and their verification at that time.

## What exists and was verified (MySQL 8.0.46, local machine)
| Item | Status |
|---|---|
| Foundation (schema, auth, RBAC, security) | Verified |
| **Milestone 1** master-data REST API: 23 resources, all business rules | Done, tested |
| **Milestone 2** faculty submission workflow | Done, tested |
| **Milestone 3** assignments API + workload service | Done, tested |
| **Milestone 4** timetable validation engine | Done, tested |
| **Admin Portal** — complete React/TS/Vite/Tailwind admin UI | Done — typecheck + build pass |
| New: `GET /api/timetable/versions` list endpoint | Done |
| New: `POST /api/timetable/versions` create draft | Done |
| New: `GET/PATCH /api/users/:id` + `POST /api/users/:id/reset-password` | Done |
| New: `GET /api/assignments/audiences` enriched audience list | Done |
| `npm run typecheck` (backend) | Passed (0 errors) |
| `npm run typecheck` (frontend) | Passed (0 errors) |
| `npm run build` (frontend) | Passed — 378 kB bundle |
| `npm test` (backend) | **215/215 passed** |
| Foundation (schema, auth, RBAC, security) | Verified |
| **Milestone 1** master-data REST API: 23 resources, all business rules | Done, tested |
| **Milestone 2** faculty submission workflow | Done, tested |
| **Milestone 3** assignments API + workload service | Done, tested |
| **Milestone 4** timetable validation engine | Done, tested |
| **Phase 1 Frontend** — complete React/TS/Vite/Tailwind application | Done — typecheck + build pass |
| `npm run typecheck` (backend) | Passed |
| `npm run typecheck` (frontend) | Passed |
| `npm run build` (frontend) | Passed — 306 kB bundle |
| `npm test` (backend) | **198/198 passed** |

## Phase 1 Frontend — what was built

### Infrastructure
- `frontend/package.json` — React 18, TypeScript, Vite 5, Tailwind 3, React Router 6, TanStack Query 5, Lucide icons
- `frontend/vite.config.ts` — proxies `/api` to `http://localhost:4000`; no hardcoded credentials
- `frontend/src/lib/api.ts` — typed fetch client; auto-fetches CSRF token, sends `x-csrf-token` header on mutations, retries once on CSRF expiry
- `frontend/src/lib/queryClient.ts` — TanStack Query client; no retry on 401/403
- `frontend/src/contexts/AuthContext.tsx` — session restore on mount, login, logout, hasRole
- `frontend/src/types/index.ts` — TypeScript interfaces for all backend entities
- `frontend/src/router/index.tsx` — role-based routing; `RequireAuth` guards; `RoleRedirect` sends each role to their portal

### Shared UI components
`Badge`, `StatusBadge`, `Card`, `StatCard`, `DataTable`, `EmptyState`, `ErrorMessage`, `FormError`, `Modal`, `ConfirmModal`, `PageHeader`, `LoadingScreen`

### Layout shells (role-specific sidebars matching diagrams)
- `AdminShell` — 11-item nav matching Admin Role diagram
- `FacultyShell` — 7-item nav matching Faculty Role diagram (includes Account Settings). First-login gate uses `useEffect`-based navigation (not `setTimeout`) and correctly blocks on `NOT_STARTED`, `DRAFT`, `RETURNED` while allowing `SUBMITTED` (all review statuses).
- `StudentShell` — 3-item nav matching Student Role diagram
- All shells: responsive, collapsible mobile nav, user footer with logout

### Admin portal pages (all connected to real APIs)
| Page | Route | API endpoints used |
|---|---|---|
| Login | `/login` | `/api/auth/csrf`, `/api/auth/login` |
| Dashboard | `/admin` | `/api/auth/me`, departments, terms, assignments |
| Manage Users | `/admin/users` | `/api/users` (GET/POST/PATCH status) |
| Departments | `/admin/departments` | `/api/masterdata/departments` (full CRUD) |
| Academic Structure | `/admin/academic-structure` | years, terms, sections |
| Courses | `/admin/courses` | courses, components |
| Faculty | `/admin/faculty` | faculty, designations, departments |
| Rooms & Settings | `/admin/rooms` | rooms, room-types, time-slots, teaching-days |
| Faculty Preferences | `/admin/submissions` | faculty-submissions, review actions |
| Assign Faculty | `/admin/assignments` | `/api/assignments` (list + approve) |
| Validation | `/admin/validation` | `/api/timetable/validate` (dry-run + persist + view run) |
| Timetable Versions | `/admin/timetable-versions` | `/api/timetable/versions/:id` |

### Faculty portal pages
| Page | Route | API endpoints used |
|---|---|---|
| Dashboard | `/faculty` | me, faculty profile, workload, assignments, submission. Links to Track + Subjects. |
| Subject Preferences | `/faculty/preferences` | `/api/faculty-submissions/mine` (GET/PUT/submit), enriched `/api/faculty-submissions/mine/available-courses` |
| Availability | `/faculty/availability` | `/api/faculty-submissions/mine` (GET/PUT) |
| **My Teaching Track** | **`/faculty/track`** | **`/api/faculty-submissions/mine/track` — complete workflow + audit trail** |
| My Timetable | `/faculty/timetable` | Honest "pending Milestone 5/7" message |
| Assigned Subjects | `/faculty/subjects` | `/api/assignments?faculty_id=&is_approved=1` |
| Workload | `/faculty/workload` | `/api/assignments/workload` |
| Account Settings | `/faculty/profile` | `/api/auth/change-password`, `/api/masterdata/faculty`, designations, departments |

### Student portal pages
| Page | Route | Notes |
|---|---|---|
| Dashboard | `/student` | Honest gap notice: no student_profiles table |
| Timetable | `/student/timetable` | Gap notice: needs student_profiles + published version |
| Subjects | `/student/subjects` | Shows all active courses; gap notice re section filtering |

### Honest deferred states
- Timetable generator: amber warning banner on Admin Dashboard + disabled state on generation page
- Timetable approval/publish: "Coming in Milestone 7" notice on Timetable Versions page
- Student timetable: clear schema gap message (`student_profiles` table missing)
- Faculty timetable: explains dependency on Milestones 5 and 7

## Milestone 4 — what was built

### `backend/src/services/validationService.ts`
Pure validation function `computeValidation(versionId, db?)` that checks scheduling constraints and returns a typed `ValidationResult`. No DB writes — safe to call repeatedly after manual edits, before approval, and inside generation.

`runValidationAndPersist(versionId, actorUserId, pool)` wraps it: creates a `validation_runs` row, inserts `validation_issues`, and promotes `timetable_versions.status` to `VALIDATED` when no ERRORs. Never modifies timetable content.

**Rules enforced:**

| Rule code | Severity | Description |
|---|---|---|
| `FACULTY_OVERLAP` | ERROR | Same faculty in two overlapping sessions on same day |
| `ROOM_DOUBLE_BOOKING` | ERROR | Same room double-booked (overlapping times, same day) |
| `AUDIENCE_OVERLAP` | ERROR | Same section+batch audience in two overlapping sessions |
| `ROOM_CAPACITY` | ERROR | Room capacity < planned audience strength; missing size data also blocks |
| `SHARED_DIVISION_SESSION` | ERROR | A session cannot combine multiple divisions |
| `AUDIENCE_SCOPE_CONFLICT` | ERROR | A session cannot include a whole division and its batches together |
| `ROOM_TYPE_MISMATCH` | ERROR | Component requires specific room type but room type differs |
| `FACULTY_UNAVAILABLE` | ERROR | Session overlaps an UNAVAILABLE availability window |
| `FACULTY_UNKNOWN_AVAIL` | ERROR | Missing or UNKNOWN availability blocks without an authorized override |
| `ROOM_UNKNOWN_AVAILABILITY` | ERROR | Missing or UNKNOWN room availability blocks the session |
| `INVALID_TEACHING_SLOT` | ERROR | Session must match consecutive active TEACHING slots on the configured day |
| `SESSION_BREAK_CONFLICT` | ERROR | Session overlaps a configured BREAK or LUNCH slot |
| `OPERATING_HOURS` | ERROR | Session is outside weekday operating bounds |
| `PRACTICAL_ROOM_NOT_APPROVED` | ERROR | Classroom practical requires explicit approval and verified room details |
| `ROOM_PRACTICAL_CONFIGURATION_UNAVAILABLE` | ERROR | Migration 008 is missing; validation blocks safely without querying the absent column |
| `TEACHING_SLOTS_MISSING` | ERROR | A configured teaching day needs at least one teaching slot |
| `LAB_PERIOD_COUNT_MISMATCH` | ERROR | Consecutive session slot count must match component period requirement |
| `NON_CONSECUTIVE_LAB` | ERROR | Consecutive component sessions not on adjacent slots |
| `SATURDAY_CLOSING` | ERROR | Session on SAT ends after `min(closing_time, 12:30:00)` |

### `backend/src/routes/timetable.ts`
Registered at `/api/timetable`. Permissions: `timetable:generate` (ADMIN) to trigger runs; `masterdata:read` to read results.

| Method | Path | Notes |
|---|---|---|
| GET | /api/timetable/configuration/:termId | Read-only readiness check; reports blockers and never modifies records |
| POST | /api/timetable/validate | `{ version_id, dry_run? }` — runs validation, persists (or dry-run preview) |
| GET | /api/timetable/validate/:id | Returns run + all issues + summary counts |
| GET | /api/timetable/versions/:id | Returns version + sections + latest validation run |

### `backend/tests/api.timetable.test.ts`
Database-backed tests cover authorization, session conflicts, resource constraints, API responses, and 404 cases. Do not run the default Vitest setup against the current incomplete `slotify_test`; it resets that database.

## Not done (priority order)
1. **Milestone 5** — automatic timetable generator (uses validation engine as inner loop).
2. Milestone 6 unknown-availability gate in generation; allocation finalization and individual assignment approval now block missing or unverified availability.
3. Milestone 7 version/approval/publish API.
4. Milestone 8 React frontend.
5. Milestone 9 workbook/PDF reconciliation + import with provenance.
6. Milestone 10 exports, CI, e2e.

## Milestone 3 — what was built

### `backend/src/services/workloadService.ts`
- `computeWorkload(facultyId, termId, conn?)` — queries all **approved** assignments for the faculty in the term, joins to `course_components.weekly_hours`, splits into confirmed (LECTURER / LAB_LEAD / TUTOR) vs unconfirmed (LAB_ASSISTANT, PROJECT roles following `workload_counting_policy`).
- Designation lookup: if no `designation_id` on the faculty profile → `WARNING` "no designation set".
- Rule lookup: only active rules with `data_status = 'VERIFIED'` are applied. No VERIFIED rule → `NO_RULE` warning. Never silently unlimited.
- Enforcement: `HARD` mode + over limit → `limit_status = 'OVER_LIMIT'`; `WARNING` mode → `limit_status = 'WARNING'` (not blocked).
- `assertWorkloadOk(conn, facultyId, termId)` — throws `HttpError 422 WORKLOAD_EXCEEDED` when HARD limit is breached; returns the result otherwise.
- Revalidation happens on **create**, **patch** (role change), and **approve**. Counts only approved rows so unapproved drafts don't block.

### `backend/src/routes/assignments.ts`
Registered at `/api/assignments`. Permissions:
- `assignments:manage` (ADMIN) — POST, PATCH, POST /:id/approve, DELETE.
- `assignments:manage | masterdata:read | faculty_submission:own` — GET list, GET /:id, GET /workload.
- Faculty (own permission) are silently scoped to their own faculty_id and `is_approved=1`; they cannot see unapproved assignments or other faculty.

Endpoints:
| Method | Path | Notes |
|---|---|---|
| GET | /api/assignments | Filterable by faculty_id, audience_id, term_id, is_approved |
| GET | /api/assignments/workload | ?faculty_id=&term_id= — workload summary |
| GET | /api/assignments/:id | Enriched (course_name, component_type, faculty_name, designation) |
| POST | /api/assignments | Create; workload revalidated after insert |
| PATCH | /api/assignments/:id | Change role / role_status / source_preference_id; workload revalidated |
| POST | /api/assignments/:id/approve | Sets is_approved=1, approved_by, approved_at; workload revalidated |
| DELETE | /api/assignments/:id | Only unapproved; approved assignments blocked with 409 |

Business rules enforced:
- Audience must exist and offering must not be CANCELLED.
- Faculty must be active.
- `source_preference_id` must belong to the same faculty as the assignment (`PREFERENCE_FACULTY_MISMATCH`).
- Duplicate audience+faculty+role → 409 `DUPLICATE`.
- Approved assignments cannot be deleted → 409 `ASSIGNMENT_APPROVED`.
- Per-step audit in `audit_logs` (ASSIGNMENT_CREATED / ASSIGNMENT_CHANGED / ASSIGNMENT_APPROVED / ASSIGNMENT_DELETED).

### `backend/tests/api.assignments.test.ts`
~40 tests covering: authorization, create/list/get/patch/delete, approve, workload (OK / WARNING / NO_RULE / OVER_LIMIT HARD / WARNING mode pass-through), unconfirmed activity separation, source_preference faculty mismatch, audit trail.

## Not done (priority order)
1. **Milestone 5** — automatic timetable generation, blocked until configuration readiness passes against verified institutional data.
2. Milestone 6 unknown-availability gate in generation; allocation finalization and individual assignment approval now block missing or unverified availability.
3. Milestone 7 version/approval/publish API.
4. Milestone 8 complete timetable workflow UI. A faculty-scoped published-session API and weekly view now exist, but the publishing workflow and authenticated end-to-end verification remain missing.
5. Milestone 9 workbook/PDF reconciliation and import with provenance.
6. Milestone 10 exports, CI, and end-to-end verification.

### CSE workload import status

The extraction and review-only preparation are documented in [`docs/imports/CSE_EVEN_2026_extraction.md`](./docs/imports/CSE_EVEN_2026_extraction.md), with the generated row-by-row report at [`docs/imports/CSE_EVEN_2026_preview.md`](./docs/imports/CSE_EVEN_2026_preview.md) and machine-readable details at [`docs/imports/CSE_EVEN_2026_preview.json`](./docs/imports/CSE_EVEN_2026_preview.json). The preview reports 0 ready, 32 needs review, and 7 blocked out of 39 serial positions, using a read-only `slotify_dev` snapshot. No institutional database records or assignments were changed. Do not implement/run a real import until the college confirms identities, course/component aliases, term and academic structure, missing row 38, row 25 ambiguities, and workload counting decisions.

## Known limits / not tested
- Master-data CRUD (Milestone 1) is **not audit-logged**; only Milestone 2 actions are. Decide whether to add it before Milestone 7.
- `audit_logs` is append-only by convention only (no DB trigger).
- Faculty timetable UI was added, but no authenticated browser workflow was verified. Faculty/student published-schedule workflows are not end-to-end complete.
- The login rate limiter is skipped in the test environment (not tested).
- Coordinator permissions are still provisional guesses (`is_provisional=1`); the Coordinator cannot review faculty submissions.
- The schema has NOT been reconciled field-by-field with the Word spec / workbook in code (see `docs/DEVIATIONS.md`); no university data has been imported. The workbook-vs-schema review done in chat (gaps: provenance, section-level assignments, alias support, hours model) is not yet applied as migrations.
- Open university questions, deliberately not hardcoded: Saturday periods, labs spanning breaks, fractional-hour sessions, Semester VII patterns, workload counting for lab assistants/projects/SDP/minor projects, per-faculty designations, Coordinator duties, course-code uniqueness.
- Submission edits do not yet notify anyone (no notification feature).

## Commands
```bash
cd backend && npm install && cp .env.example .env     # edit DB_PASSWORD, JWT_SECRET
npm run migrate -- --seed && npm run typecheck && npm test && npm run build
ADMIN_USERNAME=.. ADMIN_EMAIL=.. ADMIN_NAME=".." ADMIN_PASSWORD='..' npm run create-admin
npm run dev
```
Tests need a MySQL 8 database named like `slotify_test` and a user `slotify` (env vars in `backend/tests/globalSetup.ts`; the password there is a test-only value). Triggers need `log_bin_trust_function_creators=1` (or SUPER) when binary logging is on.
Sandbox note: MySQL did not persist between tool calls here; a helper script restarted it before each test run. Not needed on a normal machine.

## Exact next step
Confirm whether persisted curriculum drafts should use a new additive `curriculum_drafts` table keyed by term/program/scheme/semester, storing the validated draft payload and audit actor/timestamps. No migration has been created or applied pending that decision. Separately, establish an owner/DBA-approved disposable integration-test database, then verify faculty timetable authorization and implement the missing review/approval/publication lifecycle only after its policies are confirmed.

## How to run
```bash
# Backend (terminal 1)
cd backend
npm run dev        # API on http://localhost:4000

# Frontend (terminal 2)
cd frontend
npm run dev        # App on http://localhost:5173

# Tests
cd backend && npm test
```

## Database provisioning

Do not use this handover to provision or reset a database. The existing `slotify_test` is incomplete and is not a safe test target. Have an authorized DBA provision and approve a uniquely named local disposable database, with only the required test privileges, before setting `SLOTIFY_TEST_DB_NAME` and `SLOTIFY_ALLOW_DISPOSABLE_DB_RESET=YES`. Do not change binary logging/global MySQL settings to bypass migration errors.

## Latest academic and faculty timetable update — 2026-10-21

- Faculty profile reads now return `FacultyProfile | null`; all faculty pages distinguish an unavailable API response from a successful response with no linked profile.
- The observed faculty account has zero active linked profiles in `slotify_dev`. The existing records are demo-labelled. Only semester 3 exists in the two demo schemes; the ODD demo term maps those existing records, while the EVEN term has no parity mapping or semesters 4/6/8. Do not create records from this snapshot.
- Admins can map parity-appropriate existing active semesters in one idempotent action. The API does not invent semesters or reactivate deliberately inactive mappings.
- `GET /api/timetable/faculty/contexts` derives the faculty identity from the session and returns contexts from approved assignments. `GET /api/timetable/faculty/sessions?year_id=&term_id=&semester_id=` filters further to matching approved assignments and PUBLISHED versions only. The existing schema currently has zero PUBLISHED versions, so no real chart is expected yet.
- Curriculum builder drafts still disappear when the page is left or refreshed. Persisting them needs a schema/API change and is awaiting owner confirmation; no migration was run.
- Latest checks: backend typecheck passed; 31 focused database-independent tests passed; frontend production build passed with the existing bundle-size warning. Only read-only `slotify_dev` queries were used. No database-backed tests or authenticated browser checks were run.
