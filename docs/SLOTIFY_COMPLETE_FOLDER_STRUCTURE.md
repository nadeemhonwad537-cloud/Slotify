# Slotify Complete Folder Structure

**Inspection date:** 2026-10-22  
**Project root:** `C:\Users\Lenovo\Downloads\slotify-admin-portal-checkpoint1\slotify\`  
**Inspection method:** Recursive filesystem listing; no application/database commands were run.

## Scope and exclusions

The scan found **35 directories and 182 files** before creating this inventory and engine-map document. The tree below includes these two deliverable documents, so the documented current tree contains **35 directories and 184 files**.

Excluded recursively: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.vite`, `.cache`, and `__pycache__`. No paths in those categories are listed. The existing `backend\.env` is listed by filename only; its contents are intentionally omitted. `backend\.env.example` is also listed by filename only.

## Actual project tree

```text
slotify\
|-- .gitignore
|-- .vscode\
|   |-- settings.json
|-- backend\
|   |-- .env [filename only; contents omitted]
|   |-- .env.example
|   |-- package.json
|   |-- package-lock.json
|   |-- src\
|   |   |-- app.ts
|   |   |-- config\
|   |   |   |-- env.ts
|   |   |   |-- testDatabaseSafety.ts
|   |   |-- db\
|   |   |   |-- migrate.ts
|   |   |   |-- pool.ts
|   |   |   |-- reset.ts
|   |   |-- middleware\
|   |   |   |-- auth.ts
|   |   |   |-- error.ts
|   |   |   |-- security.ts
|   |   |-- routes\
|   |   |   |-- admin.ts
|   |   |   |-- assignments.ts
|   |   |   |-- auth.ts
|   |   |   |-- masterdata.ts
|   |   |   |-- submissions.ts
|   |   |   |-- timetable.ts
|   |   |   |-- users.ts
|   |   |   |-- workloadImports.ts
|   |   |-- rules\
|   |   |   |-- scheduleRules.ts
|   |   |-- scripts\
|   |   |   |-- createAdmin.ts
|   |   |   |-- importWorkloadSource.ts
|   |   |   |-- planWorkloadImport.ts
|   |   |   |-- previewWorkloadImport.ts
|   |   |   |-- verifyWorkloadImport.ts
|   |   |-- server.ts
|   |   |-- services\
|   |   |   |-- academicTermRules.ts
|   |   |   |-- allocationRules.ts
|   |   |   |-- audit.ts
|   |   |   |-- authService.ts
|   |   |   |-- curriculumAudienceRules.ts
|   |   |   |-- curriculumBuilder.ts
|   |   |   |-- curriculumDraftRules.ts
|   |   |   |-- facultyTimetableService.ts
|   |   |   |-- preferenceValidation.ts
|   |   |   |-- schedulingConfiguration.ts
|   |   |   |-- schedulingConfigurationService.ts
|   |   |   |-- submissionRules.ts
|   |   |   |-- submissionService.ts
|   |   |   |-- timetableLifecycleRules.ts
|   |   |   |-- timetableLifecycleService.ts
|   |   |   |-- timetableSessionRules.ts
|   |   |   |-- timetableSessionService.ts
|   |   |   |-- validationService.ts
|   |   |   |-- workloadImportPreview.ts
|   |   |   |-- workloadImportService.ts
|   |   |   |-- workloadService.ts
|   |   |-- utils\
|   |   |   |-- crud.ts
|   |   |   |-- errors.ts
|   |   |   |-- zodHelpers.ts
|   |-- tests\
|   |   |-- academicTermRules.node.test.ts
|   |   |-- allocationRules.node.test.ts
|   |   |-- allocationRules.test.ts
|   |   |-- api.admin.test.ts
|   |   |-- api.assignments.test.ts
|   |   |-- api.auth.test.ts
|   |   |-- api.masterdata.test.ts
|   |   |-- api.submissions.test.ts
|   |   |-- api.timetable.test.ts
|   |   |-- api.workloadImports.test.ts
|   |   |-- apiHelpers.ts
|   |   |-- curriculumAudienceRules.node.test.ts
|   |   |-- curriculumBuilder.node.test.ts
|   |   |-- curriculumDraftEditor.node.test.ts
|   |   |-- curriculumDraftRules.node.test.ts
|   |   |-- curriculumSelection.node.test.ts
|   |   |-- db.constraints.test.ts
|   |   |-- facultyAcademicContext.node.test.ts
|   |   |-- facultyAvailabilityEditor.node.test.ts
|   |   |-- facultyProfileQuery.node.test.ts
|   |   |-- facultyTimetableQuery.node.test.ts
|   |   |-- globalSetup.ts
|   |   |-- helpers.ts
|   |   |-- scheduleRules.node.test.ts
|   |   |-- schedulingConfiguration.node.test.ts
|   |   |-- submissionPreferences.node.test.ts
|   |   |-- submissionRules.node.test.ts
|   |   |-- testDatabaseSafety.node.test.ts
|   |   |-- timetableLifecycleRules.node.test.ts
|   |   |-- timetableSessionRules.node.test.ts
|   |   |-- workloadImportPreview.node.test.ts
|   |-- tsconfig.json
|   |-- vitest.config.ts
|-- database\
|   |-- migrations\
|   |   |-- 001_core.sql
|   |   |-- 002_timetable.sql
|   |   |-- 002_workload_import_review.sql
|   |   |-- 003_audit_logs.sql
|   |   |-- 003_workload_import_summary.sql
|   |   |-- 004_faculty_source_subject_preferences.sql
|   |   |-- 005_term_program_semesters.sql
|   |   |-- 006_room_location.sql
|   |   |-- 007_preference_curriculum_context.sql
|   |   |-- 008_room_practical_approval.sql
|   |   |-- 009_curriculum_drafts.sql
|   |-- seeds\
|   |   |-- reference\
|   |   |   |-- 001_reference_data.sql
|-- docs\
|   |-- BACKEND_PROGRESS.md
|   |-- DECISIONS.md
|   |-- DEVIATIONS.md
|   |-- FUNCTIONAL_AUDIT.md
|   |-- GATE1_ACTUAL_DEMO_READINESS.md
|   |-- GATE1_SAFE_DEMO_PLAN.md
|   |-- imports\
|   |   |-- CSE_EVEN_2026_extraction.md
|   |   |-- CSE_EVEN_2026_import_plan.json
|   |   |-- CSE_EVEN_2026_import_plan.md
|   |   |-- CSE_EVEN_2026_import_plan_initial.json
|   |   |-- CSE_EVEN_2026_import_plan_initial.md
|   |   |-- CSE_EVEN_2026_preview.json
|   |   |-- CSE_EVEN_2026_preview.md
|   |   |-- source\
|   |   |   |-- CSE_EVEN_2026_page1.png
|   |   |   |-- CSE_EVEN_2026_page2.jpe
|   |-- PROJECT_STATUS.md
|   |-- SCHEDULING_REQUIREMENTS.md
|   |-- SLOTIFY_COMPLETE_FOLDER_STRUCTURE.md
|   |-- SLOTIFY_FOUR_ENGINE_FILE_MAPPING.md
|   |-- TEST_PLAN.md
|-- frontend\
|   |-- index.html
|   |-- package.json
|   |-- package-lock.json
|   |-- postcss.config.js
|   |-- README.md
|   |-- tailwind.config.js
|   |-- tsconfig.json
|   |-- vite.config.ts
|   |-- src\
|   |   |-- App.tsx
|   |   |-- components\
|   |   |   |-- faculty\
|   |   |   |   |-- FacultyProfileStatus.tsx
|   |   |   |   |-- FacultyTermContextSelector.tsx
|   |   |   |-- layout\
|   |   |   |   |-- AdminShell.tsx
|   |   |   |   |-- FacultyShell.tsx
|   |   |   |   |-- StudentShell.tsx
|   |   |   |-- ui\
|   |   |   |   |-- Badge.tsx
|   |   |   |   |-- Card.tsx
|   |   |   |   |-- DataTable.tsx
|   |   |   |   |-- EmptyState.tsx
|   |   |   |   |-- ErrorMessage.tsx
|   |   |   |   |-- LoadingScreen.tsx
|   |   |   |   |-- Modal.tsx
|   |   |   |   |-- PageHeader.tsx
|   |   |-- contexts\
|   |   |   |-- AuthContext.tsx
|   |   |-- hooks\
|   |   |   |-- useFacultyProfile.ts
|   |   |-- index.css
|   |   |-- lib\
|   |   |   |-- academicTermRules.ts
|   |   |   |-- api.ts
|   |   |   |-- curriculumDraftEditor.ts
|   |   |   |-- curriculumSelection.ts
|   |   |   |-- facultyAcademicContext.ts
|   |   |   |-- facultyProfileQuery.ts
|   |   |   |-- facultySubmissionEditor.ts
|   |   |   |-- facultyTimetableQuery.ts
|   |   |   |-- queryClient.ts
|   |   |-- main.tsx
|   |   |-- pages\
|   |   |   |-- admin\
|   |   |   |   |-- AcademicStructurePage.tsx
|   |   |   |   |-- AllocationPlanner.tsx
|   |   |   |   |-- AssignmentsPage.tsx
|   |   |   |   |-- CoursesPage.tsx
|   |   |   |   |-- CurriculumBuilder.tsx
|   |   |   |   |-- DashboardPage.tsx
|   |   |   |   |-- DepartmentsPage.tsx
|   |   |   |   |-- FacultyPage.tsx
|   |   |   |   |-- RoomsPage.tsx
|   |   |   |   |-- SubmissionsPage.tsx
|   |   |   |   |-- TimetableVersionsPage.tsx
|   |   |   |   |-- UsersPage.tsx
|   |   |   |   |-- ValidationPage.tsx
|   |   |   |   |-- WorkloadImportPage.tsx
|   |   |   |-- auth\
|   |   |   |   |-- LoginPage.tsx
|   |   |   |-- faculty\
|   |   |   |   |-- AssignedSubjectsPage.tsx
|   |   |   |   |-- AvailabilityPage.tsx
|   |   |   |   |-- DashboardPage.tsx
|   |   |   |   |-- PreferencesPage.tsx
|   |   |   |   |-- ProfilePage.tsx
|   |   |   |   |-- TimetablePage.tsx
|   |   |   |   |-- TrackPage.tsx
|   |   |   |   |-- WorkloadPage.tsx
|   |   |   |-- student\
|   |   |   |   |-- DashboardPage.tsx
|   |   |   |   |-- SubjectsPage.tsx
|   |   |   |   |-- TimetablePage.tsx
|   |   |-- router\
|   |   |   |-- index.tsx
|   |   |-- types\
|   |   |   |-- index.ts
|-- HANDOVER.md
|-- README.md
```

The structure is a filesystem inventory, not a claim that every listed feature is operational. For responsibilities, evidence and four-engine ownership, see [SLOTIFY_FOUR_ENGINE_FILE_MAPPING.md](./SLOTIFY_FOUR_ENGINE_FILE_MAPPING.md).
