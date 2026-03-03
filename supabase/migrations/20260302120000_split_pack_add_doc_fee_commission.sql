-- ============================================================
-- Migration: Split dealer pack (new/used), doc fee commission toggle,
--            and gamification tables (badges, achievements, streaks)
-- ============================================================

-- ─── 1. event_config: pack split + doc fee toggle ─────────────────────────

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

-- ─── 2. badges table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT 'trophy',
  category text NOT NULL CHECK (category IN ('sales', 'gross', 'closing', 'streak', 'team')),
  points integer NOT NULL DEFAULT 0,
  condition_type text NOT NULL,
  condition_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'badges_read_all' AND tablename = 'badges') THEN
    CREATE POLICY badges_read_all ON badges FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ─── 3. user_achievements table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES roster(id) ON DELETE CASCADE,
  badge_id uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (roster_id, badge_id, event_id)
);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'achievements_read_event_members' AND tablename = 'user_achievements') THEN
    CREATE POLICY achievements_read_event_members ON user_achievements FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM event_members em
        WHERE em.event_id = user_achievements.event_id
          AND em.user_id = auth.uid()
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'achievements_insert_event_members' AND tablename = 'user_achievements') THEN
    CREATE POLICY achievements_insert_event_members ON user_achievements FOR INSERT TO authenticated
      WITH CHECK (EXISTS (
        SELECT 1 FROM event_members em
        WHERE em.event_id = user_achievements.event_id
          AND em.user_id = auth.uid()
      ));
  END IF;
END $$;

-- ─── 4. streaks table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES roster(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_activity_date date,
  UNIQUE (roster_id, event_id)
);

ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'streaks_read_event_members' AND tablename = 'streaks') THEN
    CREATE POLICY streaks_read_event_members ON streaks FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM event_members em
        WHERE em.event_id = streaks.event_id
          AND em.user_id = auth.uid()
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'streaks_write_event_members' AND tablename = 'streaks') THEN
    CREATE POLICY streaks_write_event_members ON streaks FOR INSERT TO authenticated
      WITH CHECK (EXISTS (
        SELECT 1 FROM event_members em
        WHERE em.event_id = streaks.event_id
          AND em.user_id = auth.uid()
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'streaks_update_event_members' AND tablename = 'streaks') THEN
    CREATE POLICY streaks_update_event_members ON streaks FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1 FROM event_members em
        WHERE em.event_id = streaks.event_id
          AND em.user_id = auth.uid()
      ));
  END IF;
END $$;

-- ─── 5. Seed default badges ──────────────────────────────────────────────

INSERT INTO badges (name, description, icon, category, points, condition_type, condition_value)
VALUES
  ('First Blood',       'Close your first deal at the event',         'zap',       'sales',   10,  'deals_gte',        1),
  ('Hat Trick',         'Close 3 deals in a single day',              'target',    'sales',   25,  'daily_deals_gte',  3),
  ('Five Star',         'Close 5 deals in a single day',              'star',      'sales',   50,  'daily_deals_gte',  5),
  ('Gross Monster',     'Land a deal with $3,000+ front gross',       'flame',     'gross',   30,  'front_gross_gte',  3000),
  ('Big Fish',          'Land a deal with $5,000+ total gross',       'trophy',    'gross',   50,  'total_gross_gte',  5000),
  ('Closer',            'Maintain 25%+ closing ratio (min 4 ups)',    'percent',   'closing', 35,  'close_pct_gte',    25),
  ('Hot Streak',        'Close deals on 3 consecutive days',          'flame',     'streak',  40,  'streak_days_gte',  3),
  ('Iron Man',          'Close deals on 5 consecutive days',          'shield',    'streak',  75,  'streak_days_gte',  5),
  ('Team Player',       'Be part of 3+ split deals',                  'users',     'team',    20,  'split_deals_gte',  3),
  ('Volume King',       'Close 10+ deals at a single event',          'crown',     'sales',   100, 'deals_gte',        10)
ON CONFLICT DO NOTHING;
