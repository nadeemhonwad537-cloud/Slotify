-- Keep requests for unresolved imported subject labels separate from canonical course preferences.
CREATE TABLE faculty_source_subject_preferences (
  source_preference_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  submission_id BIGINT UNSIGNED NOT NULL,
  preference_order TINYINT UNSIGNED NOT NULL,
  workload_import_row_id BIGINT UNSIGNED NOT NULL,
  subject_column VARCHAR(32) NOT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_pref_order (submission_id, preference_order),
  UNIQUE KEY uq_source_pref_target (submission_id, workload_import_row_id, subject_column),
  CONSTRAINT fk_source_pref_submission FOREIGN KEY (submission_id)
    REFERENCES faculty_submissions(submission_id) ON DELETE CASCADE,
  CONSTRAINT fk_source_pref_row FOREIGN KEY (workload_import_row_id)
    REFERENCES workload_import_rows(workload_import_row_id) ON DELETE CASCADE,
  CONSTRAINT ck_source_pref_order CHECK (preference_order BETWEEN 1 AND 3),
  CONSTRAINT ck_source_pref_column CHECK (subject_column IN ('Subject-I', 'Subject-II', 'Subject-III'))
) ENGINE=InnoDB;
