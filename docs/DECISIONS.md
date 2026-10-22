# Decision log
Status: APPROVED, PROPOSED, UNRESOLVED, NEEDS UNIVERSITY CONFIRMATION.

| ID | Decision | Status | Implemented? |
|---|---|---|---|
| A | Provenance/verification storage | PROPOSED: `source_documents`, `data_provenance`, `discrepancy_log` + `data_status` columns | Schema only |
| B | Faculty identifiers nullable | PROPOSED | Yes: `user_id`, `staff_code`, `designation_id`, `dept_id` nullable |
| C | Assignment granularity | UNRESOLVED | Assignments attach to `offering_audiences` (section/batch) as in the diagram |
| D | Assignment approval/actor tracking | UNRESOLVED | Diagram fields kept (`is_approved`, `approved_by`, `approved_at`) |
| E/F/G | Faculty submissions, preference target, max three | APPROVED (direction) | Schema + authenticated API and UI; DB-level tests remain environment-dependent |
| H | Unknown/missing availability: default block unless explicit authorized override | APPROVED | Allocation finalization and single-assignment approval now block without verified AVAILABLE windows; timetable validation blocks missing/UNKNOWN faculty and room availability. Timetable-specific interval matching still occurs in the validator. |
| I/J | Designation lookup + configurable workload rules | PROPOSED (user: "use proposed limits") | Schema + seed (18/20, status VERIFY); counting service not written |
| Counting rules (lab assistant, project, SDP, minor project) | | NEEDS UNIVERSITY CONFIRMATION | Seeded `UNCONFIRMED` |
| K/L | Weekly hours, nullable scheduling fields | PROPOSED | Hours nullable, `data_status` on rows |
| M/N | Day-specific slots, Saturday cutoff, actual start/end times | OWNER-CONFIRMED: weekdays 08:00–17:30, 60-minute period, weekday lunch 12:30–13:30, Saturday ends by 12:30; grids are term-configured | Existing `term_teaching_days`, `time_slots`, `term_day_slots`; shared bounds in `rules/scheduleRules.ts`; config check at `/api/timetable/configuration/:termId`. See `docs/SCHEDULING_REQUIREMENTS.md`. |
| Scheduling inventory | 12 active divisions per running term, four each in odd 3/5/7 or even 4/6/8; shared physical inventory of 8 classrooms + 4 labs across parity | OWNER-CONFIRMED 2026-10-21 | Readiness validation enforces counts and parity; current database records do not satisfy this inventory. |
| Classroom practical approval | Classroom may host practical work only after explicit approval | OWNER-CONFIRMED | Migration 008 and Admin room field added (migration not applied); default is not approved. |
| O | Table classification | PROPOSED | See DEVIATIONS.md |
| P/S | Course categories, course-code uniqueness | UNRESOLVED | `course_code` nullable, NOT unique |
| Q | `session_occurrences`, `generation_run_scope` | DEFERRED | Not created; `scheduled_sessions.session_date` covers dated sessions for now |
| R | Semester V / Semester I imports | UNRESOLVED | Nothing imported |
| Coordinator workflow/permissions | | NEEDS UNIVERSITY CONFIRMATION | Permissions provisional (`is_provisional=1`) |
| Saturday periods, lab consecutiveness across breaks, Sem VII patterns | | NEEDS UNIVERSITY CONFIRMATION | Not hardcoded |
| Engineering choices (no approval needed) | bcryptjs (cost 12), JWT in HttpOnly cookie (15 min) + hashed rotating refresh sessions, double-submit CSRF + Origin check, Vitest + Supertest, migrations tracked with checksums | Recorded | Yes |

## Milestone 1 (master-data APIs) — implementation decisions
| Topic | Decision | Status |
|---|---|---|
| Semester parity | Odd semester numbers only in `ODD` terms, even only in `EVEN` terms; enforced when a section is created. Term parity is locked once the term has sections. | Implemented; confirm against college practice |
| Saturday cutoff | Owner-confirmed: Saturday is a half-day; classes finish by 12:30. A configured earlier closing time is stricter. Exact Saturday periods remain unconfigured. | 12:30 cutoff implemented in shared rule; full session/day-grid enforcement and periods remain unverified |
| Day-specific grids | Overlap is checked only among slots active on the same day (via `term_day_slots`), so Saturday may use different slot rows than weekdays. | Implemented |
| No invented defaults | A teaching day's `closing_time` stays NULL unless supplied (except Saturday, where it is required). `availability_type` has no default on room availability. `data_status` defaults to `VERIFY`. | Implemented |
| Derived columns | `sections.scheme_id`, `curriculum_courses.scheme_id`, `offering_audiences.term_id`, `elective_group_offerings.term_id`, `term_day_slots.term_id` are derived from the parent on the server and rejected if sent by a client. | Implemented |
| Re-parenting | Parent/key columns are immutable after creation (PATCH rejects them); delete and recreate instead. | Implemented |
| Deletes | Hard delete is allowed but blocked with 409 `IN_USE` when referenced; use `is_active=false` to retire records. | Implemented |
| Faculty list | Reading `/faculty` needs `masterdata:write` or `faculty_submission:review` (contact details are not exposed to every reader). | Implemented |
| Fractional hours | `weekly_hours` accepts fractions (e.g. 1.5); whether a fractional session fits the grid is left to the validator (Milestone 4). | Open (university) |
| Course-code uniqueness (S) | Not enforced. | Unresolved |
| Faculty availability | Admin entry and faculty submission are built together in Milestone 2 (one workflow). Room availability is in Milestone 1. | Planned |

## Milestone 2 (faculty submissions and availability) — implementation decisions
| Topic | Decision | Status |
|---|---|---|
| Identity | Faculty act only on their own submission; the faculty profile is resolved from the session user (`faculty_profiles.user_id`). A login without a linked active profile gets 403 `NO_FACULTY_PROFILE`. | Implemented |
| Three-preference limit | Enforced three times: Zod (`max 3`), service check, and MySQL (CHECK 1..3 + unique order per submission). Order is the array position. Zero preferences are allowed. | Implemented, tested (DB level tested with direct inserts) |
| Exactly three preferences required at submit | Current service and UI require exactly three; source university specification/workbook has not been reconciled or made available. | NEEDS UNIVERSITY CONFIRMATION |
| Draft save | `PUT /api/faculty-submissions/mine` replaces the whole draft (preferences + availability) in one transaction. | Implemented |
| States | submission: NOT_STARTED -> DRAFT -> SUBMITTED -> (RETURNED -> SUBMITTED). review: PENDING -> IN_REVIEW -> ACCEPTED, or CHANGES_REQUESTED on return. A submitted form is locked (409) until returned. | Implemented; exact wording of states is proposed, not university policy |
| Return-for-correction | Requires a comment. After editing, the form stays RETURNED until the faculty resubmits; resubmission resets review fields (the old comment is kept in the audit log). | Implemented |
| Accepting | Accepting a form records the reviewer/time only. It never creates a `faculty_assignments` row; preferences are requests. | Implemented, tested |
| Self-review | A reviewer who is the owner of the submission gets 403 `SELF_REVIEW`. | Implemented |
| Who reviews | Permission `faculty_submission:review` (ADMIN in the seed). Coordinator does not have it; whether the Coordinator should review is a university question. | Provisional |
| Availability | Explicit AVAILABLE / UNAVAILABLE / UNKNOWN with no default. Time not recorded is reported as `unrecordedAvailability: "UNKNOWN"`, never AVAILABLE. Admin entries (`source=ADMIN_ENTRY`) and faculty windows may not overlap for the same faculty/term/day. Admin cannot edit faculty-submitted windows directly (return the form instead). | Implemented |
| Audit | Every draft save, submit, review step and admin availability change writes `audit_logs` in the same transaction. | Implemented (master-data CRUD from Milestone 1 is still not audited) |
| Curriculum eligibility for faculty preferences | Faculty choose an active term-program-semester mapping; only mapped course components with an `OFFERED` term offering are eligible. Unverified workload labels are not preference targets. The selected semester is recorded with each course preference. | Implemented; requires migrations 005 and 007 and configured mappings |
