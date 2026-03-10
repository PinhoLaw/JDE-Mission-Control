-- ============================================================
-- CRUZE UPGRADE — OMNISCIENT MODE
-- Persistent memory + conversation storage + vector search
-- ============================================================

-- 1. Enable pgvector extension for semantic memory
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. CRUZE CONVERSATIONS — one per user per event session
CREATE TABLE IF NOT EXISTS cruze_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id    uuid REFERENCES events(id) ON DELETE SET NULL,
  title       text,                -- auto-generated summary
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cruze_conv_user ON cruze_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_cruze_conv_event ON cruze_conversations(user_id, event_id);

-- 3. CRUZE MESSAGES — every message in every conversation
CREATE TABLE IF NOT EXISTS cruze_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES cruze_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         text NOT NULL,
  metadata        jsonb DEFAULT '{}',  -- tool calls, file refs, tier used, etc.
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cruze_msg_conv ON cruze_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cruze_msg_created ON cruze_messages(conversation_id, created_at);

-- 4. CRUZE MEMORIES — long-term vector memory per user
-- Stores extracted facts, preferences, recurring questions
CREATE TABLE IF NOT EXISTS cruze_memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id    uuid REFERENCES events(id) ON DELETE SET NULL,
  content     text NOT NULL,                    -- the memory text
  category    text DEFAULT 'general'            -- preference, insight, question, fact
                CHECK (category IN ('preference', 'insight', 'question', 'fact', 'general')),
  embedding   vector(1536),                     -- for semantic search
  importance  integer DEFAULT 5                 -- 1-10 scale
                CHECK (importance >= 1 AND importance <= 10),
  access_count integer DEFAULT 0,               -- how often this memory was retrieved
  last_accessed timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cruze_mem_user ON cruze_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_cruze_mem_event ON cruze_memories(user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_cruze_mem_category ON cruze_memories(user_id, category);

-- 5. CRUZE FILE UPLOADS — track files analyzed in chat
CREATE TABLE IF NOT EXISTS cruze_file_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES cruze_conversations(id) ON DELETE SET NULL,
  event_id        uuid REFERENCES events(id) ON DELETE SET NULL,
  file_name       text NOT NULL,
  file_type       text NOT NULL,          -- csv, xlsx, pdf, image
  file_size       integer,                -- bytes
  storage_path    text,                   -- Supabase storage path
  analysis        text,                   -- Cruze's analysis summary
  metadata        jsonb DEFAULT '{}',     -- parsed data, row counts, etc.
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cruze_files_user ON cruze_file_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_cruze_files_conv ON cruze_file_uploads(conversation_id);

-- 6. RLS POLICIES — users can only access their own data

ALTER TABLE cruze_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own conversations" ON cruze_conversations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE cruze_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own messages" ON cruze_messages
  FOR ALL TO authenticated
  USING (conversation_id IN (
    SELECT id FROM cruze_conversations WHERE user_id = auth.uid()
  ))
  WITH CHECK (conversation_id IN (
    SELECT id FROM cruze_conversations WHERE user_id = auth.uid()
  ));

ALTER TABLE cruze_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own memories" ON cruze_memories
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE cruze_file_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own files" ON cruze_file_uploads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 7. UPDATED_AT triggers
CREATE TRIGGER trg_cruze_conv_updated_at
  BEFORE UPDATE ON cruze_conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cruze_mem_updated_at
  BEFORE UPDATE ON cruze_memories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 8. Helper: search memories by similarity (used when pgvector embedding is available)
CREATE OR REPLACE FUNCTION search_cruze_memories(
  p_user_id uuid,
  p_embedding vector(1536),
  p_limit integer DEFAULT 5,
  p_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  content text,
  category text,
  importance integer,
  similarity float
) AS $$
  SELECT
    m.id,
    m.content,
    m.category,
    m.importance,
    1 - (m.embedding <=> p_embedding) AS similarity
  FROM cruze_memories m
  WHERE m.user_id = p_user_id
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> p_embedding) > p_threshold
  ORDER BY m.embedding <=> p_embedding
  LIMIT p_limit;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 9. Helper: get recent memories (text-based fallback when no embeddings)
CREATE OR REPLACE FUNCTION get_recent_cruze_memories(
  p_user_id uuid,
  p_event_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  content text,
  category text,
  importance integer,
  created_at timestamptz
) AS $$
  SELECT m.id, m.content, m.category, m.importance, m.created_at
  FROM cruze_memories m
  WHERE m.user_id = p_user_id
    AND (p_event_id IS NULL OR m.event_id = p_event_id OR m.event_id IS NULL)
  ORDER BY m.importance DESC, m.updated_at DESC
  LIMIT p_limit;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
