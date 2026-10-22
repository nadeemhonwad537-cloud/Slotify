# Slotify — Backend Progress Tracker

Last updated: 2026-10-22 — Timetable review, approval, and publication implementation.
Latest full suite in the 2026-10-20 checkpoint: **224/224 passing**. The 2026-10-22 workflow update ran focused database-independent tests only; no DB-backed suite, migration, database write, or browser workflow was run.

### Current timetable lifecycle update

- Existing schema statuses/actions/permissions were reused; no migration was added or applied.
- The lifecycle is DRAFT → VALIDATED → IN_REVIEW → APPROVED → PUBLISHED; replaced publications transition to ARCHIVED. Request-changes returns an un-published review/approved version to DRAFT with a required comment.
- Backend checks `timetable:review`, `timetable:approve` (or `timetable:publish` for approvers), and `timetable:publish` independently of UI controls. Validation is repeated before each transition that advances toward publication.
- Reference seed grants are provisional for publishing/Coordinator review and approval; live database grants were not queried, so institutional approval of those assignments remains outstanding.
- Publication holds a term lock and archives the prior published version in the same transaction; faculty reads still query only PUBLISHED sessions scoped to the authenticated profile.
- Student timetable remains blocked pending a verified student-to-section/elective mapping. Automatic generation remains unimplemented.
- Verification on 2026-10-22: backend typecheck passed; focused database-independent tests passed 12/12; frontend build passed with the existing chunk-size warning.

### Current faculty flow verification

- Added `GET /api/faculty-submissions/mine/profile` under the existing `faculty_submission:own` permission. It returns only the authenticated user's active faculty profile, or `null` if no active profile is linked.
- Replaced faculty-page calls to `GET /api/masterdata/faculty` (restricted to admins/reviewers) with the own-profile endpoint.
- Excluded `/faculty/preferences` from the shell's submission-gate profile/term/submission lookups; those checks had been holding the form behind admin-restricted profile access.
- Browser verified faculty login and read-only wizard path through subject browsing, selecting/reordering three preferences, availability setup, and review. No live draft was saved or submitted.
- Targeted regression test covers linked-profile access and the no-profile `null` response. Full backend suite, both typechecks, and both builds pass.
- A browser session that later returned 401 was expired; signing in again restored the expected page. This is expected with the configured short-lived access cookie.
- Preference policy caveat: code allows at most three in a draft and requires exactly three at submission. The referenced university specification/workbook is unavailable, so only the existing project decision for a maximum of three is documented; exact submission count needs confirmation before altering the rule.

---

## Module Status Summary

| Module | Status | Tests |
|---|---|---|
| Database schema (47 + 1 audit table) | ✅ Verified | 23 DB constraint tests |
| Auth — login, logout, refresh, CSRF, RBAC | ✅ Verified | 21 auth tests (added change-password) |
| Master-data REST API (23 resources) | ✅ Verified | 50 tests |
| Faculty submissions + availability | ✅ Verified | 35 tests |
| Faculty assignments + workload service | ✅ Verified | 41 tests |
| Timetable validation engine | ✅ Verified | 37 tests |
| `POST /api/auth/change-password` | ✅ Added | 4 tests |
| `GET /api/timetable/versions` list | ✅ Added | — |
| `POST /api/timetable/versions` create draft | ✅ Added | — |
| `GET /api/users/:id` + `PATCH /api/users/:id` + `POST /api/users/:id/reset-password` | ✅ Added | — |
| Automatic timetable generator | ❌ Not started (Milestone 5) | — |
| Timetable review / approval / publishing API | ✅ Added; DB-backed workflow verification pending | 11 database-independent rule tests |
| Student profiles / section mapping | ❌ Not started — schema gap | — |

---

---

## Faculty Portal — Full Functionality Update (This Milestone)

### New Backend Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /api/faculty-submissions/mine/available-courses?term_id=X | faculty_submission:own | **Enriched** — now includes `dept_name`, `programs[]` (program_name, program_code, semester_no), and full component details (periods_per_session, is_consecutive, required_room_type, audience_count). Uses `curriculum_schemes` table (correct name vs `schemes`). |
| GET | /api/faculty-submissions/mine/track?term_id=X | faculty_submission:own | **New** — returns complete workflow status: submission detail + preferences + availability + all assignments for this faculty+term (with section/batch/approver info) + audit trail from `audit_logs` ordered by time. Faculty sees their own data only (identity from JWT). |

### Faculty Portal Pages Updated

| Page | Route | What changed |
|---|---|---|
| Subject Preferences | `/faculty/preferences` | **Rewritten Step 2** — full subject browser with search (name/code/program), department filter, component type filter, subject detail cards showing credits/category/dept/programs/semester. Each component shows weekly hours, periods per session, consecutive flag, required room type, audience count. Selection adds to a pinned "Selected Preferences" bar with reorder/remove/note. Locked view preserved for SUBMITTED state. |
| **My Teaching Track** | **`/faculty/track`** | **New page** — shows full workflow from "Not Started" → "Assignment Approved" via a 7-stage progress bar. Displays submission status, review status, 3 submitted preferences, assignment details (approved/pending), and a real audit trail timeline from `audit_logs`. Reviewer comments shown inline. Term switcher. No invented history. |
| Dashboard | `/faculty` | Added `Link` → Assigned Subjects and Track page. Approved badge on assignment list. |

### Bug Fixed in enriched SQL

The curriculum program lookup was using `schemes` (wrong) — the actual table is `curriculum_schemes`. Fixed in `submissions.ts`; test confirmed passes.

### Verification Results

```
Backend typecheck:  PASSED (0 errors)
Frontend typecheck: PASSED (0 errors)
Frontend build:     PASSED (429 kB bundle)
Backend tests:      223/223 PASSED
```

### New Backend Endpoint

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/change-password | authenticate | Self-service. Requires `current_password` (verified against hash) + `new_password` (min 12 chars). Revokes all sessions after success so the user must re-authenticate. Unlike admin `reset-password`, this does not require `users:manage` permission. |

### Faculty Portal Pages — Full Feature Matrix

| Page | Route | What it does |
|---|---|---|
| Dashboard | `/faculty` | Stat cards (assigned subjects, hours, submission status), workload card, assigned subjects list, submission status card with reviewer comment |
| Subject Preferences | `/faculty/preferences` | 4-step wizard: profile review → exactly 3 subject preferences from offered courses → availability windows → review + save/submit. Handles DRAFT/SUBMITTED/RETURNED states. Shows reviewer feedback. Locks form when SUBMITTED. |
| My Availability | `/faculty/availability` | Standalone availability window editor. Saves via unified PUT carrying existing preferences. Admin-entered windows shown read-only. Locked when SUBMITTED. |
| My Timetable | `/faculty/timetable` | Honest deferred message — requires published timetable (Milestone 5 + 7). |
| Assigned Subjects | `/faculty/subjects` | Table of approved assignments with component type, role, approval status. |
| My Workload | `/faculty/workload` | Confirmed/unconfirmed hours, limit status, progress bar, enforcement mode, term switcher. |
| **Account Settings** | **`/faculty/profile`** | **Read-only faculty profile, account info, self-service password change.** |

### First-Login Gate Fixes (FacultyShell)

1. `setTimeout` redirect replaced with `useEffect`-based navigation (no render-phase side effects)
2. `GATE_PASS_STATUSES` removed the incorrectly-typed `'ACCEPTED'` string (that is a `review_status` value; `submission_status` only ever reaches `'SUBMITTED'`)
3. Query key for submission in `FacultyDashboard` aligned to `['my-submission', term?.term_id]` (shared with all other pages + gate)

### Verification Results

```
Backend typecheck:  PASSED (0 errors)
Frontend typecheck: PASSED (0 errors)
Frontend build:     PASSED (407 kB bundle)
Backend tests:      223/223 PASSED
```

---

### New Backend Endpoints Added

| Method | Path | Notes |
|---|---|---|
| GET | /api/timetable/versions | List versions with filters (term_id, status, limit, offset). Enriched with term name, creator, section/session counts, latest validation summary. |
| POST | /api/timetable/versions | Create empty DRAFT version. Accepts term_id, optional parent_version_id, optional section_ids[]. Validates term not CLOSED, parent term match, section term match. |
| GET | /api/users/:id | Single user detail with roles. |
| PATCH | /api/users/:id | Edit name, email, roles. Enforces last-admin rule. Revokes sessions on role change. |
| POST | /api/users/:id/reset-password | Admin sets new password (min 12 chars). Revokes all sessions, clears lockout. |

### Admin Portal Pages — Complete Feature Matrix

| Page | Create | Read | Update | Delete | Notes |
|---|---|---|---|---|---|
| Dashboard | — | ✅ Live counts + stats | — | — | Fully functional |
| Manage Users | ✅ | ✅ Search | ✅ Edit name/email/roles + status toggle + password reset | — | Accounts disabled not deleted |
| Departments | ✅ | ✅ | ✅ | ✅ | Full CRUD |
| Academic Structure → Years | ✅ | ✅ | ✅ | ✅ | |
| Academic Structure → Terms | ✅ | ✅ | ✅ | ✅ | Parity locked once sections exist |
| Academic Structure → Programs | ✅ | ✅ | ✅ | ✅ | dept_id immutable |
| Academic Structure → Schemes | ✅ | ✅ | ✅ | ✅ | program_id immutable |
| Academic Structure → Semesters | ✅ | ✅ | ✅ | ✅ | scheme_id + semester_no immutable |
| Academic Structure → Sections | ✅ | ✅ | ✅ | ✅ | term_id + semester_id immutable |
| Academic Structure → Batches | ✅ | ✅ | ✅ | ✅ | section_id immutable |
| Courses & Curriculum → Courses | ✅ | ✅ Search | ✅ | ✅ | |
| Courses & Curriculum → Components | ✅ | ✅ | ✅ | ✅ | course_id + component_type immutable |
| Faculty & Workload | ✅ | ✅ Search | ✅ | — | Workload modal per faculty per term |
| Rooms & Settings → Rooms | ✅ | ✅ | ✅ | ✅ | room_code immutable |
| Rooms & Settings → Room Types | ✅ | ✅ | ✅ | ✅ | type_code immutable |
| Rooms & Settings → Time Slots | ✅ | ✅ Filter by term | ✅ | ✅ | term_id + slot_no immutable |
| Rooms & Settings → Teaching Days | ✅ | ✅ Filter by term | ✅ | ✅ | term_id + day_name immutable |
| Faculty Preferences | — | ✅ Filter by term | ✅ Review (START/ACCEPT/RETURN) | — | Full review workflow |
| Assign Faculty | ✅ 3-step wizard | ✅ Filter by term | ✅ Approve | ✅ Unapproved only | Workload validated on create/approve |
| Validation & Conflicts | — | ✅ Version picker dropdown | ✅ Dry-run + Run & Save | — | All 8 rules displayed with details |
| Timetable Versions | ✅ Create draft | ✅ List + detail panel | — | — | Approval/publish pending Milestone 7 |

### Key Frontend Fixes Applied

1. **Critical: `ref`-based form seeding** — All 14 modals across 4 pages were using an anti-pattern (`<div ref={() => seed()} />`) that caused form state to reset on every keystroke. Fixed by initializing `useState` directly from `editing` prop, combined with `key` remount to force fresh state when opening a different record.

2. **AssignmentsPage audience labels** — Was doing a fragile 3-level lookup chain. Simplified to use the enriched fields (`course_name`, `component_type`, `section_name`) returned directly by the API.

3. **TimetableVersionsPage semester display** — Was showing raw `semester_id` (foreign key) instead of `semester_no`. Fixed by loading semesters and building a `semesterMap`.

4. **FacultyPage workload termId race** — `useState(terms[0]?.term_id ?? 0)` initialized to 0 if terms hadn't loaded yet (0 stays as state even after terms load). Fixed by using `undefined` initial state and deriving the effective term from `terms[0]?.term_id`.

5. **Unused imports cleaned** — `ValidationPage`, `AssignmentsPage`, `TimetableVersionsPage`.

6. **Modal.tsx `ConfirmModal`** — Added `children?: ReactNode` prop to support inline error display inside confirm modals.

---

## Frontend ↔ Backend Integration Map (Updated)

| Frontend Page | Backend Endpoints Used |
|---|---|
| Login | `GET /api/auth/csrf`, `POST /api/auth/login` |
| Admin Dashboard | `GET /api/auth/me`, masterdata counts, terms, assignments |
| Manage Users | `GET/POST /api/users`, `GET/PATCH /api/users/:id`, `PATCH /api/users/:id/status`, `POST /api/users/:id/reset-password` |
| Departments | `GET/POST/PATCH/DELETE /api/masterdata/departments` |
| Academic Structure | All 7 resources: academic-years, terms, programs, schemes, semesters, sections, batches |
| Courses & Curriculum | courses, components |
| Faculty & Workload | faculty, designations, departments, `GET /api/assignments/workload` |
| Rooms & Settings | rooms, room-types, time-slots, teaching-days |
| Faculty Preferences | `GET/POST /api/faculty-submissions`, `POST /api/faculty-submissions/:id/review` |
| Assign Faculty | `GET/POST/DELETE /api/assignments`, `POST /api/assignments/:id/approve` |
| Validation & Conflicts | `GET /api/timetable/versions`, `POST /api/timetable/validate`, `GET /api/timetable/validate/:id` |
| Timetable Versions | `GET /api/timetable/versions` (list), `GET /api/timetable/versions/:id` (detail), `POST /api/timetable/versions` (create) |

---

## Verification Results

```
Backend typecheck:  PASSED (0 errors)
Frontend typecheck: PASSED (0 errors)
Frontend build:     PASSED (377 kB bundle)
Backend tests:      215/215 PASSED
```

Browser testing was not automated. The following workflows were verified by code review and API integration:
- All admin CRUD forms open, populate, submit, and refresh correctly
- No "use the API directly" messages remain on any admin page
- All delete operations show FK constraint errors gracefully
- Workload is checked on assignment create/approve

---

## Remaining Milestones (Priority Order)

1. **Milestone 5** — Automatic timetable generator (`POST /api/timetable/generate`)
2. **Milestone 7** — Timetable approval/publishing workflow (`POST /api/timetable/versions/:id/approve`, publish)
3. Student profiles + section mapping (`student_profiles` table missing)
4. Data import API (provenance, discrepancy resolution)
5. Notifications
6. Faculty change requests
7. Exports, CI, e2e tests

## Known Limitations

- Timetable generation not implemented — honest banner shown on dashboard
- Approval/publish workflow not implemented — noted in Timetable Versions page
- Coordinator permissions are provisional (`is_provisional=1`) — cannot review submissions
- Workload rules seeded as `VERIFY` — must be set to `VERIFIED` for HARD enforcement
- Lab assistant/project workload counting policy unconfirmed
- No browser-automated e2e tests
- Audiences API does not return `course_name`/`section_name` enrichment — if that query returns bare IDs, the audience label in the assignment wizard will fall back to showing IDs. Verify `GET /api/masterdata/audiences?term_id=X` includes these fields.

## Exact Next Step

**Backend: Milestone 5 — Automatic Timetable Generator**
Create `src/services/generationService.ts` + `POST /api/timetable/generate`.

OR

**Milestone 7 — Timetable Approval/Publishing**
Add `POST /api/timetable/versions/:id/approve` → DRAFT → VALIDATED → IN_REVIEW → APPROVED → PUBLISHED lifecycle with `approval_actions` inserts.
