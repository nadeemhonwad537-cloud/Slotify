ALTER TABLE faculty_subject_preferences
  ADD COLUMN semester_id INT UNSIGNED NULL AFTER course_id,
  ADD KEY ix_pref_curriculum_course (semester_id, course_id),
  ADD CONSTRAINT fk_pref_curriculum_course
    FOREIGN KEY (semester_id, course_id)
    REFERENCES curriculum_courses (semester_id, course_id);
