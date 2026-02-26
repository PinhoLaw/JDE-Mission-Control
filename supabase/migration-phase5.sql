-- ============================================================
-- PHASE 5 MIGRATION: photo_url + audit_logs
-- Run after schema-v2.sql / schema.sql
-- ============================================================

-- 1. Add photo_url to vehicle_inventory
ALTER TABLE vehicle_inventory ADD COLUMN IF NOT EXISTS photo_url text;

-- 2. Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,           -- 'create', 'update', 'delete'
  entity_type text NOT NULL,      -- 'deal', 'vehicle', 'roster', 'config', 'lender'
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- Index for fast event-scoped queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_id ON audit_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- RLS for audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select"
  ON audit_logs FOR SELECT
  USING (is_event_member(event_id));

CREATE POLICY "audit_logs_insert"
  ON audit_logs FOR INSERT
  WITH CHECK (is_event_member(event_id));

-- 3. Create Supabase Storage bucket for vehicle photos
-- Run in dashboard SQL editor or via API:
-- INSERT INTO storage.buckets (id, name, public, file_size_limit)
-- VALUES ('vehicle-photos', 'vehicle-photos', true, 5242880)
-- ON CONFLICT DO NOTHING;
