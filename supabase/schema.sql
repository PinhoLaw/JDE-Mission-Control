-- ============================================================
-- JDE Mission Control — Supabase Schema
-- Run this in Supabase SQL Editor to bootstrap your database.
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. PROFILES (mirrors auth.users)
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. EVENTS (top-level entity, everything scopes to an event)
-- ============================================================
create type public.event_status as enum ('draft', 'active', 'completed', 'cancelled');

create table public.events (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  status      public.event_status not null default 'draft',
  location    text,
  start_date  date,
  end_date    date,
  budget      numeric(12,2),
  notes       text,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.events enable row level security;

-- ============================================================
-- 3. EVENT_MEMBERS (joins users to events for per-event isolation)
-- ============================================================
create type public.event_role as enum ('owner', 'manager', 'member', 'viewer');

create table public.event_members (
  id        uuid primary key default uuid_generate_v4(),
  event_id  uuid not null references public.events(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      public.event_role not null default 'member',
  joined_at timestamptz not null default now(),
  unique(event_id, user_id)
);

alter table public.event_members enable row level security;

-- Helper: check if user is a member of an event
create or replace function public.is_event_member(p_event_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.event_members
    where event_id = p_event_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- RLS for events: only members can see their events
create policy "Members can view their events"
  on public.events for select
  using (public.is_event_member(id));

create policy "Authenticated users can create events"
  on public.events for insert
  with check (auth.uid() = created_by);

create policy "Event owners/managers can update"
  on public.events for update
  using (
    exists (
      select 1 from public.event_members
      where event_id = id
        and user_id = auth.uid()
        and role in ('owner', 'manager')
    )
  );

-- RLS for event_members
create policy "Members can view event roster"
  on public.event_members for select
  using (public.is_event_member(event_id));

create policy "Owners/managers can manage members"
  on public.event_members for insert
  with check (
    exists (
      select 1 from public.event_members em
      where em.event_id = event_members.event_id
        and em.user_id = auth.uid()
        and em.role in ('owner', 'manager')
    )
    -- OR the user is creating their own membership (event creator)
    or auth.uid() = user_id
  );

create policy "Owners/managers can remove members"
  on public.event_members for delete
  using (
    exists (
      select 1 from public.event_members em
      where em.event_id = event_members.event_id
        and em.user_id = auth.uid()
        and em.role in ('owner', 'manager')
    )
  );

-- ============================================================
-- 4. INVENTORY (vehicles, equipment, swag per event)
-- ============================================================
create type public.inventory_category as enum ('vehicle', 'equipment', 'swag', 'signage', 'other');

create table public.inventory (
  id          uuid primary key default uuid_generate_v4(),
  event_id    uuid not null references public.events(id) on delete cascade,
  category    public.inventory_category not null default 'other',
  name        text not null,
  description text,
  quantity    integer not null default 1,
  unit_cost   numeric(10,2),
  status      text not null default 'available' check (status in ('available', 'in_use', 'reserved', 'damaged', 'retired')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.inventory enable row level security;

create policy "Members can view event inventory"
  on public.inventory for select
  using (public.is_event_member(event_id));

create policy "Members can manage inventory"
  on public.inventory for insert
  with check (public.is_event_member(event_id));

create policy "Members can update inventory"
  on public.inventory for update
  using (public.is_event_member(event_id));

create policy "Managers can delete inventory"
  on public.inventory for delete
  using (
    exists (
      select 1 from public.event_members
      where event_id = inventory.event_id
        and user_id = auth.uid()
        and role in ('owner', 'manager')
    )
  );

-- ============================================================
-- 5. DEALS (sponsorships, partnerships, vendor agreements)
-- ============================================================
create type public.deal_stage as enum ('lead', 'contacted', 'negotiating', 'committed', 'paid', 'lost');

create table public.deals (
  id            uuid primary key default uuid_generate_v4(),
  event_id      uuid not null references public.events(id) on delete cascade,
  company_name  text not null,
  contact_name  text,
  contact_email text,
  stage         public.deal_stage not null default 'lead',
  value         numeric(12,2),
  deal_type     text not null default 'sponsorship' check (deal_type in ('sponsorship', 'vendor', 'partnership', 'media', 'other')),
  notes         text,
  closed_at     timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.deals enable row level security;

create policy "Members can view event deals"
  on public.deals for select
  using (public.is_event_member(event_id));

create policy "Members can create deals"
  on public.deals for insert
  with check (public.is_event_member(event_id));

create policy "Members can update deals"
  on public.deals for update
  using (public.is_event_member(event_id));

create policy "Managers can delete deals"
  on public.deals for delete
  using (
    exists (
      select 1 from public.event_members
      where event_id = deals.event_id
        and user_id = auth.uid()
        and role in ('owner', 'manager')
    )
  );

-- ============================================================
-- 6. CAMPAIGNS (marketing campaigns tied to events)
-- ============================================================
create type public.campaign_status as enum ('draft', 'scheduled', 'active', 'paused', 'completed');
create type public.campaign_channel as enum ('email', 'social', 'paid_ads', 'sms', 'print', 'other');

create table public.campaigns (
  id          uuid primary key default uuid_generate_v4(),
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null,
  channel     public.campaign_channel not null default 'other',
  status      public.campaign_status not null default 'draft',
  budget      numeric(10,2),
  spend       numeric(10,2) default 0,
  impressions integer default 0,
  clicks      integer default 0,
  conversions integer default 0,
  start_date  date,
  end_date    date,
  notes       text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.campaigns enable row level security;

create policy "Members can view campaigns"
  on public.campaigns for select
  using (public.is_event_member(event_id));

create policy "Members can create campaigns"
  on public.campaigns for insert
  with check (public.is_event_member(event_id));

create policy "Members can update campaigns"
  on public.campaigns for update
  using (public.is_event_member(event_id));

create policy "Managers can delete campaigns"
  on public.campaigns for delete
  using (
    exists (
      select 1 from public.event_members
      where event_id = campaigns.event_id
        and user_id = auth.uid()
        and role in ('owner', 'manager')
    )
  );

-- ============================================================
-- 7. DAILY_LOG (day-of-event notes and metrics)
-- ============================================================
create table public.daily_log (
  id            uuid primary key default uuid_generate_v4(),
  event_id      uuid not null references public.events(id) on delete cascade,
  log_date      date not null,
  attendance    integer,
  revenue       numeric(12,2),
  expenses      numeric(12,2),
  weather       text,
  highlights    text,
  issues        text,
  notes         text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(event_id, log_date)
);

alter table public.daily_log enable row level security;

create policy "Members can view daily logs"
  on public.daily_log for select
  using (public.is_event_member(event_id));

create policy "Members can create daily logs"
  on public.daily_log for insert
  with check (public.is_event_member(event_id));

create policy "Members can update daily logs"
  on public.daily_log for update
  using (public.is_event_member(event_id));

-- ============================================================
-- 8. ROSTER (staff/volunteer schedule per event)
-- ============================================================
create type public.roster_role as enum ('lead', 'coordinator', 'staff', 'volunteer', 'vendor', 'security', 'medical');

create table public.roster (
  id          uuid primary key default uuid_generate_v4(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid references public.profiles(id),
  name        text not null,
  email       text,
  phone       text,
  role        public.roster_role not null default 'staff',
  shift_start timestamptz,
  shift_end   timestamptz,
  zone        text,
  checked_in  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.roster enable row level security;

create policy "Members can view roster"
  on public.roster for select
  using (public.is_event_member(event_id));

create policy "Members can manage roster"
  on public.roster for insert
  with check (public.is_event_member(event_id));

create policy "Members can update roster"
  on public.roster for update
  using (public.is_event_member(event_id));

create policy "Managers can delete roster entries"
  on public.roster for delete
  using (
    exists (
      select 1 from public.event_members
      where event_id = roster.event_id
        and user_id = auth.uid()
        and role in ('owner', 'manager')
    )
  );

-- ============================================================
-- 9. UPDATED_AT TRIGGER (auto-update timestamps)
-- ============================================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on public.profiles    for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.events      for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.inventory   for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.deals       for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.campaigns   for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.daily_log   for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.roster      for each row execute function public.update_updated_at();

-- ============================================================
-- 10. INDEXES
-- ============================================================
create index idx_event_members_event   on public.event_members(event_id);
create index idx_event_members_user    on public.event_members(user_id);
create index idx_inventory_event       on public.inventory(event_id);
create index idx_deals_event           on public.deals(event_id);
create index idx_campaigns_event       on public.campaigns(event_id);
create index idx_daily_log_event_date  on public.daily_log(event_id, log_date);
create index idx_roster_event          on public.roster(event_id);
create index idx_events_slug           on public.events(slug);
