-- Record explicit approval before a classroom is used for practical teaching.
-- Existing rooms default to not approved; no existing resource data is promoted.
-- Reversal: ALTER TABLE rooms DROP COLUMN practical_approved;
ALTER TABLE rooms
  ADD COLUMN practical_approved TINYINT(1) NOT NULL DEFAULT 0 AFTER equipment;
