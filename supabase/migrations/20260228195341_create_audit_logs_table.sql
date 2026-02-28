-- ============================================================
-- Audit Logs table — tracks all changes across the dashboard
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  user_id     UUID REFERENCES auth.users,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  TEXT
);

-- Index for fast event-scoped queries (the primary access pattern)
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_id
  ON audit_logs (event_id, created_at DESC);

-- Index for user-scoped queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
  ON audit_logs (user_id);

-- ─── Row Level Security ──────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only owners/managers of an event can read its audit logs
CREATE POLICY "Event owners and managers can read audit logs"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM event_members
      WHERE event_members.event_id = audit_logs.event_id
        AND event_members.user_id  = auth.uid()
        AND event_members.role IN ('owner', 'manager')
    )
  );

-- Any authenticated user can insert audit logs (the server does this)
CREATE POLICY "Authenticated users can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Enable realtime for the audit_logs table
ALTER PUBLICATION supabase_realtime ADD TABLE audit_logs;
