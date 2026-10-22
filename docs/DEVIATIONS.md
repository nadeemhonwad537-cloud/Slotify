# Deviations, assumptions and open issues

## Sources
`Slotify_Final_Database_Scope_v1_1-1.docx` and `Slotify_DBMS_Master_Data_Populated.xlsx` were **never accessible** in any session. The schema is built from the 41-entity handwritten diagram (all 41 tables exist) plus the approved decisions. It has NOT been reconciled against the Word specification. Do that first when the files are available.

## Table inventory: 46 application tables
41 from the diagram + 5 added: `role_permissions`, `refresh_sessions`, `designations`, `faculty_submissions`, `workload_counting_policy`.
Not created (deferred/unclassified in the handover): `timetable_version_semesters`, `template_versions`, `template_applications`, `template_items`, `session_occurrences`, `generation_run_scope`. The diagram's section-grain tables (`generation_run_sections`, `timetable_version_sections`) were kept.

## Changes to the diagram's tables
- `faculty_subject_preferences`: no longer carries `faculty_id`, `term_id`, `submission_status`, `review_status`; those live on `faculty_submissions` (approved design). Adds `component_key` (generated) and structural max-three via `preference_order` CHECK 1..3 + UNIQUE(submission, order).
- `faculty_assignments`: adds `source_preference_id` (nullable), `role_status`; `role` includes `UNSPECIFIED` (lead/assistant roles are VERIFY).
- `faculty_profiles`: `user_id` nullable (no faculty logins in the sources); adds `staff_code`, `employment_type`.
- `faculty_availability`: adds `submission_id`, `source`; `availability_type` is AVAILABLE/UNAVAILABLE/UNKNOWN. No row means unknown, never unrestricted.
- `scheduled_sessions`: stores actual `start_time`/`end_time`; `start_slot_id`/`slot_count` kept optional; adds `term_id`, `session_date`.
- `timetable_versions`: adds `availability_unknown_status` + override fields, `published_flag` (one published version per term). `generation_runs`: adds `allow_unknown_availability` + override reason/actor.
- `source_documents`/`data_provenance`: add `form_no`, `revision`, `source_page`, `field_name`, `resolution_notes`.
- `terms`: adds `parity` (ODD/EVEN). `sections`: composite FK keeps semester and scheme consistent.
- `approval_actions`: generic `action_type` because the Coordinator workflow is unconfirmed.

## Enforced in the database (tested)
Term consistency (sections, offerings, audiences, elective groups, sessions, versions) via composite FKs; unique submission per faculty/term; max-three preferences; component-belongs-to-course; availability states and time ranges; submission-sourced availability matches faculty and term; unique version numbers per term; one published version per term; published versions immutable (triggers); unknown-availability gate on review/approval/publish; override requires reason and actor.

## Needs backend/validator code (NOT yet written)
Room, faculty, section/batch/audience overlap using real time intervals; room capacity and type; faculty availability; consecutive lab periods; hours consistency; semester parity vs term parity; Saturday closing time; faculty on `source_preference_id` must match the assignment's faculty; workload limits; role checks on `reviewed_by`/`approved_by`.

## Known limitations
- `curriculum_courses.group_id` has no FK (curriculum is term-independent, `elective_groups` are per term). Needs a modelling decision.
- Cascaded FK deletes do not fire MySQL triggers; protection relies on published versions being undeletable.
- MySQL DDL is not transactional: a failed migration can leave partial tables (use `npm run db:reset` in dev).
- bcryptjs is used instead of the Argon2id suggested earlier (portability).

## Added in Milestone 2
| Change | Reason | Notes |
|---|---|---|
| Migration `003_audit_logs.sql` adds table `audit_logs` (actor, action, table, record id, JSON details, timestamp) | Milestone 2 requires reviewer/audit information; the 46-table schema had no audit table (the Word spec lists a minimal audit log). | Append-only by convention (the application never updates/deletes rows); no trigger added, so the trigger count stays 10. Table count is now 47 + `schema_migrations`; the inventory test was updated deliberately. Existing migrations 001/002 are untouched. |
