-- Split dealer pack into new vs used, add doc fee commission toggle
-- Backward-compatible: keep old `pack` column, add new columns

ALTER TABLE event_config
  ADD COLUMN IF NOT EXISTS pack_new numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pack_used numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS include_doc_fee_in_commission boolean DEFAULT false;

-- Migrate existing pack values to both new/used (assumes same value for now)
UPDATE event_config
SET pack_new = pack,
    pack_used = pack
WHERE pack IS NOT NULL
  AND pack_new IS NULL;
