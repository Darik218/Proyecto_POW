BEGIN;
-- Existing rows remain NULL. The upper category is deliberately open-ended.
ALTER TABLE set_records ADD COLUMN rir VARCHAR(6);
ALTER TABLE set_records ADD CONSTRAINT set_records_rir_category_check
  CHECK (rir IS NULL OR rir IN ('0', '1', '2', '3', '4_PLUS'));
ALTER TABLE set_records ADD CONSTRAINT set_records_rir_executed_check
  CHECK (rir IS NULL OR (status IS NOT NULL AND status IN ('COMPLETED', 'INCOMPLETE', 'FAILED')));
COMMIT;
