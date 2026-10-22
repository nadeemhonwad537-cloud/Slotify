# Slotify Scheduling Requirements and Configuration Readiness

**Prepared:** 2026-10-21  
**Purpose:** Record owner-confirmed operating inputs, compare them with existing Slotify support, and define evidence required before automatic timetable generation.  
**Updated:** 2026-10-21 after the owner confirmed the running-term division model.  
**Change boundary:** No database records were changed and no migration was run. A reversible room-practical-approval migration and read-only configuration validation were added; see section 5.

## 1. Confirmed owner-provided requirements

The following are owner-confirmed inputs supplied on 2026-10-21. These inputs do not prove the corresponding database rows are verified or configured.

| Requirement | Confirmed input | Current status |
|---|---|---|
| Regular working days | Monday through Friday | `term_teaching_days` remains term-configurable; readiness requires Monday–Friday teaching-day records and validates their grids. |
| Saturday | Half-day; classes finish by 12:30 PM | Shared bound in `backend/src/rules/scheduleRules.ts` is used by master-data and timetable validation. Exact Saturday periods remain term-configured. |
| Sunday | No regular classes unless explicitly configured otherwise | A session is rejected unless Sunday is explicitly marked as a teaching day in term configuration. |
| Weekday operating window | 8:00 AM to 5:30 PM | Central shared bounds are validated against each configured grid and session. Period availability still comes from term slots, not the whole window. |
| Lecture period | 60 minutes | Readiness checks configured TEACHING slots for the standard duration; sessions must match configured slot intervals. Component `periods_per_session` controls multi-period duration. |
| Lunch | 12:30 PM to 1:30 PM on weekdays | Readiness requires the exact LUNCH slot on Monday–Friday; session validation rejects all configured BREAK/LUNCH overlaps. |
| Morning break | Not finalized; variable or needs confirmation | Do not seed, infer, or hardcode an interval. Configure only after an approved term/day interval is supplied. |
| Holidays | Configurable through an administrator-managed academic calendar | No academic-calendar or holiday table, route, or page was found. |
| Examination days | Block regular classes | No examination-date/calendar model or enforcement was found. |
| Department programs | CSE and CSE (AI) | The inspected database contains demo-labelled programs; approved identifiers/mappings must be verified before operational scheduling. |
| Shared division classes | None, based on current owner confirmation | `session_audiences` allows multiple audiences; future generation must not create shared division sessions under the current rule. |
| Resources | 8 classrooms and 4 dedicated labs | One shared physical inventory of 12 across odd/even terms; there must not be separate parity inventories. |
| Department divisions | 12 active divisions in each running term; 4 in each of its 3 active semesters | Odd term semester numbers are 3, 5, 7; even term numbers are 4, 6, 8. This is the term-scoped count, not the total semester count. |
| Department scope | First- and second-semester divisions excluded | Configuration validation requires the parity-specific three-semester set. |

Teaching periods must use explicitly configured availability and exclude lunch, any configured breaks, holidays, examinations, and other unavailable intervals.

## 2. Existing implementation and file/schema references

### Academic context and teaching requirements

- `database/migrations/001_core.sql` defines `academic_years`, `terms`, `programs`, `curriculum_schemes`, `semesters`, `sections`, `batches`, `courses`, `course_components`, `curriculum_courses`, `course_offerings`, `offering_audiences`, `term_teaching_days`, `time_slots`, and `term_day_slots`.
- `database/migrations/005_term_program_semesters.sql` adds term-specific program/scheme/semester mappings and section consistency constraints.
- `backend/src/routes/masterdata.ts` exposes admin master-data CRUD, curriculum operations, term teaching-day/slot validation, and Saturday cutoff metadata at `/api/masterdata/meta`.
- `backend/src/services/curriculumBuilder.ts` validates component totals, duplicate course codes within a curriculum payload, and consecutive component configuration. Components include `weekly_hours`, `periods_per_session`, `is_consecutive`, and optional `required_room_type_id`.
- `frontend/src/pages/admin/AcademicStructurePage.tsx` manages academic years, terms, programs, schemes, semesters, mappings, divisions and batches. `frontend/src/pages/admin/CoursesPage.tsx` and `CurriculumBuilder.tsx` manage courses, components, offerings, audiences and curriculum.

### Rooms, faculty, allocation and validation

- `rooms` stores room type, capacity, free-text equipment/location, active state, and `data_status`. New migration `008_room_practical_approval.sql` adds `practical_approved` (default false) for explicit classroom practical approval; it has not been applied to either database.
- `room_availability` stores per-term/day/time AVAILABLE, UNAVAILABLE, or UNKNOWN windows. `frontend/src/pages/admin/RoomsPage.tsx` manages rooms, availability, teaching days, and time slots.
- Faculty profiles, workload rules, availability, and assignments exist. `backend/src/services/workloadService.ts` enforces only explicitly VERIFIED limits. Current reference policies contain `VERIFY` and `UNCONFIRMED` labels and are not confirmed institutional limits.
- `backend/src/routes/assignments.ts` supplies allocation context/plan/validate/finalize endpoints and integrates preference ranks and workload checks. Finalization and individual assignment approval now block if curriculum/section/faculty/role data are unverified, no verified AVAILABLE window exists, or no applicable workload rule can be verified. Time-specific availability conflicts still require a session day/time and are checked by timetable validation.
- `backend/src/services/schedulingConfiguration.ts` provides pure term-readiness and session constraint validation. `schedulingConfigurationService.ts` reads current rows and `/api/timetable/configuration/:termId` exposes a read-only readiness report. Admin Validation UI can run the check.
- `backend/src/services/validationService.ts` now validates configured day/slot membership, operating bounds, configured breaks, Saturday cutoff, classroom practical approval, room capacity, room availability, and explicit full-window faculty availability. Missing/UNKNOWN faculty availability is an ERROR, not availability.
- No automatic generator is present to gate yet; the readiness endpoint reports `ready=false` for any configuration blocker. Calendar support is absent and is reported as an ERROR.

### Timetable and calendar support

- `database/migrations/002_timetable.sql` defines `timetable_versions`, `generation_runs`, `generation_run_sections`, `timetable_version_sections`, `scheduled_sessions`, `session_audiences`, `session_faculty`, `validation_runs`, `validation_issues`, and `approval_actions`, plus immutability/unknown-availability triggers.
- `backend/src/routes/timetable.ts` exposes validation and timetable-version read/create endpoints. Version creation makes an empty DRAFT; there is no generation, timetable approval, or publication route.
- Admin UI exists for timetable versions and validation. Faculty and Student timetable pages defer to generator/publishing work.
- No academic-calendar, holiday, or examination-date table or route was found. The readiness endpoint reports the unsupported capability and blocks readiness.

### Current database configuration snapshot (read-only)

This is the read-only `slotify_dev` snapshot inspected on 2026-10-21. Room and section rows below are synthetic demo records, not verified institutional inventory. Current owner-confirmed configuration was supplied later on 2026-10-21 and is reflected in the requirements above.

| Resource ID / name | Type | Capacity | Equipment / permitted practical types | Availability configuration | Verification status and source |
|---|---|---:|---|---|---|
| Room 1 `DEMO-301` / `DEMO - Classroom 301` | Classroom | 60 | Text says “Projector, whiteboard”; no structured allowed-course/practical types or explicit classroom-practical approval | Term 2, Monday and Wednesday, 08:00–17:00 AVAILABLE | `SYNTHETIC`; no `data_provenance` row |
| Room 2 `DEMO-LAB-1` / `DEMO - Lab 1` | Laboratory | 30 | Text says “30 workstations, projector, network lab”; no verified course-specific permission | Term 2, Monday and Wednesday, 08:00–17:00 AVAILABLE | `SYNTHETIC`; no `data_provenance` row |

**Inventory finding:** the database has **2 active room records** (one synthetic classroom and one synthetic lab), not 8 classrooms plus 4 labs. The other 10 reported resources are absent. Both records' type, capacity, description, and availability are synthetic and unverified. `room_code` is globally unique and rooms are not term-owned, so one inventory can be shared across parity; no parity-specific rooms were added. The new explicit practical-approval field is not present until migration 008 is applied.

The database has two synthetic active section records, both in a demo Semester 3 context:

| Section ID / name | Program | Semester | Active batches | Verification |
|---|---|---:|---:|---|
| 1 / `DEMO - A` | `DEMO_CSE` / `DEMO - CSE` | 3 | 1 | `SYNTHETIC` |
| 2 / `DEMO - A` | `DEMO_CSE_AI` / `DEMO - CSE AI` | 3 | 1 | `SYNTHETIC` |

These are not the four owner-confirmed Semester 3 divisions and do not establish their actual names or persistent mappings.

### Current teaching-grid records

- The regular (non-demo) term in `slotify_dev` has no configured teaching-day rows.
- The demo term has synthetic Monday–Friday grids, closing at 17:00, with intervals 09:00–10:00, 10:00–12:00, 13:00–14:00, and 14:00–16:00. No BREAK/LUNCH interval is mapped in those weekday grids.
- This grid omits the confirmed 08:00 opening, overlaps the confirmed 12:30–13:30 lunch, and includes two-hour periods. It is synthetic example data, not a valid approved timetable configuration.
- No Saturday grid is configured in that demo term. No Sunday row exists. No holiday, examination, or academic-calendar table exists.

Do not edit those demo rows as part of this requirements task. Administrators must create verified term-specific grids before a real context is schedulable.

## 3. Resource inventory and verification status

The owner-reported inventory is eight classrooms plus four dedicated labs. A verified real-room list cannot be produced from the current database. The two-row table above is the complete current `slotify_dev` room inventory, not the complete college inventory.

For each of the 12 expected resources, obtain and verify:

- Stable room identifier/name and resource type.
- Approved usable capacity and source/date.
- Equipment and supported practical/course types.
- Explicit approval if a classroom may host practical work.
- Term/day/time availability and recurring unavailability.
- `data_status` and source provenance.

Do not infer suitability from a room name, free-text equipment string, or `room_type_id` alone. Room conflicts are currently checked globally by room ID; future generation must treat every classroom/lab as a shared physical resource across divisions.

## 4. Unresolved questions and configuration discrepancies

### Division inventory — running-term counts confirmed; persisted mapping incomplete

The owner clarified on 2026-10-21:

- Each running term has 12 active divisions across three semesters, four divisions per semester.
- Odd terms use semesters 3, 5, 7; even terms use 4, 6, 8.
- Both parities share the same global physical inventory of 8 classrooms and 4 labs.
- Semesters 1–2 are outside scope.
- Semester 3’s confirmed names are CSE A, CSE B, CSE C, and CSE (AI) A.

This replaces the earlier competing inventory interpretations. The current database does not meet the confirmed term counts: `slotify_dev` term 1 “Even Semester 2026” has zero active divisions; term 2 “DEMO - Odd Semester 2026” has two active synthetic Semester 3 divisions (one per demo program), not 12. No records were changed.

Still needed: authoritative program/scheme and exact section names/mappings for each running term, including the exact program/section distribution within its four divisions per semester. Do not infer those mappings from demo data.

### Other decisions needed before generation

1. **Academic calendar:** Confirm date range, event types and whether closure events are whole-day; the smallest safe addition is a term-scoped calendar event table with date, HOLIDAY/EXAMINATION type, label, active state, verification/provenance, and audit actor. No calendar schema/API/UI exists yet.
2. **Morning break:** What intervals apply to which weekdays/programs/terms? Leave it unconfigured until supplied.
3. **Saturday grid:** Which exact periods are available before 12:30? Is a break needed? Only the closing cutoff is confirmed.
4. **Lunch:** The owner confirmed weekday lunch 12:30–13:30; confirm any exceptional weekday schedule only if applicable.
5. **Period semantics:** Confirm all teaching periods are exactly 60 minutes and practicals occupy consecutive 60-minute periods. Define exceptions for other session types.
6. **Faculty availability:** Project decision H records UNKNOWN as blocked by default, but confirm this is approved institutional policy and define any authorized override role/reason. Missing/UNKNOWN must never silently become available.
7. **Workload policy:** Supply verified workload ceilings, effective dates, designation applicability, and counting rules for labs, projects, SDP, minor projects, and assistants. Existing `VERIFY`/`UNCONFIRMED` values are not authority.
8. **Rooms and enrollment:** Supply the 12-resource inventory and approved capacities, equipment, practical permissions, division strengths, batch membership, and room unavailable periods.
9. **Capacity/unknown data:** Validation now treats missing capacity/strength and capacity excess as blocking errors. Confirm this conservative policy or provide an explicit override process.
10. **No shared classes:** Confirm whether this forbids one session serving multiple divisions, including identical lectures; current schema permits multiple audiences.
11. **Term context:** Identify the academic year/term, program/scheme/semester/section mappings, and authoritative curriculum/offerings to generate first.
12. **Review/publishing:** Confirm timetable reviewers, approvers, publishers, and whether an unknown-availability override is allowed. Existing lifecycle tables do not provide a functioning workflow.

## 5. Proposed configuration design (not implemented)

1. **Extend the existing teaching grid, not duplicate it.** Continue using `term_teaching_days`, `time_slots`, and `term_day_slots` for term/day-specific schedules. Confirmed bounds and standard period duration are centralized in `SCHEDULING_POLICY`; create only periods approved for a specific term/day.
2. **Separate fixed operating rules from configurable calendar data.** Saturday's 12:30 upper bound is fixed and owner-confirmed. Weekday periods, morning breaks, and exact Saturday periods belong in explicit term configuration, not invented defaults.
3. **Add an administrator-managed academic calendar after event semantics are agreed.** Proposed minimal migration/API/UI: term-scoped date + event type (HOLIDAY or EXAMINATION), label, active/verified status, and audit actor; extend to intervals only if the owner confirms timed restrictions.
4. **Represent room suitability explicitly.** Migration 008 adds opt-in classroom practical approval defaulting false. Do not parse free-text equipment or assume rooms are interchangeable; room data must be verified.
5. **Make verification visible and blocking.** Keep inventory, periods, capacity, curriculum, and workload marked `VERIFY`/`SYNTHETIC` out of generation inputs unless authorized review resolves them.
6. **Use one validation contract.** Configuration, generation, dry-run validation, and approval should apply the same grid/calendar/resource rules, enforced by the backend as well as the UI.

## 6. Future timetable hard constraints and soft preferences

### Hard constraints

- Schedule regular classes Monday–Friday and Saturday only where explicitly configured; never schedule regular Sunday sessions.
- Do not start before 08:00 or end after 17:30 on weekdays; Saturday must end by 12:30. Honor any stricter configured daily close.
- Do not schedule during 12:30–13:30 lunch or configured breaks. Do not assume a morning break before its interval is supplied.
- A configured lecture period is 60 minutes. Practical sessions occupy the required consecutive configured periods, subject to confirmed practical semantics.
- Exclude administrator-configured holidays and examination days.
- No overlap for a division/batch, faculty member, or physical room. Under current owner confirmation, sessions cannot combine divisions.
- Respect faculty availability and verified workload limits under the approved unknown-availability/workload policy. Missing/UNKNOWN must never be silently treated as available.
- Respect verified room capacity, room type, equipment, and explicit practical permission. Missing/unverified suitability is not approval.
- Cover every required curriculum/offering lecture and practical. Never silently omit required sessions; report each unplaced session and infeasibility reason.
- Generated versions remain DRAFT until a real authorized approval/publishing workflow exists. Do not claim global optimality without an evidenced optimization method.

### Soft preferences

- Accepted, context-matched faculty subject ranks may guide allocation recommendations but may not override hard constraints and do not themselves create assignments.
- Room preferences, gap minimization, fairness weights, objective penalties, and optimization priorities are not confirmed. Do not invent them as institutional policy.
- Unless global optimality is demonstrated, describe output as a feasible draft and include unplaced work and diagnostics.

### Current implementation status against these constraints

The shared backend validator now blocks invalid teaching-day/slot use, operating-window and Saturday-cutoff violations, configured break/lunch conflicts, missing or UNKNOWN faculty/room availability, capacity excess or missing audience/capacity data, sessions combining divisions, conflicting whole-division/batch audiences, unapproved classroom practicals, and consecutive-period mismatches. Batch audience strength is used for batch sessions, and separate audience groups are summed for capacity checks. Pure database-independent tests cover the rule functions. The read-only readiness check also blocks incomplete term/division/room/grid/workload configuration.

Holiday and examination enforcement remains unsupported; readiness therefore stays blocked until a calendar model and enforcement exist. Migration 008 has not been applied, so practical approval is unavailable in the current databases; the room API returns an explicit `MIGRATION_REQUIRED` error when the new field is submitted, and timetable validation reports the missing capability rather than failing on a missing column. Database-backed timetable/API tests remain unrun because the default test setup resets the incomplete `slotify_test` database. Allocation finalization still has a separate warning-only missing-availability path and must be fixed before it can be treated as safe.

## 7. Acceptance criteria for future generation work

Do not start generation until the blocking questions above have approved answers and verified term configuration exists.

The generator is acceptable only when:

1. It is scoped to the selected academic term, confirmed program/scheme/semester/divisions, and approved curriculum/offerings.
2. It consumes only active verified or explicitly resolved requirements/resources and lists excluded unverified rows.
3. It uses administrator-configured weekday/Saturday grids, lunch/breaks, and holiday/examination calendar; it never invents periods or treats an operating window as continuous availability.
4. It schedules no regular Sunday sessions, weekday sessions outside 08:00–17:30, Saturday sessions ending after 12:30, or sessions over lunch/break/calendar blocks.
5. It satisfies division/batch, faculty, and global physical-room non-overlap; enforces consecutive practicals and verified faculty/room/workload constraints.
6. It places every required teaching item or reports it unplaced with a specific constraint/conflict explanation; nothing is silently dropped.
7. It persists only a DRAFT version with run settings, scope, diagnostics, and provenance; it does not approve or publish.
8. It is deterministic/reproducible for recorded inputs or records nondeterministic inputs and seed values.
9. Tests cover interval/constraint rules, multiple divisions, rooms, batches, breaks, holidays/exams, infeasible inputs, and a persisted-draft workflow using an approved isolated test database.
10. UI states expose configuration errors, unplaced requirements, warnings, and infeasibility; no fabricated schedule is shown as database output.

**Current decision:** Do not begin automatic timetable generation until the division inventory, calendar/event semantics, real resource inventory, approved period grids, and availability/workload policies are resolved.
