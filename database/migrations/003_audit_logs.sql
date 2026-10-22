-- Slotify migration 003: minimal audit log (added in Milestone 2; see docs/DEVIATIONS.md).
-- Application-written, append-only by convention (no UPDATE/DELETE code paths). No triggers added.
CREATE TABLE audit_logs (
  audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  record_id BIGINT UNSIGNED NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_audit_record (table_name, record_id),
  KEY ix_audit_actor (actor_user_id, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;
