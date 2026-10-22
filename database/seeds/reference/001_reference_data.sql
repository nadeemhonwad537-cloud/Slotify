-- SAFE REFERENCE DATA ONLY. No university records (no departments, faculty, courses, rooms, slots).
-- Idempotent. COORDINATOR permissions are PROVISIONAL pending college confirmation.

INSERT IGNORE INTO role_permissions (role, permission, is_provisional) VALUES
 ('ADMIN','users:manage',0),
 ('ADMIN','masterdata:read',0),
 ('ADMIN','masterdata:write',0),
 ('ADMIN','faculty_submission:review',0),
 ('ADMIN','assignments:manage',0),
 ('ADMIN','workload_rules:manage',0),
 ('ADMIN','timetable:generate',0),
 ('ADMIN','timetable:edit',0),
 ('ADMIN','timetable:review',0),
 ('ADMIN','timetable:publish',1),
 ('ADMIN','availability:override',0),
 ('ADMIN','timetable:view_published',0),
 ('FACULTY','masterdata:read',0),
 ('FACULTY','faculty_submission:own',0),
 ('FACULTY','timetable:view_published',0),
 ('STUDENT','timetable:view_published',0),
 ('COORDINATOR','masterdata:read',1),
 ('COORDINATOR','timetable:review',1),
 ('COORDINATOR','timetable:approve',1),
 ('COORDINATOR','timetable:view_published',1);

-- Generic room categories (not institutional records).
INSERT IGNORE INTO room_types (type_code, type_name, description) VALUES
 ('CLASSROOM','Classroom','Generic classroom'),
 ('LAB','Laboratory','Generic laboratory');

-- Designations named in the approved workload requirement; status VERIFY until confirmed.
INSERT IGNORE INTO designations (designation_code, designation_name, data_status) VALUES
 ('ASSOCIATE_PROFESSOR','Associate Professor','VERIFY'),
 ('ASSISTANT_PROFESSOR','Assistant Professor','VERIFY');

INSERT INTO faculty_workload_rules (designation_id, max_hours, enforcement_mode, data_status)
SELECT d.designation_id, v.max_hours, 'HARD', 'VERIFY'
FROM designations d
JOIN (SELECT 'ASSOCIATE_PROFESSOR' AS code, 18.0 AS max_hours
      UNION ALL SELECT 'ASSISTANT_PROFESSOR', 20.0) v ON v.code = d.designation_code
WHERE NOT EXISTS (SELECT 1 FROM faculty_workload_rules r WHERE r.designation_id = d.designation_id);

INSERT IGNORE INTO workload_counting_policy (activity_type, counts_toward_limit, notes) VALUES
 ('LAB_ASSISTANT','UNCONFIRMED','Counting rule not confirmed by the university'),
 ('PROJECT_SUPERVISION','UNCONFIRMED','Counting rule not confirmed by the university'),
 ('SDP','UNCONFIRMED','Counting rule not confirmed by the university'),
 ('MINOR_PROJECT','UNCONFIRMED','Counting rule not confirmed by the university');
