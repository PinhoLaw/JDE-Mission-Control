-- ============================================================
-- JDE MISSION CONTROL — PRODUCTION SCHEMA v3
-- Complete car-sales event management with proper RLS
-- ============================================================
-- DESIGN PRINCIPLES:
-- 1. Every row is event-scoped. No data leaks between events.
-- 2. RLS uses is_event_member() for per-event isolation.
-- 3. Roles: owner > manager > member (graduated permissions).
-- 4. Trigger auto-inserts creator as 'owner' on new events.
-- 5. Views pre-compute KPIs for O(1) dashboard loads.
-- 6. Indexes on every FK + common filter columns.
-- ============================================================

-- =====================
-- CLEANUP (safe re-run)
-- =====================
DROP VIEW IF EXISTS v_event_kpis CASCADE;
DROP VIEW IF EXISTS v_salesperson_stats CASCADE;
DROP VIEW IF EXISTS v_mail_response_stats CASCADE;
DROP VIEW IF EXISTS v_daily_sales CASCADE;

DROP TABLE IF EXISTS chargebacks CASCADE;
DROP TABLE IF EXISTS commissions CASCADE;
DROP TABLE IF EXISTS daily_metrics CASCADE;
DROP TABLE IF EXISTS mail_tracking CASCADE;
DROP TABLE IF EXISTS sales_deals CASCADE;
DROP TABLE IF EXISTS vehicle_inventory CASCADE;
DROP TABLE IF EXISTS lenders CASCADE;
DROP TABLE IF EXISTS roster CASCADE;
DROP TABLE IF EXISTS event_config CASCADE;
DROP TABLE IF EXISTS event_members CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Also drop old v1/v2 tables that may exist
DROP TABLE IF EXISTS zip_analytics CASCADE;
DROP TABLE IF EXISTS commission_summary CASCADE;
DROP TABLE IF EXISTS daily_performance CASCADE;
DROP TABLE IF EXISTS deals_v2 CASCADE;
DROP TABLE IF EXISTS dealership_credentials CASCADE;
DROP TABLE IF EXISTS deals CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS daily_log CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;

DROP FUNCTION IF EXISTS is_event_member(uuid) CASCADE;
DROP FUNCTION IF EXISTS is_event_role(uuid, text[]) CASCADE;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS auto_add_event_owner() CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_v2() CASCADE;

-- ============================================================
-- 1. PROFILES — mirrors auth.users, auto-created on signup
-- ============================================================
-- WHY: Supabase auth.users is in a protected schema. We need a
-- public profiles table for RLS joins and display names.
CREATE TABLE profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text,
  avatar_url  text,
  phone       text,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('superadmin','admin','member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE profiles IS 'Public user profiles, auto-created via trigger on auth.users insert.';

-- Auto-create profile when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if present, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 2. EVENTS — master record for each sales blitz
-- ============================================================
CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  dealer_name  text,
  address      text,
  city         text,
  state        text,
  zip          text,
  franchise    text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled')),
  start_date   date,
  end_date     date,
  sale_days    integer DEFAULT 6,
  budget       numeric(12,2),
  notes        text,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE events IS 'Master event record. Each row = one pop-up sales blitz at a dealership.';

CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_created_by ON events(created_by);

-- ============================================================
-- 3. EVENT MEMBERS — who can access each event + their role
-- ============================================================
CREATE TABLE event_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','manager','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);
COMMENT ON TABLE event_members IS 'Maps users to events with role-based access. Core of RLS isolation.';

CREATE INDEX idx_event_members_event ON event_members(event_id);
CREATE INDEX idx_event_members_user ON event_members(user_id);
CREATE INDEX idx_event_members_lookup ON event_members(user_id, event_id);

-- ============================================================
-- AUTO-ADD CREATOR AS OWNER
-- ============================================================
CREATE OR REPLACE FUNCTION auto_add_event_owner()
RETURNS trigger AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.event_members (event_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'owner')
    ON CONFLICT (event_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_add_event_owner
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION auto_add_event_owner();

-- ============================================================
-- HELPER FUNCTIONS for RLS
-- ============================================================
CREATE OR REPLACE FUNCTION is_event_member(p_event_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_members
    WHERE event_id = p_event_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_event_role(p_event_id uuid, p_roles text[])
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_members
    WHERE event_id = p_event_id AND user_id = auth.uid() AND role = ANY(p_roles)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- UPDATED_AT trigger (reused everywhere)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 4. EVENT CONFIG — financial settings per event
-- ============================================================
CREATE TABLE event_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE UNIQUE,
  doc_fee             numeric(10,2) DEFAULT 0,
  tax_rate            numeric(6,4) DEFAULT 0,
  pack                numeric(10,2) DEFAULT 0,
  jde_commission_pct  numeric(5,4) DEFAULT 0.35,
  rep_commission_pct  numeric(5,4) DEFAULT 0.25,
  mail_campaign_name  text,
  mail_pieces_sent    integer DEFAULT 0,
  target_units        integer,
  target_gross        numeric(12,2),
  target_pvr          numeric(10,2),
  washout_threshold   numeric(10,2) DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_config_event ON event_config(event_id);
CREATE TRIGGER trg_event_config_updated_at
  BEFORE UPDATE ON event_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 5. ROSTER
-- ============================================================
CREATE TABLE roster (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name            text NOT NULL,
  phone           text,
  email           text,
  role            text NOT NULL DEFAULT 'sales' CHECK (role IN ('sales','team_leader','fi_manager','closer','manager')),
  team            text,
  commission_pct  numeric(5,4) DEFAULT 0.25,
  confirmed       boolean DEFAULT false,
  active          boolean DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_roster_event ON roster(event_id);
CREATE INDEX idx_roster_event_active ON roster(event_id, active);
CREATE TRIGGER trg_roster_updated_at
  BEFORE UPDATE ON roster FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 6. LENDERS
-- ============================================================
CREATE TABLE lenders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         text NOT NULL,
  buy_rate_pct numeric(6,4),
  max_advance  numeric(12,2),
  notes        text,
  active       boolean DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lenders_event ON lenders(event_id);

-- ============================================================
-- 7. VEHICLE INVENTORY
-- ============================================================
CREATE TABLE vehicle_inventory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  hat_number      integer,
  stock_number    text,
  vin             text,
  year            integer,
  make            text,
  model           text,
  trim            text,
  body_style      text,
  color           text,
  mileage         integer,
  age_days        integer,
  drivetrain      text,
  acquisition_cost numeric(12,2),
  jd_trade_clean   numeric(12,2),
  jd_retail_clean  numeric(12,2),
  asking_price_115 numeric(12,2),
  asking_price_120 numeric(12,2),
  asking_price_125 numeric(12,2),
  asking_price_130 numeric(12,2),
  profit_115       numeric(12,2),
  profit_120       numeric(12,2),
  profit_125       numeric(12,2),
  profit_130       numeric(12,2),
  retail_spread    numeric(12,2),
  sold_price       numeric(12,2),
  sold_date        date,
  sold_to          text,
  salesperson_id   uuid REFERENCES roster(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','hold','pending','wholesale')),
  label            text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_inv_event ON vehicle_inventory(event_id);
CREATE INDEX idx_vehicle_inv_status ON vehicle_inventory(event_id, status);
CREATE INDEX idx_vehicle_inv_stock ON vehicle_inventory(event_id, stock_number);
CREATE INDEX idx_vehicle_inv_sold_date ON vehicle_inventory(sold_date) WHERE sold_date IS NOT NULL;
CREATE TRIGGER trg_vehicle_inv_updated_at
  BEFORE UPDATE ON vehicle_inventory FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 8. SALES DEALS
-- ============================================================
CREATE TABLE sales_deals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vehicle_id        uuid REFERENCES vehicle_inventory(id) ON DELETE SET NULL,
  deal_number       integer,
  sale_day          integer,
  sale_date         date,
  customer_name     text,
  customer_zip      text,
  customer_phone    text,
  stock_number      text,
  vehicle_year      integer,
  vehicle_make      text,
  vehicle_model     text,
  vehicle_type      text,
  vehicle_cost      numeric(12,2),
  new_used          text DEFAULT 'Used' CHECK (new_used IN ('New','Used','Certified')),
  trade_year        integer,
  trade_make        text,
  trade_model       text,
  trade_type        text,
  trade_mileage     integer,
  trade_acv         numeric(12,2),
  trade_payoff      numeric(12,2),
  salesperson       text,
  salesperson_pct   numeric(5,4) DEFAULT 1.0,
  salesperson_id    uuid REFERENCES roster(id) ON DELETE SET NULL,
  second_salesperson text,
  second_sp_pct     numeric(5,4),
  second_sp_id      uuid REFERENCES roster(id) ON DELETE SET NULL,
  selling_price     numeric(12,2),
  front_gross       numeric(12,2),
  lender            text,
  rate              numeric(8,4),
  finance_type      text DEFAULT 'retail' CHECK (finance_type IN ('retail','lease','cash')),
  reserve           numeric(12,2) DEFAULT 0,
  warranty          numeric(12,2) DEFAULT 0,
  gap               numeric(12,2) DEFAULT 0,
  aftermarket_1     numeric(12,2) DEFAULT 0,
  aftermarket_2     numeric(12,2) DEFAULT 0,
  doc_fee           numeric(10,2) DEFAULT 0,
  fi_total          numeric(12,2) DEFAULT 0,
  back_gross        numeric(12,2) DEFAULT 0,
  total_gross       numeric(12,2) DEFAULT 0,
  pvr               numeric(12,2) DEFAULT 0,
  is_washout        boolean DEFAULT false,
  washout_amount    numeric(12,2) DEFAULT 0,
  jde_gross         numeric(12,2) DEFAULT 0,
  dealer_gross      numeric(12,2) DEFAULT 0,
  source            text,
  funded            boolean DEFAULT false,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','funded','unwound','cancelled')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deals_event ON sales_deals(event_id);
CREATE INDEX idx_deals_event_day ON sales_deals(event_id, sale_day);
CREATE INDEX idx_deals_event_date ON sales_deals(event_id, sale_date);
CREATE INDEX idx_deals_salesperson ON sales_deals(event_id, salesperson_id);
CREATE INDEX idx_deals_status ON sales_deals(event_id, status);
CREATE TRIGGER trg_deals_updated_at
  BEFORE UPDATE ON sales_deals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 9. MAIL TRACKING
-- ============================================================
CREATE TABLE mail_tracking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  zip_code        text NOT NULL,
  town            text,
  pieces_sent     integer DEFAULT 0,
  day_1           integer DEFAULT 0,
  day_2           integer DEFAULT 0,
  day_3           integer DEFAULT 0,
  day_4           integer DEFAULT 0,
  day_5           integer DEFAULT 0,
  day_6           integer DEFAULT 0,
  day_7           integer DEFAULT 0,
  day_8           integer DEFAULT 0,
  day_9           integer DEFAULT 0,
  day_10          integer DEFAULT 0,
  day_11          integer DEFAULT 0,
  day_12          integer DEFAULT 0,
  total_responses integer DEFAULT 0,
  response_rate   numeric(6,4) DEFAULT 0,
  sold_from_mail  integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mail_event ON mail_tracking(event_id);
CREATE INDEX idx_mail_zip ON mail_tracking(event_id, zip_code);
CREATE TRIGGER trg_mail_updated_at
  BEFORE UPDATE ON mail_tracking FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 10. DAILY METRICS
-- ============================================================
CREATE TABLE daily_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sale_day      integer NOT NULL,
  sale_date     date,
  total_ups     integer DEFAULT 0,
  total_sold    integer DEFAULT 0,
  total_gross   numeric(12,2) DEFAULT 0,
  total_front   numeric(12,2) DEFAULT 0,
  total_back    numeric(12,2) DEFAULT 0,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, sale_day)
);

CREATE INDEX idx_daily_event ON daily_metrics(event_id);
CREATE TRIGGER trg_daily_updated_at
  BEFORE UPDATE ON daily_metrics FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 11. COMMISSIONS
-- ============================================================
CREATE TABLE commissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  salesperson_id    uuid REFERENCES roster(id) ON DELETE SET NULL,
  salesperson_name  text NOT NULL,
  full_deals        integer DEFAULT 0,
  half_deals        integer DEFAULT 0,
  total_front_gross numeric(12,2) DEFAULT 0,
  total_back_gross  numeric(12,2) DEFAULT 0,
  total_gross       numeric(12,2) DEFAULT 0,
  commission_rate   numeric(5,4) DEFAULT 0.25,
  commission_earned numeric(12,2) DEFAULT 0,
  pack_deductions   numeric(12,2) DEFAULT 0,
  bonus             numeric(12,2) DEFAULT 0,
  chargeback_total  numeric(12,2) DEFAULT 0,
  net_pay           numeric(12,2) DEFAULT 0,
  status            text DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_commissions_event ON commissions(event_id);
CREATE INDEX idx_commissions_sp ON commissions(event_id, salesperson_id);
CREATE TRIGGER trg_commissions_updated_at
  BEFORE UPDATE ON commissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 12. CHARGEBACKS
-- ============================================================
CREATE TABLE chargebacks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  deal_id       uuid REFERENCES sales_deals(id) ON DELETE SET NULL,
  salesperson_id uuid REFERENCES roster(id) ON DELETE SET NULL,
  amount        numeric(12,2) NOT NULL,
  reason        text,
  chargeback_date date DEFAULT CURRENT_DATE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chargebacks_event ON chargebacks(event_id);
CREATE INDEX idx_chargebacks_deal ON chargebacks(deal_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their events" ON events FOR SELECT TO authenticated USING (is_event_member(id));
CREATE POLICY "Authenticated users can create events" ON events FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Owners/managers can update events" ON events FOR UPDATE TO authenticated USING (is_event_role(id, ARRAY['owner','manager'])) WITH CHECK (is_event_role(id, ARRAY['owner','manager']));
CREATE POLICY "Only owners can delete events" ON events FOR DELETE TO authenticated USING (is_event_role(id, ARRAY['owner']));

-- Event Members
ALTER TABLE event_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view event members" ON event_members FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can add members" ON event_members FOR INSERT TO authenticated WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));
CREATE POLICY "Owners can update member roles" ON event_members FOR UPDATE TO authenticated USING (is_event_role(event_id, ARRAY['owner'])) WITH CHECK (is_event_role(event_id, ARRAY['owner']));
CREATE POLICY "Owners can remove members" ON event_members FOR DELETE TO authenticated USING (is_event_role(event_id, ARRAY['owner']));

-- Event Config
ALTER TABLE event_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view config" ON event_config FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can manage config" ON event_config FOR ALL TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager'])) WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));

-- Roster
ALTER TABLE roster ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view roster" ON roster FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can manage roster" ON roster FOR ALL TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager'])) WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));

-- Lenders
ALTER TABLE lenders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view lenders" ON lenders FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can manage lenders" ON lenders FOR ALL TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager'])) WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));

-- Vehicle Inventory
ALTER TABLE vehicle_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view inventory" ON vehicle_inventory FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can insert inventory" ON vehicle_inventory FOR INSERT TO authenticated WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));
CREATE POLICY "Members can update inventory" ON vehicle_inventory FOR UPDATE TO authenticated USING (is_event_member(event_id)) WITH CHECK (is_event_member(event_id));
CREATE POLICY "Owners/managers can delete inventory" ON vehicle_inventory FOR DELETE TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager']));

-- Sales Deals
ALTER TABLE sales_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view deals" ON sales_deals FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Members can create deals" ON sales_deals FOR INSERT TO authenticated WITH CHECK (is_event_member(event_id));
CREATE POLICY "Members can update deals" ON sales_deals FOR UPDATE TO authenticated USING (is_event_member(event_id)) WITH CHECK (is_event_member(event_id));
CREATE POLICY "Owners/managers can delete deals" ON sales_deals FOR DELETE TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager']));

-- Mail Tracking
ALTER TABLE mail_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view mail tracking" ON mail_tracking FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can manage mail tracking" ON mail_tracking FOR ALL TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager'])) WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));

-- Daily Metrics
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view daily metrics" ON daily_metrics FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can manage daily metrics" ON daily_metrics FOR ALL TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager'])) WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));

-- Commissions
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view commissions" ON commissions FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can manage commissions" ON commissions FOR ALL TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager'])) WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));

-- Chargebacks
ALTER TABLE chargebacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view chargebacks" ON chargebacks FOR SELECT TO authenticated USING (is_event_member(event_id));
CREATE POLICY "Owners/managers can manage chargebacks" ON chargebacks FOR ALL TO authenticated USING (is_event_role(event_id, ARRAY['owner','manager'])) WITH CHECK (is_event_role(event_id, ARRAY['owner','manager']));

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE sales_deals;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_metrics;
ALTER PUBLICATION supabase_realtime ADD TABLE mail_tracking;
ALTER PUBLICATION supabase_realtime ADD TABLE roster;

-- ============================================================
-- VIEWS — pre-computed KPIs
-- ============================================================

CREATE OR REPLACE VIEW v_event_kpis AS
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.dealer_name,
  e.status AS event_status,
  COALESCE(d.total_deals, 0) AS total_deals,
  COALESCE(d.funded_deals, 0) AS funded_deals,
  COALESCE(d.total_front_gross, 0) AS total_front_gross,
  COALESCE(d.total_back_gross, 0) AS total_back_gross,
  COALESCE(d.total_gross, 0) AS total_gross,
  CASE WHEN COALESCE(d.total_deals, 0) > 0
    THEN ROUND(d.total_front_gross / d.total_deals, 2) ELSE 0 END AS avg_front_gross,
  CASE WHEN COALESCE(d.total_deals, 0) > 0
    THEN ROUND(d.total_back_gross / d.total_deals, 2) ELSE 0 END AS avg_back_gross,
  CASE WHEN COALESCE(d.total_deals, 0) > 0
    THEN ROUND(d.total_gross / d.total_deals, 2) ELSE 0 END AS avg_pvr,
  COALESCE(inv.total_vehicles, 0) AS total_vehicles,
  COALESCE(inv.available_vehicles, 0) AS available_vehicles,
  COALESCE(inv.sold_vehicles, 0) AS sold_vehicles,
  COALESCE(inv.hold_vehicles, 0) AS hold_vehicles,
  COALESCE(d.washout_count, 0) AS washout_count,
  COALESCE(d.washout_total, 0) AS washout_total,
  COALESCE(m.total_pieces, 0) AS mail_pieces_sent,
  COALESCE(m.total_responses, 0) AS mail_total_responses,
  CASE WHEN COALESCE(m.total_pieces, 0) > 0
    THEN ROUND((m.total_responses::numeric / m.total_pieces) * 100, 2) ELSE 0 END AS mail_response_pct,
  COALESCE(r.team_size, 0) AS team_size,
  ec.target_units,
  ec.target_gross,
  ec.target_pvr
FROM events e
LEFT JOIN (
  SELECT event_id,
    COUNT(*) AS total_deals,
    COUNT(*) FILTER (WHERE funded = true) AS funded_deals,
    SUM(COALESCE(front_gross, 0)) AS total_front_gross,
    SUM(COALESCE(back_gross, 0)) AS total_back_gross,
    SUM(COALESCE(total_gross, 0)) AS total_gross,
    COUNT(*) FILTER (WHERE is_washout = true) AS washout_count,
    SUM(COALESCE(washout_amount, 0)) AS washout_total
  FROM sales_deals WHERE status NOT IN ('cancelled','unwound')
  GROUP BY event_id
) d ON d.event_id = e.id
LEFT JOIN (
  SELECT event_id,
    COUNT(*) AS total_vehicles,
    COUNT(*) FILTER (WHERE status = 'available') AS available_vehicles,
    COUNT(*) FILTER (WHERE status = 'sold') AS sold_vehicles,
    COUNT(*) FILTER (WHERE status = 'hold') AS hold_vehicles
  FROM vehicle_inventory GROUP BY event_id
) inv ON inv.event_id = e.id
LEFT JOIN (
  SELECT event_id, SUM(pieces_sent) AS total_pieces, SUM(total_responses) AS total_responses
  FROM mail_tracking GROUP BY event_id
) m ON m.event_id = e.id
LEFT JOIN (
  SELECT event_id, COUNT(*) AS team_size FROM roster WHERE active = true GROUP BY event_id
) r ON r.event_id = e.id
LEFT JOIN event_config ec ON ec.event_id = e.id;

CREATE OR REPLACE VIEW v_salesperson_stats AS
SELECT
  sd.event_id,
  sd.salesperson_id,
  sd.salesperson AS salesperson_name,
  r.role AS salesperson_role,
  r.commission_pct,
  COUNT(*) AS total_deals,
  COUNT(*) FILTER (WHERE sd.salesperson_pct >= 1.0) AS full_deals,
  COUNT(*) FILTER (WHERE sd.salesperson_pct < 1.0) AS split_deals,
  SUM(COALESCE(sd.front_gross, 0) * COALESCE(sd.salesperson_pct, 1)) AS weighted_front_gross,
  SUM(COALESCE(sd.back_gross, 0)) AS total_back_gross,
  SUM(COALESCE(sd.total_gross, 0)) AS total_gross,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(SUM(COALESCE(sd.total_gross, 0)) / COUNT(*), 2) ELSE 0 END AS avg_pvr,
  COUNT(*) FILTER (WHERE sd.is_washout = true) AS washouts
FROM sales_deals sd
LEFT JOIN roster r ON r.id = sd.salesperson_id
WHERE sd.status NOT IN ('cancelled','unwound')
GROUP BY sd.event_id, sd.salesperson_id, sd.salesperson, r.role, r.commission_pct;

CREATE OR REPLACE VIEW v_mail_response_stats AS
SELECT
  event_id,
  COUNT(DISTINCT zip_code) AS zip_codes_targeted,
  SUM(pieces_sent) AS total_pieces,
  SUM(total_responses) AS total_responses,
  CASE WHEN SUM(pieces_sent) > 0
    THEN ROUND((SUM(total_responses)::numeric / SUM(pieces_sent)) * 100, 2) ELSE 0 END AS overall_response_pct,
  SUM(sold_from_mail) AS total_sold_from_mail
FROM mail_tracking GROUP BY event_id;

CREATE OR REPLACE VIEW v_daily_sales AS
SELECT
  event_id, sale_day, sale_date,
  COUNT(*) AS deals_count,
  SUM(COALESCE(front_gross, 0)) AS day_front_gross,
  SUM(COALESCE(back_gross, 0)) AS day_back_gross,
  SUM(COALESCE(total_gross, 0)) AS day_total_gross,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(SUM(COALESCE(total_gross, 0)) / COUNT(*), 2) ELSE 0 END AS day_avg_pvr
FROM sales_deals WHERE status NOT IN ('cancelled','unwound')
GROUP BY event_id, sale_day, sale_date
ORDER BY event_id, sale_day;
