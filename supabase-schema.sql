-- ============================================================
-- VillageMates — Supabase Schema
-- Run this in your Supabase SQL editor (supabase.com dashboard)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists families (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade unique,
  name          text not null,
  email         text not null unique,
  hours_balance numeric(6,1) not null default 10,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists invites (
  id          uuid primary key default uuid_generate_v4(),
  code        text not null unique,
  created_by  uuid references families(id) on delete set null,
  used_by     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);

create table if not exists requests (
  id                    uuid primary key default uuid_generate_v4(),
  requesting_family_id  uuid not null references families(id) on delete cascade,
  title                 text not null,
  notes                 text,
  date                  date not null,
  start_time            text not null,
  duration_hours        numeric(4,1) not null check (duration_hours > 0),
  status                text not null default 'open'
                          check (status in ('open', 'accepted', 'completed', 'cancelled')),
  fulfilling_family_id  uuid references families(id) on delete set null,
  created_at            timestamptz not null default now()
);

create table if not exists transactions (
  id               uuid primary key default uuid_generate_v4(),
  from_family_id   uuid references families(id) on delete set null,
  to_family_id     uuid references families(id) on delete set null,
  hours            numeric(4,1) not null,
  request_id       uuid references requests(id) on delete set null,
  note             text,
  created_at       timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_requests_status on requests(status);
create index if not exists idx_requests_family on requests(requesting_family_id);
create index if not exists idx_transactions_from on transactions(from_family_id);
create index if not exists idx_transactions_to on transactions(to_family_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table families    enable row level security;
alter table invites     enable row level security;
alter table requests    enable row level security;
alter table transactions enable row level security;

-- Helper: get calling family id
create or replace function current_family_id()
returns uuid language sql stable security definer as $$
  select id from families where user_id = auth.uid() limit 1;
$$;

-- Helper: is calling user admin
create or replace function is_admin()
returns boolean language sql stable security definer as $$
  select coalesce((select is_admin from families where user_id = auth.uid() limit 1), false);
$$;

-- Families: anyone authenticated can read; only own row or admin can update
drop policy if exists "families_select" on families;
drop policy if exists "families_insert" on families;
drop policy if exists "families_update" on families;
drop policy if exists "families_delete" on families;
create policy "families_select" on families for select to authenticated using (true);
create policy "families_insert" on families for insert to authenticated with check (user_id = auth.uid());
create policy "families_update" on families for update to authenticated
  using (user_id = auth.uid() or is_admin());
create policy "families_delete" on families for delete to authenticated using (is_admin());

-- Invites: admins manage; anyone authenticated can read to validate a code
drop policy if exists "invites_select" on invites;
drop policy if exists "invites_insert" on invites;
drop policy if exists "invites_update" on invites;
create policy "invites_select" on invites for select to authenticated using (true);
create policy "invites_insert" on invites for insert to authenticated with check (is_admin());
create policy "invites_update" on invites for update to authenticated using (true);

-- Requests: authenticated can read all; insert own; update own or admin
drop policy if exists "requests_select" on requests;
drop policy if exists "requests_insert" on requests;
drop policy if exists "requests_update" on requests;
create policy "requests_select" on requests for select to authenticated using (
  -- requester or fulfiller can always select
  requesting_family_id = current_family_id()
  or fulfilling_family_id = current_family_id()
  or target_household_id = current_family_id()
  or is_admin()
  -- or an accepted connection to the requester
  or exists (
    select 1 from connections c
    where c.status = 'accepted'
      and (
        (c.requester_id = requests.requesting_family_id and c.recipient_id = current_family_id())
        or (c.recipient_id = requests.requesting_family_id and c.requester_id = current_family_id())
      )
  )
);
create policy "requests_insert" on requests for insert to authenticated
  with check (requesting_family_id = current_family_id());
create policy "requests_update" on requests for update to authenticated
  using (requesting_family_id = current_family_id() or is_admin());

-- Transactions: authenticated can read own; only functions insert
drop policy if exists "transactions_select" on transactions;
create policy "transactions_select" on transactions for select to authenticated
  using (from_family_id = current_family_id() or to_family_id = current_family_id() or is_admin());

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- accept_request: atomically transfers hours and marks request accepted
create or replace function accept_request(
  p_request_id           uuid,
  p_fulfilling_family_id uuid
)
returns void language plpgsql security definer as $$
declare
  v_request         requests%rowtype;
  v_requester_bal   numeric;
  v_new_bal         numeric;
begin
  -- Lock and fetch the request
  select * into v_request from requests where id = p_request_id for update;

  if not found then
    raise exception 'Request not found';
  end if;

  if v_request.status <> 'open' then
    raise exception 'Request is no longer open';
  end if;

  if v_request.requesting_family_id = p_fulfilling_family_id then
    raise exception 'Cannot fulfill your own request';
  end if;

  -- Authorization: fulfiller must be the caller, an admin, the direct target, or an accepted connection
  if not (
    p_fulfilling_family_id = current_family_id()
    or is_admin()
    or v_request.target_household_id = p_fulfilling_family_id
    or exists (
      select 1 from connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = v_request.requesting_family_id and c.recipient_id = p_fulfilling_family_id)
          or (c.recipient_id = v_request.requesting_family_id and c.requester_id = p_fulfilling_family_id)
        )
    )
  ) then
    raise exception 'Not connected to requester or not authorized to accept this request';
  end if;

  -- Check requester won't go below -20
  select hours_balance into v_requester_bal
    from families where id = v_request.requesting_family_id for update;

  v_new_bal := v_requester_bal - v_request.duration_hours;
  if v_new_bal < -20 then
    raise exception 'Requester balance would drop below -20';
  end if;

  -- Deduct from requester
  update families
    set hours_balance = hours_balance - v_request.duration_hours
    where id = v_request.requesting_family_id;

  -- Add to fulfiller
  update families
    set hours_balance = hours_balance + v_request.duration_hours
    where id = p_fulfilling_family_id;

  -- Mark request accepted
  update requests
    set status = 'accepted', fulfilling_family_id = p_fulfilling_family_id
    where id = p_request_id;

  -- Record transaction
  insert into transactions (from_family_id, to_family_id, hours, request_id)
    values (v_request.requesting_family_id, p_fulfilling_family_id, v_request.duration_hours, p_request_id);
end;
$$;

-- admin_adjust_balance: admin manual balance correction
create or replace function admin_adjust_balance(
  p_family_id uuid,
  p_hours     numeric,
  p_note      text,
  p_admin_id  uuid
)
returns void language plpgsql security definer as $$
declare
  v_new_bal numeric;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;

  select hours_balance + p_hours into v_new_bal from families where id = p_family_id;

  if v_new_bal < -20 then
    raise exception 'Balance cannot go below -20';
  end if;

  update families set hours_balance = hours_balance + p_hours where id = p_family_id;

  insert into transactions (from_family_id, to_family_id, hours, note)
    values (
      case when p_hours < 0 then p_family_id else null end,
      case when p_hours > 0 then p_family_id else null end,
      abs(p_hours),
      coalesce(p_note, 'Admin adjustment')
    );
end;
$$;

-- ============================================================
-- CHAT TABLES
-- ============================================================

create table if not exists posts (
  id         uuid primary key default uuid_generate_v4(),
  family_id  uuid not null references families(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists direct_messages (
  id               uuid primary key default uuid_generate_v4(),
  from_family_id   uuid not null references families(id) on delete cascade,
  to_family_id     uuid not null references families(id) on delete cascade,
  body             text not null,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists mutes (
  family_id        uuid not null references families(id) on delete cascade,
  muted_family_id  uuid not null references families(id) on delete cascade,
  primary key (family_id, muted_family_id)
);

alter table posts            enable row level security;
alter table direct_messages  enable row level security;
alter table mutes            enable row level security;

create index if not exists idx_posts_family      on posts(family_id);
create index if not exists idx_posts_created     on posts(created_at desc);
create index if not exists idx_dm_to_family      on direct_messages(to_family_id);
create index if not exists idx_dm_from_family    on direct_messages(from_family_id);

drop policy if exists "posts_select"   on posts;
drop policy if exists "posts_insert"   on posts;
drop policy if exists "posts_delete"   on posts;
create policy "posts_select" on posts for select to authenticated using (true);
create policy "posts_insert" on posts for insert to authenticated with check (family_id = current_family_id());
create policy "posts_delete" on posts for delete to authenticated using (family_id = current_family_id() or is_admin());

drop policy if exists "dm_select" on direct_messages;
drop policy if exists "dm_insert" on direct_messages;
create policy "dm_select" on direct_messages for select to authenticated
  using (from_family_id = current_family_id() or to_family_id = current_family_id());
create policy "dm_insert" on direct_messages for insert to authenticated
  with check (from_family_id = current_family_id());

drop policy if exists "mutes_select" on mutes;
drop policy if exists "mutes_insert" on mutes;
drop policy if exists "mutes_delete" on mutes;
create policy "mutes_select" on mutes for select to authenticated using (family_id = current_family_id());
create policy "mutes_insert" on mutes for insert to authenticated with check (family_id = current_family_id());
create policy "mutes_delete" on mutes for delete to authenticated using (family_id = current_family_id());

-- ============================================================
-- MIGRATIONS (run these if schema was already set up)
-- alter table families add column if not exists push_token text;
-- alter table requests add column if not exists is_overnight boolean not null default false;
-- alter table families add column if not exists village_notifications text not null default 'all' check (village_notifications in ('all', 'mentions', 'muted'));

-- ============================================================
-- MIGRATION: Partner access + member directory (run in Supabase SQL editor)
-- ============================================================

-- 1. Add partner_user_id to families
alter table families add column if not exists partner_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists idx_families_partner_user on families(partner_user_id) where partner_user_id is not null;

-- 2. Add invite_type and family_id to invites
alter table invites add column if not exists invite_type text not null default 'new_family' check (invite_type in ('new_family', 'partner'));
alter table invites add column if not exists family_id uuid references families(id) on delete cascade;

-- 3. Update current_family_id() to recognize partners
create or replace function current_family_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    (select id from families where user_id = auth.uid() limit 1),
    (select id from families where partner_user_id = auth.uid() limit 1)
  );
$$;

-- 4. Allow partners to update the family profile
drop policy if exists "families_update" on families;
create policy "families_update" on families for update to authenticated
  using (user_id = auth.uid() or partner_user_id = auth.uid() or is_admin());

-- 5. Function to join an existing family as a partner
create or replace function join_as_partner(p_code text)
returns void language plpgsql security definer as $$
declare
  v_invite invites%rowtype;
begin
  select * into v_invite from invites
  where code = p_code and invite_type = 'partner' and used_by is null;

  if not found then
    raise exception 'Invalid or already used partner invite code';
  end if;

  if exists (
    select 1 from families
    where user_id = auth.uid() or partner_user_id = auth.uid()
  ) then
    raise exception 'You already belong to a family';
  end if;

  update families
  set partner_user_id = auth.uid()
  where id = v_invite.family_id;

  update invites
  set used_by = auth.uid(), used_at = now()
  where id = v_invite.id;
end;
$$;

-- 6. Allow any family member to create a partner invite for their own family
--    (previously only admins could insert invites)
drop policy if exists "invites_insert" on invites;
create policy "invites_insert" on invites for insert to authenticated
  with check (
    is_admin()
    or (
      invite_type = 'partner'
      and family_id = current_family_id()
      and created_by = current_family_id()
    )
  );

-- 7. Emoji reactions on village chat posts
create table if not exists post_reactions (
  id          uuid primary key default uuid_generate_v4(),
  post_id     uuid not null references posts(id) on delete cascade,
  family_id   uuid not null references families(id) on delete cascade,
  emoji       text not null check (emoji in ('👍', '❤️', '👎')),
  created_at  timestamptz not null default now(),
  unique (post_id, family_id, emoji)
);

alter table post_reactions enable row level security;

create index if not exists idx_reactions_post on post_reactions(post_id);

drop policy if exists "reactions_select" on post_reactions;
drop policy if exists "reactions_insert" on post_reactions;
drop policy if exists "reactions_delete" on post_reactions;
create policy "reactions_select" on post_reactions for select to authenticated using (true);
create policy "reactions_insert" on post_reactions for insert to authenticated
  with check (family_id = current_family_id());
create policy "reactions_delete" on post_reactions for delete to authenticated
  using (family_id = current_family_id());

-- 8a. Structured kids data (name + birthday per child, stored as JSON array)
alter table families add column if not exists kids_data jsonb;

-- 8b. Fix is_admin() so partner of an admin family also gets admin access
create or replace function is_admin()
returns boolean language sql stable security definer as $$
  select coalesce((
    select is_admin from families
    where user_id = auth.uid() or partner_user_id = auth.uid()
    limit 1
  ), false);
$$;

-- 9. Expand allowed reaction emojis (run this if you already ran step 7)
alter table post_reactions drop constraint if exists post_reactions_emoji_check;
alter table post_reactions add constraint post_reactions_emoji_check
  check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🔥', '👎'));

-- ============================================================
-- MIGRATION: Two-step offer/approval flow (run in Supabase SQL editor)
-- ============================================================

-- 12a. Add 'offered' to the status check constraint
alter table requests drop constraint if exists requests_status_check;
alter table requests add constraint requests_status_check
  check (status in ('open', 'offered', 'accepted', 'completed', 'cancelled'));

-- 12b. Offer to fulfill a request (no hour transfer yet)
create or replace function offer_request(p_request_id uuid, p_offering_family_id uuid)
returns void language plpgsql security definer as $$
declare v_request requests%rowtype;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'open' then raise exception 'Request is no longer open'; end if;
  if v_request.requesting_family_id = p_offering_family_id then
    raise exception 'Cannot offer to fulfill your own request';
  end if;

  -- Authorization: offering family must be caller, admin, direct target, or an accepted connection
  if not (
    p_offering_family_id = current_family_id()
    or is_admin()
    or v_request.target_household_id = p_offering_family_id
    or exists (
      select 1 from connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = v_request.requesting_family_id and c.recipient_id = p_offering_family_id)
          or (c.recipient_id = v_request.requesting_family_id and c.requester_id = p_offering_family_id)
        )
    )
  ) then
    raise exception 'Not connected to requester';
  end if;

  update requests
    set status = 'offered', fulfilling_family_id = p_offering_family_id
    where id = p_request_id;
end;
$$;

-- 12c. Requester approves the offer — transfers hours (replaces accept_request for new flow)
create or replace function approve_offer(p_request_id uuid, p_requester_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request  requests%rowtype;
  v_new_bal  numeric;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'offered' then raise exception 'No pending offer on this request'; end if;
  if v_request.requesting_family_id <> p_requester_family_id then
    raise exception 'Only the requester can approve';
  end if;

  -- Authorization: requester must be caller or admin
  if not (p_requester_family_id = current_family_id() or is_admin()) then
    raise exception 'Not authorized to approve this offer';
  end if;

  select hours_balance - v_request.duration_hours into v_new_bal
    from families where id = v_request.requesting_family_id for update;
  if v_new_bal < -20 then
    raise exception 'Balance would drop below -20';
  end if;

  update families set hours_balance = hours_balance - v_request.duration_hours
    where id = v_request.requesting_family_id;
  update families set hours_balance = hours_balance + v_request.duration_hours
    where id = v_request.fulfilling_family_id;
  update requests set status = 'accepted' where id = p_request_id;
  insert into transactions (from_family_id, to_family_id, hours, request_id)
    values (v_request.requesting_family_id, v_request.fulfilling_family_id,
            v_request.duration_hours, p_request_id);
end;
$$;

-- 12d. Decline or withdraw an offer — returns request to open
create or replace function retract_offer(p_request_id uuid)
returns void language plpgsql security definer as $$
declare v_request requests%rowtype;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'offered' then raise exception 'No pending offer to retract'; end if;
  -- Only the requester, the fulfiller, or an admin may retract/decline an offer
  if not (
    current_family_id() = v_request.requesting_family_id
    or current_family_id() = v_request.fulfilling_family_id
    or is_admin()
  ) then
    raise exception 'Not authorized to retract this offer';
  end if;

  update requests set status = 'open', fulfilling_family_id = null where id = p_request_id;
end;
$$;

-- ============================================================
-- MIGRATION: Request categories + Offerings (run in Supabase SQL editor)
-- ============================================================

-- 10. Add category column to requests
alter table requests add column if not exists category text not null default 'kid_sit'
  check (category in ('kid_sit', 'dog', 'manual_labor', 'professional', 'cooking'));

-- 11. Add category_details JSONB for category-specific data
--   kid_sit:      nothing extra (uses existing kid_name, is_overnight fields)
--   dog:          { dog_name: string, dog_task: 'walk' | 'sit' }
--   manual_labor: { labor_description: string, actual_hours: number }
--                 duration_hours stores the charged amount (actual_hours × 2)
--   professional: { service_type: string }
--   cooking:      { cooking_type: string }
alter table requests add column if not exists category_details jsonb;

-- 13. Add post_type: 'request' (I need help) or 'offering' (I can help)
--   For offerings, requesting_family_id = the helper who posted availability
--   fulfilling_family_id = the family that claimed the offering (needs help)
--   Hour transfer is reversed: claimer loses hours, poster gains hours
alter table requests add column if not exists post_type text not null default 'request'
  check (post_type in ('request', 'offering'));

-- 14. Services a family is open to providing (array of category keys)
alter table families add column if not exists services_offered jsonb;

-- 15. Approve a claim on an offering (reverse of approve_offer — claimer pays, poster earns)
create or replace function approve_offering_claim(p_request_id uuid, p_offering_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request  requests%rowtype;
  v_new_bal  numeric;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'offered' then raise exception 'No pending claim on this offering'; end if;
  if v_request.requesting_family_id <> p_offering_family_id then
    raise exception 'Only the offering family can approve';
  end if;

  -- Authorization: offering family must be the caller or admin
  if not (p_offering_family_id = current_family_id() or is_admin()) then
    raise exception 'Not authorized to approve this claim';
  end if;

  select hours_balance - v_request.duration_hours into v_new_bal
    from families where id = v_request.fulfilling_family_id for update;
  if v_new_bal < -20 then
    raise exception 'Claimer balance would drop below -20';
  end if;

  update families set hours_balance = hours_balance - v_request.duration_hours
    where id = v_request.fulfilling_family_id;
  update families set hours_balance = hours_balance + v_request.duration_hours
    where id = v_request.requesting_family_id;
  update requests set status = 'accepted' where id = p_request_id;
  insert into transactions (from_family_id, to_family_id, hours, request_id)
    values (v_request.fulfilling_family_id, v_request.requesting_family_id,
            v_request.duration_hours, p_request_id);
end;
$$;

-- ============================================================
-- MIGRATION: Open network — connections, new categories, direct requests
-- Run in Supabase SQL editor
-- ============================================================

-- 16. Connections between households (friend-request model)
create table if not exists connections (
  id            uuid primary key default uuid_generate_v4(),
  requester_id  uuid not null references families(id) on delete cascade,
  recipient_id  uuid not null references families(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined')),
  created_at    timestamptz not null default now(),
  unique (requester_id, recipient_id)
);

create index if not exists idx_connections_requester on connections(requester_id);
create index if not exists idx_connections_recipient on connections(recipient_id);

alter table connections enable row level security;

drop policy if exists "connections_select" on connections;
drop policy if exists "connections_insert" on connections;
drop policy if exists "connections_update" on connections;
drop policy if exists "connections_delete" on connections;

create policy "connections_select" on connections for select to authenticated
  using (requester_id = current_family_id() or recipient_id = current_family_id());
create policy "connections_insert" on connections for insert to authenticated
  with check (requester_id = current_family_id());
create policy "connections_update" on connections for update to authenticated
  using (requester_id = current_family_id() or recipient_id = current_family_id());
create policy "connections_delete" on connections for delete to authenticated
  using (requester_id = current_family_id() or recipient_id = current_family_id());

-- Helper: check if two households are connected (accepted)
create or replace function are_connected(a uuid, b uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from connections
    where status = 'accepted'
    and ((requester_id = a and recipient_id = b) or (requester_id = b and recipient_id = a))
  );
$$;

-- 17. Expand categories to include elder_care and physical_training
alter table requests drop constraint if exists requests_category_check;
alter table requests add constraint requests_category_check
  check (category in ('kid_sit', 'dog', 'manual_labor', 'professional', 'cooking', 'elder_care', 'physical_training'));

-- 18. Personal/direct requests: optional target household
alter table requests add column if not exists target_household_id uuid references families(id) on delete set null;
create index if not exists idx_requests_target on requests(target_household_id);

-- ============================================================
-- MIGRATION: Gift hours (peer-to-peer hour gifting)
-- Run in Supabase SQL editor
-- ============================================================

-- 19. Gift hours between households (no request required)
create or replace function gift_hours(
  p_recipient_id uuid,
  p_hours        numeric,
  p_note         text default null
)
returns void language plpgsql security definer as $$
declare
  v_gifter_id uuid;
  v_new_bal   numeric;
begin
  v_gifter_id := current_family_id();
  if v_gifter_id is null then raise exception 'Not authenticated'; end if;
  if p_recipient_id = v_gifter_id then raise exception 'Cannot gift hours to yourself'; end if;
  if p_hours <= 0 or p_hours > 100 then raise exception 'Hours must be between 0.5 and 100'; end if;

  select hours_balance - p_hours into v_new_bal
    from families where id = v_gifter_id for update;
  if v_new_bal < -20 then
    raise exception 'This gift would bring your balance below -20h';
  end if;

  update families set hours_balance = hours_balance - p_hours where id = v_gifter_id;
  update families set hours_balance = hours_balance + p_hours where id = p_recipient_id;

  insert into transactions (from_family_id, to_family_id, hours, note)
    values (v_gifter_id, p_recipient_id, p_hours, coalesce(nullif(trim(p_note), ''), 'Gift of hours'));
end;
$$;

-- ============================================================
-- MIGRATION: Network privacy — gate profile PII by connection
-- Run in Supabase SQL editor
-- ============================================================

-- 20. Public-safe view for browsing (name/animal only — no PII).
--     Used everywhere the app needs to list/identify households across
--     the whole network regardless of connection status (village chat,
--     @mentions, transaction history, "Find People" discovery tab).
create or replace view families_public as
  select id, name, animal, services_offered, hours_balance, is_admin, created_at
  from families;
grant select on families_public to authenticated;

-- 21. Restrict full family row (parent names/phone, kids info, address,
--     emergency contact, etc.) to: self, partner, admin, or a connected
--     household. Previously any authenticated user could read every
--     household's PII directly regardless of connection status.
drop policy if exists "families_select" on families;
create policy "families_select" on families for select to authenticated using (
  user_id = auth.uid()
  or partner_user_id = auth.uid()
  or is_admin()
  or are_connected(id, current_family_id())
);

-- 22. Invite codes should only be visible to the household that created
--     them (or admins) — previously any authenticated user could read
--     every partner invite code and join_as_partner() onto someone
--     else's household.
drop policy if exists "invites_select" on invites;
create policy "invites_select" on invites for select to authenticated using (
  created_by = current_family_id() or family_id = current_family_id() or is_admin()
);

-- 23. Prevent duplicate connection rows in either direction (A→B and
--     B→A both pending at once, which desynced the two sides' UI).
create unique index if not exists idx_connections_unique_pair
  on connections (least(requester_id, recipient_id), greatest(requester_id, recipient_id));

-- ============================================================
-- MIGRATION: Reconcile schema file with columns already live in
-- production (found via code that reads/writes them but had no
-- corresponding migration in this file). All idempotent — safe to run
-- whether or not the columns already exist.
-- ============================================================

-- 24. Profile fields used by profile.tsx / members.tsx / requests.tsx
alter table families add column if not exists phone text;
alter table families add column if not exists kids_info text;
alter table families add column if not exists animal text;
alter table families add column if not exists partner_push_token text;
alter table families add column if not exists parent1_name text;
alter table families add column if not exists parent1_phone text;
alter table families add column if not exists parent2_name text;
alter table families add column if not exists parent2_phone text;
alter table families add column if not exists address text;
alter table families add column if not exists emergency_contact text;

-- ============================================================
-- MIGRATION: cancel_accepted_request — close an authorization gap
--
-- This function already existed live (confirmed via pg_get_functiondef)
-- and its behavior is correct — this is NOT a rewrite. The only change:
-- the live version checked that p_family_id matched the request's
-- requester/fulfiller, but never checked that p_family_id was actually
-- the CALLER. Anyone could read a request's ids off the app and pass
-- either one as p_family_id to cancel/reverse a booking they're not
-- part of. Added a caller-identity check; note text, null-ing behavior,
-- and everything else preserved exactly as it was live.
-- ============================================================

-- 25. Cancel an accepted booking. Either the requester or the fulfiller
--     may call it. Requester cancelling closes the request entirely and
--     refunds the requester. Fulfiller backing out reopens the post for
--     someone else to pick up and still refunds the requester.
create or replace function cancel_accepted_request(p_request_id uuid, p_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request requests%rowtype;
begin
  select * into v_request from requests where id = p_request_id for update;

  if not found then
    raise exception 'Request not found';
  end if;

  if v_request.status <> 'accepted' then
    raise exception 'Request is not in accepted status';
  end if;

  if v_request.requesting_family_id <> p_family_id
     and v_request.fulfilling_family_id <> p_family_id then
    raise exception 'Not authorized to cancel this request';
  end if;

  -- NEW: p_family_id must actually be the caller (or an admin) —
  -- previously unchecked, allowing impersonation of either party.
  if not (p_family_id = current_family_id() or is_admin()) then
    raise exception 'Not authorized to cancel this request';
  end if;

  -- Return hours to requester, take back from fulfiller
  update families set hours_balance = hours_balance + v_request.duration_hours
    where id = v_request.requesting_family_id;
  update families set hours_balance = hours_balance - v_request.duration_hours
    where id = v_request.fulfilling_family_id;

  -- Record the reversal
  insert into transactions (from_family_id, to_family_id, hours, request_id, note)
    values (
      v_request.fulfilling_family_id,
      v_request.requesting_family_id,
      v_request.duration_hours,
      p_request_id,
      'Booking cancelled — hours returned'
    );

  -- Requester cancels → cancelled. Fulfiller backs out → reopen.
  if v_request.requesting_family_id = p_family_id then
    update requests set status = 'cancelled', fulfilling_family_id = null where id = p_request_id;
  else
    update requests set status = 'open', fulfilling_family_id = null where id = p_request_id;
  end if;
end;
$$;

-- ============================================================
-- MIGRATION: Soft-delete households (admin "Remove")
-- Previously the admin panel hard-deleted a family row, which cascaded
-- to permanently delete all of that household's requests and chat
-- posts (families.id references cascade on those tables). Switching to
-- a deactivation flag preserves history/ledger integrity.
-- ============================================================

-- 26. Add is_active flag; existing rows default to active
alter table families add column if not exists is_active boolean not null default true;

-- 27. Public directory view excludes deactivated households
create or replace view families_public as
  select id, name, animal, services_offered, hours_balance, is_admin, created_at
  from families
  where is_active;
grant select on families_public to authenticated;

-- ============================================================
-- MIGRATION: Deactivation actually locks the account out
--
-- Until now, is_active only hid a household from the public directory.
-- Everything else — reading full profiles you're connected to, posting
-- in chat, creating requests, gifting hours, all the RPCs — still
-- worked for a deactivated household because none of those checks
-- looked at is_active. This closes that: current_family_id() and
-- is_admin() now return nothing for a deactivated account, which
-- cascades through every policy/function that relies on them (nearly
-- all of them). Also blocks a deactivated user from flipping their own
-- is_active back on, and stops other people from still seeing/gifting/
-- messaging a deactivated household even if they were connected.
-- ============================================================

-- 28. current_family_id() / is_admin() ignore deactivated accounts
create or replace function current_family_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    (select id from families where user_id = auth.uid() and is_active limit 1),
    (select id from families where partner_user_id = auth.uid() and is_active limit 1)
  );
$$;

create or replace function is_admin()
returns boolean language sql stable security definer as $$
  select coalesce((
    select is_admin from families
    where (user_id = auth.uid() or partner_user_id = auth.uid()) and is_active
    limit 1
  ), false);
$$;

-- 29. A deactivated user can still read their OWN row (so the app can
--     show "you've been removed") but can no longer update it — closes
--     the hole where they could just set is_active back to true
--     themselves. Also: other people can no longer see a deactivated
--     household's full profile even via an existing connection.
drop policy if exists "families_update" on families;
create policy "families_update" on families for update to authenticated
  using ((user_id = auth.uid() or partner_user_id = auth.uid()) and is_active or is_admin());

drop policy if exists "families_select" on families;
create policy "families_select" on families for select to authenticated using (
  user_id = auth.uid()
  or partner_user_id = auth.uid()
  or is_admin()
  or (is_active and are_connected(id, current_family_id()))
);

-- 30. Village chat / reactions were readable by anyone authenticated —
--     now requires an active account (or admin).
drop policy if exists "posts_select" on posts;
create policy "posts_select" on posts for select to authenticated
  using (current_family_id() is not null or is_admin());

drop policy if exists "reactions_select" on post_reactions;
create policy "reactions_select" on post_reactions for select to authenticated
  using (current_family_id() is not null or is_admin());

-- 31. families_public directory itself now also requires an active caller
create or replace view families_public as
  select id, name, animal, services_offered, hours_balance, is_admin, created_at
  from families
  where is_active and (current_family_id() is not null or is_admin());
grant select on families_public to authenticated;

-- 32. gift_hours: can only gift what you actually have (no dipping into
--     the -20h line of credit like accepted/offered work can), must go
--     to a real, active, connected household, not just any id.
create or replace function gift_hours(
  p_recipient_id uuid,
  p_hours        numeric,
  p_note         text default null
)
returns void language plpgsql security definer as $$
declare
  v_gifter_id         uuid;
  v_new_bal           numeric;
  v_recipient_active  boolean;
begin
  v_gifter_id := current_family_id();
  if v_gifter_id is null then raise exception 'Not authenticated'; end if;
  if p_recipient_id = v_gifter_id then raise exception 'Cannot gift hours to yourself'; end if;
  if p_hours <= 0 or p_hours > 100 then raise exception 'Hours must be between 0.5 and 100'; end if;

  select is_active into v_recipient_active from families where id = p_recipient_id;
  if not found or not v_recipient_active then
    raise exception 'Recipient household not found';
  end if;

  if not (is_admin() or are_connected(p_recipient_id, v_gifter_id)) then
    raise exception 'You can only gift hours to a connected household';
  end if;

  select hours_balance - p_hours into v_new_bal
    from families where id = v_gifter_id for update;
  if v_new_bal < 0 then
    raise exception 'You can only gift hours you actually have';
  end if;

  update families set hours_balance = hours_balance - p_hours where id = v_gifter_id;
  update families set hours_balance = hours_balance + p_hours where id = p_recipient_id;

  insert into transactions (from_family_id, to_family_id, hours, note)
    values (v_gifter_id, p_recipient_id, p_hours, coalesce(nullif(trim(p_note), ''), 'Gift of hours'));
end;
$$;

-- ============================================================
-- MIGRATION: Errands category (app already builds this form, DB
-- constraint never caught up — submitting one threw a raw DB error)
-- Run in Supabase SQL editor
-- ============================================================
alter table requests drop constraint if exists requests_category_check;
alter table requests add constraint requests_category_check
  check (category in ('kid_sit', 'dog', 'manual_labor', 'professional', 'cooking', 'elder_care', 'physical_training', 'errands'));

-- ============================================================
-- MIGRATION: Connect codes + discoverability
-- Run in Supabase SQL editor
-- ============================================================

-- 33. Stable per-household connect code (share in person / via text to
--     instantly connect, no browsing required) and a directory opt-out.
alter table families add column if not exists connect_code text unique;
alter table families add column if not exists discoverable boolean not null default true;

update families set connect_code = upper(substr(md5(random()::text || id::text), 1, 6))
  where connect_code is null;

create or replace function set_connect_code()
returns trigger language plpgsql as $$
begin
  if new.connect_code is null then
    new.connect_code := upper(substr(md5(random()::text || new.id::text), 1, 6));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_connect_code on families;
create trigger trg_set_connect_code before insert on families
  for each row execute function set_connect_code();

-- 34. families_public gains discoverable so "Find People" can hide
--     opted-out households from search/browse without affecting their
--     visibility in "My Network" (that list comes from an existing
--     connection, not this view's filter).
create or replace view families_public as
  select id, name, animal, services_offered, hours_balance, is_admin, created_at, discoverable
  from families
  where is_active and (current_family_id() is not null or is_admin());
grant select on families_public to authenticated;

-- 35. connect_by_code: look up a household by its code and instantly
--     create an accepted connection. Security definer because the
--     caller has no select access to another household's row until
--     connected — this is the one sanctioned way to bypass that, gated
--     on knowing the exact code (shared in person / by text), not on
--     browsing.
create or replace function connect_by_code(p_code text)
returns table(id uuid, name text, animal text) language plpgsql security definer as $$
declare
  v_me     uuid;
  v_target families%rowtype;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;

  select * into v_target from families
    where connect_code = upper(trim(p_code)) and is_active;
  if not found then raise exception 'Invalid code'; end if;
  if v_target.id = v_me then raise exception 'That is your own code'; end if;

  if exists (
    select 1 from connections
    where (requester_id = v_me and recipient_id = v_target.id)
       or (requester_id = v_target.id and recipient_id = v_me)
  ) then
    update connections set status = 'accepted'
      where (requester_id = v_me and recipient_id = v_target.id)
         or (requester_id = v_target.id and recipient_id = v_me);
  else
    insert into connections (requester_id, recipient_id, status)
      values (v_me, v_target.id, 'accepted');
  end if;

  return query select v_target.id, v_target.name, v_target.animal;
end;
$$;

-- ============================================================
-- MIGRATION: Rate-limit connect_by_code
-- Run in Supabase SQL editor
-- ============================================================

-- 37. Cap connect-code guesses per household to slow down brute-forcing
--     the 6-char code space. Logs every attempt (success or not); a
--     household gets locked out for the rest of the window once it hits
--     the cap, not just once it starts failing, so legitimate rapid
--     retries don't extend the runway for a guesser.
create table if not exists connect_code_attempts (
  id          uuid primary key default uuid_generate_v4(),
  family_id   uuid not null references families(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_connect_attempts_family_time on connect_code_attempts(family_id, attempted_at);
alter table connect_code_attempts enable row level security;
-- No select/insert policies granted — only the security-definer function below touches this table.

create or replace function connect_by_code(p_code text)
returns table(id uuid, name text, animal text) language plpgsql security definer as $$
declare
  v_me             uuid;
  v_target         families%rowtype;
  v_recent_attempts int;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;

  select count(*) into v_recent_attempts
    from connect_code_attempts
    where family_id = v_me and attempted_at > now() - interval '15 minutes';
  if v_recent_attempts >= 10 then
    raise exception 'Too many attempts. Please wait a few minutes and try again.';
  end if;

  insert into connect_code_attempts (family_id) values (v_me);

  select * into v_target from families
    where connect_code = upper(trim(p_code)) and is_active;
  if not found then raise exception 'Invalid code'; end if;
  if v_target.id = v_me then raise exception 'That is your own code'; end if;

  if exists (
    select 1 from connections
    where (requester_id = v_me and recipient_id = v_target.id)
       or (requester_id = v_target.id and recipient_id = v_me)
  ) then
    update connections set status = 'accepted'
      where (requester_id = v_me and recipient_id = v_target.id)
         or (requester_id = v_target.id and recipient_id = v_me);
  else
    insert into connections (requester_id, recipient_id, status)
      values (v_me, v_target.id, 'accepted');
  end if;

  return query select v_target.id, v_target.name, v_target.animal;
end;
$$;

-- ============================================================
-- MIGRATION: Self-service account deletion
-- Run in Supabase SQL editor
-- ============================================================

-- 36. App Store / Play Store require in-app account deletion, not just
--     admin-initiated removal (admin.tsx already has that). A household
--     is shared by up to two auth users (owner + partner), so "delete my
--     account" means different things depending on who's asking:
--     the owner deleting takes the whole household down (same PII scrub
--     as admin removal, so other households' shared history stays
--     intact); a partner deleting just unlinks themselves and leaves the
--     household — and the owner — untouched.
create or replace function delete_own_account()
returns void language plpgsql security definer as $$
declare
  v_family_id uuid;
  v_is_partner boolean;
begin
  select id, (partner_user_id = auth.uid()) into v_family_id, v_is_partner
    from families
    where (user_id = auth.uid() or partner_user_id = auth.uid()) and is_active
    limit 1;

  if v_family_id is null then raise exception 'Not authenticated'; end if;

  if v_is_partner then
    update families set partner_user_id = null, partner_push_token = null
      where id = v_family_id;
  else
    update families set
      is_active = false,
      discoverable = false,
      parent1_name = null,
      parent1_phone = null,
      parent2_name = null,
      parent2_phone = null,
      address = null,
      emergency_contact = null,
      kids_info = null,
      kids_data = null,
      push_token = null,
      partner_push_token = null,
      connect_code = null
    where id = v_family_id;
  end if;
end;
$$;

-- ============================================================
-- MIGRATION: Allow deleting your own never-accepted posts
-- Run in Supabase SQL editor
-- ============================================================

-- 38. requests had no delete policy at all, so "Cancel Request" on an
--     open (unaccepted) post could only soft-mark it 'cancelled' —
--     it kept cluttering "My Requests" despite the app telling the user
--     it would "remove the post from the board". Only lets you delete
--     your own posts while still 'open': once something's been offered,
--     accepted, or completed there's a transaction/history tied to it,
--     so that path stays a status change (cancel_accepted_request), not
--     a delete.
drop policy if exists "requests_delete" on requests;
create policy "requests_delete" on requests for delete to authenticated using (
  requesting_family_id = current_family_id() and status = 'open'
);

-- ============================================================
-- MIGRATION: DMs require an accepted connection
-- Run in Supabase SQL editor
-- ============================================================

-- 39. dm_insert had no connection check at all — anyone authenticated
--     could message any household directly regardless of connection
--     status, the UI just didn't happen to offer a button for it. This
--     closes the actual gap, not just the button.
drop policy if exists "dm_insert" on direct_messages;
create policy "dm_insert" on direct_messages for insert to authenticated
  with check (from_family_id = current_family_id() and (are_connected(from_family_id, to_family_id) or is_admin()));

-- ============================================================
-- MIGRATION: One-week-out reminder for unanswered requests
-- Run in Supabase SQL editor
-- ============================================================

-- 40. If a request is still 'open' exactly a week before it's needed,
--     nudge the requester — this has to run server-side (pg_cron), not
--     from the app, since it must fire whether or not anyone has the
--     app open that day. Uses pg_net to call Expo's push API directly
--     from Postgres. If the create extension lines below fail with a
--     permissions error, enable "pg_cron" and "pg_net" first via the
--     Supabase dashboard: Database -> Extensions -> toggle both on,
--     then re-run just this block.
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table requests add column if not exists reminder_sent boolean not null default false;

create or replace function send_request_reminders()
returns void language plpgsql security definer as $$
declare
  v_messages jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select req.id, req.title, f.push_token, f.partner_push_token
    from requests req
    join families f on f.id = req.requesting_family_id
    where req.post_type = 'request'
      and req.status = 'open'
      and req.reminder_sent = false
      and req.date = (current_date + 7)
  loop
    if r.push_token like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', r.push_token,
        'title', '⏰ Still looking for help',
        'body', format('No one has accepted your request "%s" yet — it''s scheduled in a week. Consider sending a personal message or finding an alternative.', r.title),
        'sound', 'default'
      );
    end if;
    if r.partner_push_token like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', r.partner_push_token,
        'title', '⏰ Still looking for help',
        'body', format('No one has accepted your request "%s" yet — it''s scheduled in a week. Consider sending a personal message or finding an alternative.', r.title),
        'sound', 'default'
      );
    end if;
    update requests set reminder_sent = true where id = r.id;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;

select cron.schedule('request-reminders-daily', '0 15 * * *', $$select send_request_reminders();$$);

-- ============================================================
-- MIGRATION: Report and block households
-- Run in Supabase SQL editor
-- ============================================================

-- 41. Blocking: one-way, only the blocker can see their own block list
--     (the blocked household is never told). Enforced at the RLS layer
--     on the actual interaction points — DMs and new connection
--     requests — not just hidden in the UI.
create table if not exists blocks (
  id          uuid primary key default uuid_generate_v4(),
  blocker_id  uuid not null references families(id) on delete cascade,
  blocked_id  uuid not null references families(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);
alter table blocks enable row level security;
drop policy if exists "blocks_select" on blocks;
drop policy if exists "blocks_insert" on blocks;
drop policy if exists "blocks_delete" on blocks;
create policy "blocks_select" on blocks for select to authenticated using (blocker_id = current_family_id());
create policy "blocks_insert" on blocks for insert to authenticated with check (blocker_id = current_family_id());
create policy "blocks_delete" on blocks for delete to authenticated using (blocker_id = current_family_id());

create or replace function is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- 42. Blocking a household also removes any existing connection and
--     cancels any pending request either direction, so it actually
--     severs contact rather than just adding a label.
create or replace function block_household(p_blocked_id uuid)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_blocked_id = v_me then raise exception 'Cannot block yourself'; end if;

  insert into blocks (blocker_id, blocked_id) values (v_me, p_blocked_id)
    on conflict (blocker_id, blocked_id) do nothing;

  delete from connections
    where (requester_id = v_me and recipient_id = p_blocked_id)
       or (requester_id = p_blocked_id and recipient_id = v_me);
end;
$$;

-- 43. Stop blocked households from reaching each other via DM or a new
--     connection request. Existing are_connected()-gated checks stay;
--     this adds the block check alongside them.
drop policy if exists "dm_insert" on direct_messages;
create policy "dm_insert" on direct_messages for insert to authenticated
  with check (
    from_family_id = current_family_id()
    and (are_connected(from_family_id, to_family_id) or is_admin())
    and not is_blocked(from_family_id, to_family_id)
  );

drop policy if exists "connections_insert" on connections;
create policy "connections_insert" on connections for insert to authenticated
  with check (requester_id = current_family_id() and not is_blocked(requester_id, recipient_id));

-- 44. connect_by_code should also refuse to connect blocked households.
create or replace function connect_by_code(p_code text)
returns table(id uuid, name text, animal text) language plpgsql security definer as $$
declare
  v_me             uuid;
  v_target         families%rowtype;
  v_recent_attempts int;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;

  select count(*) into v_recent_attempts
    from connect_code_attempts
    where family_id = v_me and attempted_at > now() - interval '15 minutes';
  if v_recent_attempts >= 10 then
    raise exception 'Too many attempts. Please wait a few minutes and try again.';
  end if;

  insert into connect_code_attempts (family_id) values (v_me);

  select * into v_target from families
    where connect_code = upper(trim(p_code)) and is_active;
  if not found then raise exception 'Invalid code'; end if;
  if v_target.id = v_me then raise exception 'That is your own code'; end if;
  if is_blocked(v_me, v_target.id) then raise exception 'Invalid code'; end if;

  if exists (
    select 1 from connections
    where (requester_id = v_me and recipient_id = v_target.id)
       or (requester_id = v_target.id and recipient_id = v_me)
  ) then
    update connections set status = 'accepted'
      where (requester_id = v_me and recipient_id = v_target.id)
         or (requester_id = v_target.id and recipient_id = v_me);
  else
    insert into connections (requester_id, recipient_id, status)
      values (v_me, v_target.id, 'accepted');
  end if;

  return query select v_target.id, v_target.name, v_target.animal;
end;
$$;

-- 45. Reports: reporter and admins can see them; only admins can
--     update status (mark reviewed/dismissed).
create table if not exists reports (
  id           uuid primary key default uuid_generate_v4(),
  reporter_id  uuid not null references families(id) on delete cascade,
  reported_id  uuid not null references families(id) on delete cascade,
  reason       text not null,
  note         text,
  status       text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at   timestamptz not null default now()
);
alter table reports enable row level security;
drop policy if exists "reports_select" on reports;
drop policy if exists "reports_insert" on reports;
drop policy if exists "reports_update" on reports;
create policy "reports_select" on reports for select to authenticated using (reporter_id = current_family_id() or is_admin());
create policy "reports_insert" on reports for insert to authenticated with check (reporter_id = current_family_id());
create policy "reports_update" on reports for update to authenticated using (is_admin());

-- ============================================================
-- MIGRATION: Let the helper mark a request completed too
-- Run in Supabase SQL editor
-- ============================================================

-- 46. "Mark as Completed" shows for both the requester and the helper
--     (requests.tsx), but requests_update only ever allowed the
--     requester — the helper's tap silently failed at the database
--     while the app went on to notify everyone it worked. Extends
--     update rights to the fulfiller too, same trust model already
--     granted to the requester (whole-row RLS, client sends only the
--     fields it means to change).
drop policy if exists "requests_update" on requests;
create policy "requests_update" on requests for update to authenticated
  using (requesting_family_id = current_family_id() or fulfilling_family_id = current_family_id() or is_admin());

-- ============================================================
-- MIGRATION: Push tokens for admin notifications
-- Run in Supabase SQL editor
-- ============================================================

-- 47. A report's reporter usually isn't connected to (or admin
--     themselves) the admin household, so a plain `families` select for
--     admin push tokens would come back empty under RLS. Security
--     definer so it always resolves, regardless of who's asking —
--     returns only push tokens, nothing else.
create or replace function get_admin_push_tokens()
returns table(push_token text, partner_push_token text)
language sql stable security definer as $$
  select push_token, partner_push_token from families where is_admin and is_active;
$$;

-- ============================================================
-- MIGRATION: Also allow all 7 reaction emoji in DMs
-- Run in Supabase SQL editor
-- ============================================================

-- 48. Village Chat's post_reactions already allows all 7; if this
--     wasn't run before now, reacting with anything past 👍❤️👎 would
--     have silently failed on a stale 3-emoji check constraint.
alter table post_reactions drop constraint if exists post_reactions_emoji_check;
alter table post_reactions add constraint post_reactions_emoji_check
  check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🔥', '👎'));

-- 49. DMs never had reactions at all — new table, same shape as
--     post_reactions. Scoped to the two people actually in the thread
--     (checked via direct_messages, not open to anyone authenticated).
create table if not exists dm_reactions (
  id          uuid primary key default uuid_generate_v4(),
  message_id  uuid not null references direct_messages(id) on delete cascade,
  family_id   uuid not null references families(id) on delete cascade,
  emoji       text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🔥', '👎')),
  created_at  timestamptz not null default now(),
  unique (message_id, family_id, emoji)
);
alter table dm_reactions enable row level security;
create index if not exists idx_dm_reactions_message on dm_reactions(message_id);

drop policy if exists "dm_reactions_select" on dm_reactions;
drop policy if exists "dm_reactions_insert" on dm_reactions;
drop policy if exists "dm_reactions_delete" on dm_reactions;
create policy "dm_reactions_select" on dm_reactions for select to authenticated using (
  exists (
    select 1 from direct_messages dm where dm.id = message_id
    and (dm.from_family_id = current_family_id() or dm.to_family_id = current_family_id())
  )
);
create policy "dm_reactions_insert" on dm_reactions for insert to authenticated with check (
  family_id = current_family_id()
  and exists (
    select 1 from direct_messages dm where dm.id = message_id
    and (dm.from_family_id = current_family_id() or dm.to_family_id = current_family_id())
  )
);
create policy "dm_reactions_delete" on dm_reactions for delete to authenticated using (family_id = current_family_id());

-- 50. Delete-your-own-message for DMs, matching posts_delete's pattern
--     (Village Chat already lets you delete your own post).
drop policy if exists "dm_delete" on direct_messages;
create policy "dm_delete" on direct_messages for delete to authenticated
  using (from_family_id = current_family_id() or is_admin());

-- 51. Per-thread DM mute reuses the same `mutes` table Village Chat
--     already uses (muting a household is one concept, not a separate
--     one per screen). Sender can't read the recipient's mute list
--     directly (mutes_select is locked to your own rows, so people
--     can't tell they've been muted) — this lets the sender check
--     "would this push actually be wanted" without exposing that.
create or replace function is_muted_by(p_family_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from mutes where family_id = p_family_id and muted_family_id = current_family_id()
  );
$$;

-- 52. connections_update let the REQUESTER accept their own outgoing
--     pending request (it only checked "am I either party"), so a
--     household could self-grant 'accepted' status without the other
--     side ever consenting — silently unlocking DMs, offer/accept
--     eligibility, and full PII via that connection. Only the
--     recipient may transition a connection's status.
drop policy if exists "connections_update" on connections;
create policy "connections_update" on connections for update to authenticated
  using (recipient_id = current_family_id())
  with check (recipient_id = current_family_id());

-- ============================================================
-- MIGRATION: Deferred settlement — hours transfer on the scheduled date,
-- not at accept/approve time, with a reversal window.
-- Run in Supabase SQL editor
-- ============================================================

-- 53. Previously accept_request/approve_offer/approve_offering_claim moved
--     hours immediately on approval — days or weeks before the task
--     actually happened, and with no way to walk it back except the blunt
--     "cancel accepted request" path. Hours now only move when
--     auto_settle_requests() (cron, below) sees the scheduled date has
--     passed, and the payer can reverse a bad settlement afterward.
alter table requests add column if not exists settled_at timestamptz;
alter table requests add column if not exists reversed_at timestamptz;

-- pending_hours_delta: net hours a household stands to gain/lose across
-- everything it has outstanding — open/offered posts plus accepted-but-
-- not-yet-settled ones. hours_balance + this = "if it all resolves".
-- Used both by the app (new-request pre-check) and server-side floor
-- checks below, so the two can't drift.
create or replace function pending_hours_delta(p_family_id uuid)
returns numeric language sql stable security definer as $$
  select coalesce(sum(
    case
      when post_type = 'request'  and requesting_family_id = p_family_id then -duration_hours
      when post_type = 'request'  and fulfilling_family_id = p_family_id then duration_hours
      when post_type = 'offering' and requesting_family_id = p_family_id then duration_hours
      when post_type = 'offering' and fulfilling_family_id = p_family_id then -duration_hours
      else 0
    end
  ), 0)
  from requests
  where (requesting_family_id = p_family_id or fulfilling_family_id = p_family_id)
    and (status in ('open', 'offered') or (status = 'accepted' and settled_at is null));
$$;

create or replace function accept_request(
  p_request_id           uuid,
  p_fulfilling_family_id uuid
)
returns void language plpgsql security definer as $$
declare
  v_request    requests%rowtype;
  v_projected  numeric;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'open' then raise exception 'Request is no longer open'; end if;
  if v_request.requesting_family_id = p_fulfilling_family_id then
    raise exception 'Cannot fulfill your own request';
  end if;

  if not (
    p_fulfilling_family_id = current_family_id()
    or is_admin()
    or v_request.target_household_id = p_fulfilling_family_id
    or exists (
      select 1 from connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = v_request.requesting_family_id and c.recipient_id = p_fulfilling_family_id)
          or (c.recipient_id = v_request.requesting_family_id and c.requester_id = p_fulfilling_family_id)
        )
    )
  ) then
    raise exception 'Not connected to requester or not authorized to accept this request';
  end if;

  -- This row is already counted in pending_hours_delta (status = 'open'),
  -- so no need to subtract duration_hours again here.
  select hours_balance + pending_hours_delta(v_request.requesting_family_id) into v_projected
    from families where id = v_request.requesting_family_id for update;
  if v_projected < -20 then
    raise exception 'Requester balance would drop below -20 once outstanding commitments settle';
  end if;

  update requests
    set status = 'accepted', fulfilling_family_id = p_fulfilling_family_id
    where id = p_request_id;
end;
$$;

create or replace function offer_request(p_request_id uuid, p_offering_family_id uuid)
returns void language plpgsql security definer as $$
declare v_request requests%rowtype;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'open' then raise exception 'Request is no longer open'; end if;
  if v_request.requesting_family_id = p_offering_family_id then
    raise exception 'Cannot offer to fulfill your own request';
  end if;

  if not (
    p_offering_family_id = current_family_id()
    or is_admin()
    or v_request.target_household_id = p_offering_family_id
    or exists (
      select 1 from connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = v_request.requesting_family_id and c.recipient_id = p_offering_family_id)
          or (c.recipient_id = v_request.requesting_family_id and c.requester_id = p_offering_family_id)
        )
    )
  ) then
    raise exception 'Not connected to requester';
  end if;

  update requests
    set status = 'offered', fulfilling_family_id = p_offering_family_id
    where id = p_request_id;
end;
$$;

create or replace function approve_offer(p_request_id uuid, p_requester_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request    requests%rowtype;
  v_projected  numeric;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'offered' then raise exception 'No pending offer on this request'; end if;
  if v_request.requesting_family_id <> p_requester_family_id then
    raise exception 'Only the requester can approve';
  end if;
  if not (p_requester_family_id = current_family_id() or is_admin()) then
    raise exception 'Not authorized to approve this offer';
  end if;

  -- Already counted (status = 'offered') — approving just moves it from
  -- "offered" to "accepted", both pending buckets, so total is unchanged.
  select hours_balance + pending_hours_delta(v_request.requesting_family_id) into v_projected
    from families where id = v_request.requesting_family_id for update;
  if v_projected < -20 then
    raise exception 'Balance would drop below -20 once outstanding commitments settle';
  end if;

  update requests set status = 'accepted' where id = p_request_id;
end;
$$;

create or replace function approve_offering_claim(p_request_id uuid, p_offering_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request    requests%rowtype;
  v_projected  numeric;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'offered' then raise exception 'No pending claim on this offering'; end if;
  if v_request.requesting_family_id <> p_offering_family_id then
    raise exception 'Only the offering family can approve';
  end if;
  if not (p_offering_family_id = current_family_id() or is_admin()) then
    raise exception 'Not authorized to approve this claim';
  end if;

  select hours_balance + pending_hours_delta(v_request.fulfilling_family_id) into v_projected
    from families where id = v_request.fulfilling_family_id for update;
  if v_projected < -20 then
    raise exception 'Claimer balance would drop below -20 once outstanding commitments settle';
  end if;

  update requests set status = 'accepted' where id = p_request_id;
end;
$$;

-- Cancelling an accepted-but-not-yet-settled request has nothing to
-- reverse (hours never moved) — just releases the commitment. Only
-- unwind balances if settlement already happened. Also fixes a
-- pre-existing bug: this always reversed requester+/fulfiller-,
-- backwards for post_type = 'offering'.
create or replace function cancel_accepted_request(p_request_id uuid, p_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request requests%rowtype;
  v_from    uuid;
  v_to      uuid;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'accepted' then raise exception 'Request is not in accepted status'; end if;

  if v_request.requesting_family_id <> p_family_id
     and v_request.fulfilling_family_id <> p_family_id then
    raise exception 'Not authorized to cancel this request';
  end if;
  if not (p_family_id = current_family_id() or is_admin()) then
    raise exception 'Not authorized to cancel this request';
  end if;

  if v_request.settled_at is not null then
    if v_request.post_type = 'request' then
      v_from := v_request.requesting_family_id; v_to := v_request.fulfilling_family_id;
    else
      v_from := v_request.fulfilling_family_id; v_to := v_request.requesting_family_id;
    end if;
    update families set hours_balance = hours_balance + v_request.duration_hours where id = v_from;
    update families set hours_balance = hours_balance - v_request.duration_hours where id = v_to;
    insert into transactions (from_family_id, to_family_id, hours, request_id, note)
      values (v_to, v_from, v_request.duration_hours, p_request_id, 'Booking cancelled — hours returned');
  end if;

  if v_request.requesting_family_id = p_family_id then
    update requests set status = 'cancelled', fulfilling_family_id = null where id = p_request_id;
  else
    update requests set status = 'open', fulfilling_family_id = null where id = p_request_id;
  end if;
end;
$$;

-- 54. settle_request: the actual hour transfer, called only by
--     auto_settle_requests() below (or manually by an admin).
create or replace function settle_request(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request requests%rowtype;
  v_from    uuid;
  v_to      uuid;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'accepted' then raise exception 'Request is not in an accepted state'; end if;
  if v_request.settled_at is not null then raise exception 'Already settled'; end if;
  if not is_admin() and current_family_id() is not null
     and current_family_id() <> v_request.requesting_family_id
     and current_family_id() <> v_request.fulfilling_family_id then
    raise exception 'Not authorized to settle this request';
  end if;

  if v_request.post_type = 'request' then
    v_from := v_request.requesting_family_id; v_to := v_request.fulfilling_family_id;
  else
    v_from := v_request.fulfilling_family_id; v_to := v_request.requesting_family_id;
  end if;

  update families set hours_balance = hours_balance - v_request.duration_hours where id = v_from;
  update families set hours_balance = hours_balance + v_request.duration_hours where id = v_to;
  update requests set settled_at = now() where id = p_request_id;
  insert into transactions (from_family_id, to_family_id, hours, request_id, note)
    values (v_from, v_to, v_request.duration_hours, p_request_id, 'Auto-settled on scheduled date');
end;
$$;

-- 55. reverse_settlement: only the household that got charged can walk
--     back a settlement that turned out not to have happened.
create or replace function reverse_settlement(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request requests%rowtype;
  v_from    uuid;
  v_to      uuid;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.settled_at is null then raise exception 'Not settled yet'; end if;
  if v_request.reversed_at is not null then raise exception 'Already reversed'; end if;

  if v_request.post_type = 'request' then
    v_from := v_request.requesting_family_id; v_to := v_request.fulfilling_family_id;
  else
    v_from := v_request.fulfilling_family_id; v_to := v_request.requesting_family_id;
  end if;

  if not (current_family_id() = v_from or is_admin()) then
    raise exception 'Only the household that was charged can reverse this';
  end if;

  update families set hours_balance = hours_balance + v_request.duration_hours where id = v_from;
  update families set hours_balance = hours_balance - v_request.duration_hours where id = v_to;
  update requests set reversed_at = now(), status = 'cancelled' where id = p_request_id;
  insert into transactions (from_family_id, to_family_id, hours, request_id, note)
    values (v_to, v_from, v_request.duration_hours, p_request_id, 'Reversed settlement — did not happen');
end;
$$;

-- 56. Daily settlement sweep, same pg_cron/pg_net pattern as the
--     one-week reminder job above. Time-of-day isn't reliably parseable
--     (start_time/end_time are free-form display strings, not a time
--     type), so this settles at the day level: the morning after the
--     scheduled date (or end_date for overnight/multi-day) has fully
--     passed.
create or replace function auto_settle_requests()
returns void language plpgsql security definer as $$
declare
  r record;
  v_from uuid;
  v_to uuid;
  v_earner_name text;
  v_push text;
  v_partner_push text;
  v_messages jsonb := '[]'::jsonb;
begin
  for r in
    select id, title, duration_hours, post_type, requesting_family_id, fulfilling_family_id
    from requests
    where status = 'accepted'
      and settled_at is null
      and reversed_at is null
      and fulfilling_family_id is not null
      and coalesce(end_date, date) < current_date
  loop
    if r.post_type = 'request' then
      v_from := r.requesting_family_id; v_to := r.fulfilling_family_id;
    else
      v_from := r.fulfilling_family_id; v_to := r.requesting_family_id;
    end if;

    perform settle_request(r.id);

    select name into v_earner_name from families where id = v_to;
    select push_token, partner_push_token into v_push, v_partner_push from families where id = v_from;

    if v_push like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push, 'sound', 'default',
        'title', '✅ Hours settled',
        'body', format('We paid %s %sh for "%s". Didn''t happen? Tap here to reverse.', coalesce(v_earner_name, 'your helper'), r.duration_hours, r.title),
        'data', jsonb_build_object('path', format('/(tabs)/requests?postType=%s&filter=upcoming', r.post_type))
      );
    end if;
    if v_partner_push like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_partner_push, 'sound', 'default',
        'title', '✅ Hours settled',
        'body', format('We paid %s %sh for "%s". Didn''t happen? Tap here to reverse.', coalesce(v_earner_name, 'your helper'), r.duration_hours, r.title),
        'data', jsonb_build_object('path', format('/(tabs)/requests?postType=%s&filter=upcoming', r.post_type))
      );
    end if;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;

select cron.schedule('auto-settle-hours-daily', '0 9 * * *', $$select auto_settle_requests();$$);

-- ============================================================
-- MIGRATION: Split shared household logins into independent profiles
-- Run in Supabase SQL editor
-- ============================================================

-- 57. partnerships: the new optional "linked partner" relationship.
--     Replaces partner_user_id-on-one-shared-row — two people now have
--     two fully independent profiles (own login, own balance, own
--     requests), linked for visibility/FYI rather than sharing a row.
create table if not exists partnerships (
  id           uuid primary key default uuid_generate_v4(),
  profile_a_id uuid not null references families(id) on delete cascade,
  profile_b_id uuid not null references families(id) on delete cascade,
  created_at   timestamptz not null default now(),
  check (profile_a_id <> profile_b_id),
  unique (profile_a_id, profile_b_id)
);
create index if not exists idx_partnerships_a on partnerships(profile_a_id);
create index if not exists idx_partnerships_b on partnerships(profile_b_id);
alter table partnerships enable row level security;

drop policy if exists "partnerships_select" on partnerships;
drop policy if exists "partnerships_insert" on partnerships;
drop policy if exists "partnerships_delete" on partnerships;
create policy "partnerships_select" on partnerships for select to authenticated
  using (profile_a_id = current_family_id() or profile_b_id = current_family_id() or is_admin());
create policy "partnerships_insert" on partnerships for insert to authenticated
  with check (profile_a_id = current_family_id() or profile_b_id = current_family_id());
create policy "partnerships_delete" on partnerships for delete to authenticated
  using (profile_a_id = current_family_id() or profile_b_id = current_family_id() or is_admin());

-- 58. One-time backfill: every existing partner already has their own
--     auth.users login (join_as_partner just never gave them their own
--     row) — give them one now and link the two via partnerships. Both
--     keep the current shared hours_balance (agreed approach: not split,
--     not zeroed, since it was jointly earned/spent up to now). Kid info
--     is copied to both rather than assigned to just one, so nobody
--     loses visibility into their own kids as a side effect of this
--     migration.
do $$
declare
  r record;
  v_new_id uuid;
  v_partner_email text;
begin
  for r in select * from families where partner_user_id is not null loop
    select email into v_partner_email from auth.users where id = r.partner_user_id;
    if v_partner_email is null then
      raise notice 'Skipping partner_user_id % on family % — no matching auth.users row', r.partner_user_id, r.id;
      continue;
    end if;

    insert into families (
      user_id, name, email, hours_balance, is_admin, is_active,
      kids_data, kids_info, parent1_name, parent1_phone,
      address, emergency_contact, animal, services_offered,
      village_notifications, discoverable
    ) values (
      r.partner_user_id, r.name, v_partner_email, r.hours_balance, false, true,
      r.kids_data, r.kids_info, r.parent2_name, r.parent2_phone,
      r.address, r.emergency_contact, r.animal, r.services_offered,
      r.village_notifications, r.discoverable
    )
    returning id into v_new_id;

    insert into partnerships (profile_a_id, profile_b_id) values (r.id, v_new_id);

    update families
      set partner_user_id = null, partner_push_token = null,
          parent2_name = null, parent2_phone = null
      where id = r.id;
  end loop;
end $$;

-- 59. Every function/policy that special-cased partner_user_id now just
--     treats every profile as its own row — no more "am I the primary
--     or the partner" branch anywhere.
create or replace function current_family_id()
returns uuid language sql stable security definer as $$
  select id from families where user_id = auth.uid() limit 1;
$$;

create or replace function is_admin()
returns boolean language sql stable security definer as $$
  select coalesce((select is_admin from families where user_id = auth.uid() and is_active limit 1), false);
$$;

drop policy if exists "families_update" on families;
create policy "families_update" on families for update to authenticated
  using ((user_id = auth.uid() and is_active) or is_admin());

drop policy if exists "families_select" on families;
create policy "families_select" on families for select to authenticated using (
  user_id = auth.uid()
  or is_admin()
  or (is_active and are_connected(id, current_family_id()))
  or (is_active and exists (
    select 1 from partnerships p
    where (p.profile_a_id = id and p.profile_b_id = current_family_id())
       or (p.profile_b_id = id and p.profile_a_id = current_family_id())
  ))
);

-- 60. join_as_partner now creates the redeemer their own profile (fresh
--     starting balance, like any new signup — there's no shared history
--     to inherit yet) and links it to the inviter via partnerships,
--     instead of attaching to the inviter's row.
create or replace function join_as_partner(p_code text)
returns void language plpgsql security definer as $$
declare
  v_invite  invites%rowtype;
  v_inviter families%rowtype;
  v_new_id  uuid;
begin
  select * into v_invite from invites
  where code = p_code and invite_type = 'partner' and used_by is null;
  if not found then
    raise exception 'Invalid or already used partner invite code';
  end if;

  if exists (select 1 from families where user_id = auth.uid()) then
    raise exception 'You already have a profile';
  end if;

  select * into v_inviter from families where id = v_invite.family_id;

  insert into families (user_id, name, email, hours_balance, is_admin, is_active)
  values (auth.uid(), v_inviter.name, (select email from auth.users where id = auth.uid()), 10, false, true)
  returning id into v_new_id;

  insert into partnerships (profile_a_id, profile_b_id) values (v_invite.family_id, v_new_id);

  update invites set used_by = auth.uid(), used_at = now() where id = v_invite.id;
end;
$$;

-- 61. delete_own_account: no more asymmetric "am I the partner" path —
--     every profile is a peer now. Leaving a partnership just removes
--     the link; deactivating your own profile works the same for
--     everyone.
create or replace function delete_own_account()
returns void language plpgsql security definer as $$
declare
  v_family_id uuid;
begin
  select id into v_family_id from families where user_id = auth.uid() and is_active;
  if v_family_id is null then raise exception 'Not authenticated'; end if;

  delete from partnerships where profile_a_id = v_family_id or profile_b_id = v_family_id;

  update families set
    is_active = false,
    discoverable = false,
    parent1_name = null,
    parent1_phone = null,
    address = null,
    emergency_contact = null,
    kids_info = null,
    kids_data = null,
    push_token = null,
    connect_code = null
  where id = v_family_id;
end;
$$;

-- 62. leave_partnership: unlink from a partner without deactivating
--     your own profile (the old "Leave Household" action, now separate
--     from account deletion since a profile isn't nested inside one
--     anymore — it's an independent thing that happens to be linked).
create or replace function leave_partnership(p_partnership_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from partnerships
  where id = p_partnership_id
    and (profile_a_id = current_family_id() or profile_b_id = current_family_id());
end;
$$;

create or replace function get_admin_push_tokens()
returns table(push_token text)
language sql stable security definer as $$
  select push_token from families where is_admin and is_active;
$$;

-- send_request_reminders and auto_settle_requests (both defined earlier
-- in this file) also read partner_push_token — re-created here without
-- it now that every profile has exactly one push_token of its own.
create or replace function send_request_reminders()
returns void language plpgsql security definer as $$
declare
  v_messages jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select req.id, req.title, f.push_token
    from requests req
    join families f on f.id = req.requesting_family_id
    where req.post_type = 'request'
      and req.status = 'open'
      and req.reminder_sent = false
      and req.date = (current_date + 7)
  loop
    if r.push_token like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', r.push_token,
        'title', '⏰ Still looking for help',
        'body', format('No one has accepted your request "%s" yet — it''s scheduled in a week. Consider sending a personal message or finding an alternative.', r.title),
        'sound', 'default'
      );
    end if;
    update requests set reminder_sent = true where id = r.id;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;

create or replace function auto_settle_requests()
returns void language plpgsql security definer as $$
declare
  r record;
  v_from uuid;
  v_to uuid;
  v_earner_name text;
  v_push text;
  v_messages jsonb := '[]'::jsonb;
begin
  for r in
    select id, title, duration_hours, post_type, requesting_family_id, fulfilling_family_id
    from requests
    where status = 'accepted'
      and settled_at is null
      and reversed_at is null
      and fulfilling_family_id is not null
      and coalesce(end_date, date) < current_date
  loop
    if r.post_type = 'request' then
      v_from := r.requesting_family_id; v_to := r.fulfilling_family_id;
    else
      v_from := r.fulfilling_family_id; v_to := r.requesting_family_id;
    end if;

    perform settle_request(r.id);

    select name into v_earner_name from families where id = v_to;
    select push_token into v_push from families where id = v_from;

    if v_push like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push, 'sound', 'default',
        'title', '✅ Hours settled',
        'body', format('We paid %s %sh for "%s". Didn''t happen? Tap here to reverse.', coalesce(v_earner_name, 'your helper'), r.duration_hours, r.title),
        'data', jsonb_build_object('path', format('/(tabs)/requests?postType=%s&filter=upcoming', r.post_type))
      );
    end if;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;

-- 63. partner_user_id/partner_push_token/parent2_* no longer mean
--     anything — every profile is independent now, linked (if at all)
--     via partnerships.
alter table families drop column if exists partner_user_id;
alter table families drop column if exists partner_push_token;
alter table families drop column if exists parent2_name;
alter table families drop column if exists parent2_phone;

-- ============================================================
-- MIGRATION: Fix invisible counterpart on direct (target_household_id)
-- requests — offer_request/accept_request already let a directly-targeted
-- household interact without an accepted connection (requests_select has
-- always granted visibility of the *request* via target_household_id),
-- but families_select never had a matching clause. Result: the request
-- was visible and actionable, but the other household's name/phone/email
-- came back null via the join — an offer or accepted sit with no way to
-- tell who it actually was.
-- Run in Supabase SQL editor
-- ============================================================

-- 64. Grant full-profile visibility whenever the two households are
--     actively linked by a live (non-terminal) request between them —
--     as a direct target, or as requester/fulfiller on the same row —
--     not just via an accepted connection or partnership.
drop policy if exists "families_select" on families;
create policy "families_select" on families for select to authenticated using (
  user_id = auth.uid()
  or is_admin()
  or (is_active and are_connected(id, current_family_id()))
  or (is_active and exists (
    select 1 from partnerships p
    where (p.profile_a_id = id and p.profile_b_id = current_family_id())
       or (p.profile_b_id = id and p.profile_a_id = current_family_id())
  ))
  or (is_active and current_family_id() is not null and exists (
    select 1 from requests r
    where r.status in ('open', 'offered', 'accepted')
      and (
        (r.requesting_family_id = id and (r.fulfilling_family_id = current_family_id() or r.target_household_id = current_family_id()))
        or (r.fulfilling_family_id = id and r.requesting_family_id = current_family_id())
        or (r.target_household_id = id and r.requesting_family_id = current_family_id())
      )
  ))
);

-- ============================================================
-- MIGRATION: Priority / urgent flag on requests
-- Run in Supabase SQL editor
-- ============================================================

-- 65. Lets a requester flag something time-sensitive (last-minute
--     childcare for a wedding, etc.) so it stands out instead of sitting
--     in a flat list next to everything else.
alter table requests add column if not exists is_urgent boolean not null default false;

-- ============================================================
-- MIGRATION: Profile photos
-- Run in Supabase SQL editor
-- ============================================================

-- 66. Real photos instead of emoji-avatar + last-name-only — testers
--     wanted to visually confirm who they recognize before trusting a
--     stranger-ish connection. photo_url stays null (falls back to the
--     existing animal emoji) until someone sets one.
alter table families add column if not exists photo_url text;

create or replace view families_public as
  select id, name, animal, services_offered, hours_balance, is_admin, created_at, discoverable, photo_url
  from families
  where is_active and (current_family_id() is not null or is_admin());
grant select on families_public to authenticated;

-- 67. Storage bucket for avatar photos. Public bucket (read is a plain
--     CDN URL, no auth needed — profile photos aren't sensitive the way
--     phone/address are) but writes are locked to your own folder,
--     keyed by family id, mirroring the pattern the rest of this app
--     uses everywhere else.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar_insert" on storage.objects;
drop policy if exists "avatar_update" on storage.objects;
drop policy if exists "avatar_delete" on storage.objects;
create policy "avatar_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = current_family_id()::text);
create policy "avatar_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = current_family_id()::text);
create policy "avatar_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = current_family_id()::text);

-- ============================================================
-- MIGRATION: Close two RLS gaps found in a full permissions/privacy audit
-- Run in Supabase SQL editor
-- ============================================================

-- 68. requests_insert/requests_update never validated target_household_id
--     at all — the app's new-request picker only ever offers connected
--     households, but nothing server-side stopped a direct API call from
--     setting it to *any* household id, connected or blocked, letting
--     someone route a "personal request" straight at someone who blocked
--     them (defeating the entire point of blocking) or at a total
--     stranger they were never connected to. requests_update additionally
--     had no WITH CHECK at all — a requester could rewrite status/
--     fulfilling_family_id directly via the REST API and skip every
--     RPC's connection/floor/self-request checks entirely (accept_request
--     etc. are only the *intended* path, RLS is the actual boundary).
drop policy if exists "requests_insert" on requests;
create policy "requests_insert" on requests for insert to authenticated
  with check (
    requesting_family_id = current_family_id()
    and (
      target_household_id is null
      or (are_connected(requesting_family_id, target_household_id) and not is_blocked(requesting_family_id, target_household_id))
    )
  );

drop policy if exists "requests_update" on requests;
create policy "requests_update" on requests for update to authenticated
  using (requesting_family_id = current_family_id() or fulfilling_family_id = current_family_id() or is_admin())
  with check (
    is_admin()
    -- Direct edits (edit-request.tsx) only ever touch an open, unclaimed
    -- request, and never target_household_id — this just re-validates it
    -- didn't get hand-crafted into an invalid state.
    or (
      status = 'open' and fulfilling_family_id is null
      and (target_household_id is null or (are_connected(requesting_family_id, target_household_id) and not is_blocked(requesting_family_id, target_household_id)))
    )
    -- Mark as Completed (requests.tsx) is the one legitimate direct
    -- status write outside the RPCs.
    or status = 'completed'
  );

-- 69. offer_request/accept_request's target_household_id path let a
--     directly-targeted household act on that one request even after
--     being blocked — block_household() only deletes the connections
--     row, which the connection-based auth path already respects, but
--     the target_household_id path had no block check of its own.
create or replace function accept_request(
  p_request_id           uuid,
  p_fulfilling_family_id uuid
)
returns void language plpgsql security definer as $$
declare
  v_request    requests%rowtype;
  v_projected  numeric;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'open' then raise exception 'Request is no longer open'; end if;
  if v_request.requesting_family_id = p_fulfilling_family_id then
    raise exception 'Cannot fulfill your own request';
  end if;
  if is_blocked(v_request.requesting_family_id, p_fulfilling_family_id) then
    raise exception 'Not authorized to accept this request';
  end if;

  if not (
    p_fulfilling_family_id = current_family_id()
    or is_admin()
    or v_request.target_household_id = p_fulfilling_family_id
    or exists (
      select 1 from connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = v_request.requesting_family_id and c.recipient_id = p_fulfilling_family_id)
          or (c.recipient_id = v_request.requesting_family_id and c.requester_id = p_fulfilling_family_id)
        )
    )
  ) then
    raise exception 'Not connected to requester or not authorized to accept this request';
  end if;

  select hours_balance + pending_hours_delta(v_request.requesting_family_id) into v_projected
    from families where id = v_request.requesting_family_id for update;
  if v_projected < -20 then
    raise exception 'Requester balance would drop below -20 once outstanding commitments settle';
  end if;

  update requests
    set status = 'accepted', fulfilling_family_id = p_fulfilling_family_id
    where id = p_request_id;
end;
$$;

create or replace function offer_request(p_request_id uuid, p_offering_family_id uuid)
returns void language plpgsql security definer as $$
declare v_request requests%rowtype;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'open' then raise exception 'Request is no longer open'; end if;
  if v_request.requesting_family_id = p_offering_family_id then
    raise exception 'Cannot offer to fulfill your own request';
  end if;
  if is_blocked(v_request.requesting_family_id, p_offering_family_id) then
    raise exception 'Not authorized to offer on this request';
  end if;

  if not (
    p_offering_family_id = current_family_id()
    or is_admin()
    or v_request.target_household_id = p_offering_family_id
    or exists (
      select 1 from connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = v_request.requesting_family_id and c.recipient_id = p_offering_family_id)
          or (c.recipient_id = v_request.requesting_family_id and c.requester_id = p_offering_family_id)
        )
    )
  ) then
    raise exception 'Not connected to requester';
  end if;

  update requests
    set status = 'offered', fulfilling_family_id = p_offering_family_id
    where id = p_request_id;
end;
$$;

-- 70. Regression from this session's own household→profile migration:
--     current_family_id() lost the "and is_active" guard an earlier
--     migration had deliberately added specifically so a deactivated
--     (admin-removed) account's session stops being treated as anyone
--     the moment it's removed. Without it, most RLS policies — which
--     gate purely via current_family_id() — kept working for a removed
--     account: it could still post requests, message, react, etc.
--     is_admin() already had the guard; current_family_id() needs it too.
create or replace function current_family_id()
returns uuid language sql stable security definer as $$
  select id from families where user_id = auth.uid() and is_active limit 1;
$$;

-- ============================================================
-- MIGRATION: Pets on profile (mirrors kids_data)
-- Run in Supabase SQL editor
-- ============================================================

-- 71. Same privacy model as kids_data — only visible via the full
--     `families` row (self, admin, connected, or actively transacting),
--     never in families_public.
alter table families add column if not exists pets_data jsonb;

-- ============================================================
-- MIGRATION: Notification usability fixes
-- Run in Supabase SQL editor
-- ============================================================

-- 72. join_as_partner never told the inviter their partner actually
--     joined — the only way to find out was opening Profile and
--     noticing the link. Security-definer function already has
--     everything it needs; push directly via net.http_post rather than
--     round-tripping through the client (the joining user's own client
--     state isn't fully set up yet at this point in signup anyway).
create or replace function join_as_partner(p_code text)
returns void language plpgsql security definer as $$
declare
  v_invite  invites%rowtype;
  v_inviter families%rowtype;
  v_new_id  uuid;
  v_push    text;
begin
  select * into v_invite from invites
  where code = p_code and invite_type = 'partner' and used_by is null;
  if not found then
    raise exception 'Invalid or already used partner invite code';
  end if;

  if exists (select 1 from families where user_id = auth.uid()) then
    raise exception 'You already have a profile';
  end if;

  select * into v_inviter from families where id = v_invite.family_id;

  insert into families (user_id, name, email, hours_balance, is_admin, is_active)
  values (auth.uid(), v_inviter.name, (select email from auth.users where id = auth.uid()), 10, false, true)
  returning id into v_new_id;

  insert into partnerships (profile_a_id, profile_b_id) values (v_invite.family_id, v_new_id);

  update invites set used_by = auth.uid(), used_at = now() where id = v_invite.id;

  select push_token into v_push from families where id = v_inviter.id;
  if v_push like 'ExponentPushToken%' then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_array(jsonb_build_object(
        'to', v_push, 'sound', 'default',
        'title', '🎉 Your partner joined!',
        'body', 'They linked their own profile to yours — you each keep your own login and balance.',
        'data', jsonb_build_object('path', '/(tabs)/profile')
      ))
    );
  end if;
end;
$$;

-- 73. auto_settle_requests only ever told the payer ("we paid X") — the
--     person who just earned hours got nothing. Also drops a stale
--     postType query param the requests screen no longer reads
--     (offers were removed from the app).
create or replace function auto_settle_requests()
returns void language plpgsql security definer as $$
declare
  r record;
  v_from uuid;
  v_to uuid;
  v_earner_name text;
  v_payer_name text;
  v_push_from text;
  v_push_to text;
  v_messages jsonb := '[]'::jsonb;
begin
  for r in
    select id, title, duration_hours, post_type, requesting_family_id, fulfilling_family_id
    from requests
    where status = 'accepted'
      and settled_at is null
      and reversed_at is null
      and fulfilling_family_id is not null
      and coalesce(end_date, date) < current_date
  loop
    if r.post_type = 'request' then
      v_from := r.requesting_family_id; v_to := r.fulfilling_family_id;
    else
      v_from := r.fulfilling_family_id; v_to := r.requesting_family_id;
    end if;

    perform settle_request(r.id);

    select name into v_earner_name from families where id = v_to;
    select name into v_payer_name from families where id = v_from;
    select push_token into v_push_from from families where id = v_from;
    select push_token into v_push_to from families where id = v_to;

    if v_push_from like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_from, 'sound', 'default',
        'title', '✅ Hours settled',
        'body', format('We paid %s %sh for "%s". Didn''t happen? Tap here to reverse.', coalesce(v_earner_name, 'your helper'), r.duration_hours, r.title),
        'data', jsonb_build_object('path', '/(tabs)/requests?filter=upcoming')
      );
    end if;
    if v_push_to like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_to, 'sound', 'default',
        'title', '💰 You got paid',
        'body', format('%sh from %s for "%s" just landed in your balance.', r.duration_hours, coalesce(v_payer_name, 'them'), r.title),
        'data', jsonb_build_object('path', '/(tabs)/requests?filter=upcoming')
      );
    end if;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;

-- 74. Day-before reminder for a confirmed sit — nothing previously
--     nudged either side that something they'd committed to was
--     tomorrow (only unfilled, still-open requests got a reminder).
--     Notifies both the requester and the helper.
alter table requests add column if not exists sit_reminder_sent boolean not null default false;

create or replace function send_upcoming_sit_reminders()
returns void language plpgsql security definer as $$
declare
  r record;
  v_messages jsonb := '[]'::jsonb;
  v_push_req text;
  v_push_ful text;
  v_other_name text;
begin
  for r in
    select id, title, start_time, requesting_family_id, fulfilling_family_id
    from requests
    where status = 'accepted'
      and sit_reminder_sent = false
      and fulfilling_family_id is not null
      and date = (current_date + 1)
  loop
    select name into v_other_name from families where id = r.fulfilling_family_id;
    select push_token into v_push_req from families where id = r.requesting_family_id;
    if v_push_req like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_req, 'sound', 'default',
        'title', '📅 Tomorrow',
        'body', format('"%s" with %s is tomorrow at %s.', r.title, coalesce(v_other_name, 'your helper'), r.start_time),
        'data', jsonb_build_object('path', format('/request/%s', r.id))
      );
    end if;

    select name into v_other_name from families where id = r.requesting_family_id;
    select push_token into v_push_ful from families where id = r.fulfilling_family_id;
    if v_push_ful like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_ful, 'sound', 'default',
        'title', '📅 Tomorrow',
        'body', format('"%s" for %s is tomorrow at %s.', r.title, coalesce(v_other_name, 'them'), r.start_time),
        'data', jsonb_build_object('path', format('/request/%s', r.id))
      );
    end if;

    update requests set sit_reminder_sent = true where id = r.id;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;

select cron.schedule('sit-reminders-daily', '0 15 * * *', $$select send_upcoming_sit_reminders();$$);

-- ============================================================
-- MIGRATION: Group chats
-- Run in Supabase SQL editor
-- ============================================================

-- 75. Group chats — a named thread among a creator-picked set of their
--     connections. Unread tracking is a single last_read_at per
--     (group, member) rather than per-message read_at like DMs use,
--     since a group message has many readers instead of one.
create table if not exists group_chats (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  created_by  uuid not null references families(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists group_chat_members (
  group_id   uuid not null references group_chats(id) on delete cascade,
  family_id  uuid not null references families(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (group_id, family_id)
);

create table if not exists group_messages (
  id             uuid primary key default uuid_generate_v4(),
  group_id       uuid not null references group_chats(id) on delete cascade,
  from_family_id uuid not null references families(id) on delete cascade,
  body           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_group_messages_group on group_messages(group_id, created_at);

create table if not exists group_message_reads (
  group_id      uuid not null references group_chats(id) on delete cascade,
  family_id     uuid not null references families(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (group_id, family_id)
);

alter table group_chats enable row level security;
alter table group_chat_members enable row level security;
alter table group_messages enable row level security;
alter table group_message_reads enable row level security;

create or replace function is_group_member(p_group_id uuid, p_family_id uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from group_chat_members where group_id = p_group_id and family_id = p_family_id);
$$;

drop policy if exists "group_chats_select" on group_chats;
drop policy if exists "group_chats_insert" on group_chats;
create policy "group_chats_select" on group_chats for select to authenticated
  using (is_group_member(id, current_family_id()) or is_admin());
create policy "group_chats_insert" on group_chats for insert to authenticated
  with check (created_by = current_family_id());

drop policy if exists "group_chat_members_select" on group_chat_members;
drop policy if exists "group_chat_members_insert" on group_chat_members;
drop policy if exists "group_chat_members_delete" on group_chat_members;
create policy "group_chat_members_select" on group_chat_members for select to authenticated
  using (is_group_member(group_id, current_family_id()) or is_admin());
-- Only the creator can add members, and only people they're connected
-- to — same trust boundary DMs use, so a group can't pull in a
-- stranger via someone else's connections.
create policy "group_chat_members_insert" on group_chat_members for insert to authenticated
  with check (
    exists (select 1 from group_chats g where g.id = group_id and g.created_by = current_family_id())
    and (family_id = current_family_id() or are_connected(current_family_id(), family_id))
  );
create policy "group_chat_members_delete" on group_chat_members for delete to authenticated
  using (family_id = current_family_id());

drop policy if exists "group_messages_select" on group_messages;
drop policy if exists "group_messages_insert" on group_messages;
create policy "group_messages_select" on group_messages for select to authenticated
  using (is_group_member(group_id, current_family_id()) or is_admin());
create policy "group_messages_insert" on group_messages for insert to authenticated
  with check (from_family_id = current_family_id() and is_group_member(group_id, current_family_id()));

drop policy if exists "group_message_reads_select" on group_message_reads;
drop policy if exists "group_message_reads_insert" on group_message_reads;
drop policy if exists "group_message_reads_update" on group_message_reads;
create policy "group_message_reads_select" on group_message_reads for select to authenticated
  using (family_id = current_family_id());
create policy "group_message_reads_insert" on group_message_reads for insert to authenticated
  with check (family_id = current_family_id());
create policy "group_message_reads_update" on group_message_reads for update to authenticated
  using (family_id = current_family_id());

-- 76. create_group_chat: creates the group, adds the creator plus the
--     chosen members in one call (avoids a half-created group if the
--     member inserts partially fail), and seeds everyone's read marker
--     so a brand-new group doesn't show as having unread history.
create or replace function create_group_chat(p_name text, p_member_ids uuid[])
returns uuid language plpgsql security definer as $$
declare
  v_me uuid;
  v_group_id uuid;
  v_member uuid;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;
  if trim(p_name) = '' then raise exception 'Group name is required'; end if;

  insert into group_chats (name, created_by) values (trim(p_name), v_me) returning id into v_group_id;

  insert into group_chat_members (group_id, family_id) values (v_group_id, v_me);
  insert into group_message_reads (group_id, family_id) values (v_group_id, v_me);

  foreach v_member in array p_member_ids loop
    if v_member <> v_me and are_connected(v_me, v_member) then
      insert into group_chat_members (group_id, family_id) values (v_group_id, v_member)
        on conflict do nothing;
      insert into group_message_reads (group_id, family_id) values (v_group_id, v_member)
        on conflict do nothing;
    end if;
  end loop;

  return v_group_id;
end;
$$;

-- 77. Push everyone in the group except the sender when a message lands.
create or replace function notify_group_message(p_group_id uuid, p_sender_name text, p_body text)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_group_name text;
  v_messages jsonb := '[]'::jsonb;
  r record;
begin
  v_me := current_family_id();
  select name into v_group_name from group_chats where id = p_group_id;

  for r in
    select f.push_token
    from group_chat_members m
    join families f on f.id = m.family_id
    where m.group_id = p_group_id and m.family_id <> v_me
  loop
    if r.push_token like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', r.push_token, 'sound', 'default',
        'title', format('%s · %s', coalesce(v_group_name, 'Group'), p_sender_name),
        'body', p_body,
        'data', jsonb_build_object('path', format('/group/%s', p_group_id))
      );
    end if;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;

-- ============================================================
-- MIGRATION: Fix "Mark as Completed" never actually settling hours
-- Run in Supabase SQL editor
-- ============================================================

-- 78. requests_update's "status = 'completed' is the one legitimate direct
--     write" escape hatch (migration 68) let the app flip a request straight
--     to 'completed' via a plain client .update() with zero hour transfer —
--     settle_request() was never called. Two knock-on breaks: (1) hours
--     never actually moved, but pending_hours_delta/getPendingBreakdown
--     stop counting the row the moment status leaves 'accepted', so the
--     hours vanished from both "pending" AND the real balance — gone
--     nowhere; (2) auto_settle_requests only ever looks at status =
--     'accepted', so a request completed before its scheduled date passed
--     was permanently skipped by the cron too, and reverse_settlement/
--     cancel_accepted_request both require state this row could never be
--     in again. Net effect: tapping "Mark as Completed" any time before
--     the cron would have settled it anyway silently ate the hours.
--     Fix: completion now goes through one RPC that settles (if not
--     already settled) and only then flips status, so 'completed' always
--     implies settled_at is set — same as manually confirming what the
--     cron does automatically once the date passes.
create or replace function complete_request(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request requests%rowtype;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'accepted' then raise exception 'Request is not in an accepted state'; end if;
  if not (
    is_admin()
    or current_family_id() = v_request.requesting_family_id
    or current_family_id() = v_request.fulfilling_family_id
  ) then
    raise exception 'Not authorized to complete this request';
  end if;

  if v_request.settled_at is null then
    perform settle_request(p_request_id);
  end if;

  update requests set status = 'completed' where id = p_request_id;
end;
$$;

-- The direct "status = 'completed'" bypass is no longer needed now that
-- completion goes through complete_request (SECURITY DEFINER, bypasses
-- RLS) — removing it closes the hole that let any client update a
-- request straight to 'completed' with no hour transfer at all.
drop policy if exists "requests_update" on requests;
create policy "requests_update" on requests for update to authenticated
  using (requesting_family_id = current_family_id() or fulfilling_family_id = current_family_id() or is_admin())
  with check (
    is_admin()
    or (
      status = 'open' and fulfilling_family_id is null
      and (target_household_id is null or (are_connected(requesting_family_id, target_household_id) and not is_blocked(requesting_family_id, target_household_id)))
    )
  );

-- Cron-settled requests were left sitting at status = 'accepted' forever
-- (only settled_at got set), so a sit whose date passed without anyone
-- tapping "Mark as Completed" showed as permanently "Past date · Accepted"
-- even though it had already paid out. Now the cron finishes the same
-- state transition a manual completion does.
create or replace function auto_settle_requests()
returns void language plpgsql security definer as $$
declare
  r record;
  v_from uuid;
  v_to uuid;
  v_earner_name text;
  v_payer_name text;
  v_push_from text;
  v_push_to text;
  v_messages jsonb := '[]'::jsonb;
begin
  for r in
    select id, title, duration_hours, post_type, requesting_family_id, fulfilling_family_id
    from requests
    where status = 'accepted'
      and settled_at is null
      and reversed_at is null
      and fulfilling_family_id is not null
      and coalesce(end_date, date) < current_date
  loop
    if r.post_type = 'request' then
      v_from := r.requesting_family_id; v_to := r.fulfilling_family_id;
    else
      v_from := r.fulfilling_family_id; v_to := r.requesting_family_id;
    end if;

    perform settle_request(r.id);
    update requests set status = 'completed' where id = r.id;

    select name into v_earner_name from families where id = v_to;
    select name into v_payer_name from families where id = v_from;
    select push_token into v_push_from from families where id = v_from;
    select push_token into v_push_to from families where id = v_to;

    if v_push_from like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_from, 'sound', 'default',
        'title', '✅ Hours settled',
        'body', format('We paid %s %sh for "%s". Didn''t happen? Tap here to reverse.', coalesce(v_earner_name, 'your helper'), r.duration_hours, r.title),
        'data', jsonb_build_object('path', '/(tabs)/requests?filter=upcoming')
      );
    end if;
    if v_push_to like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_to, 'sound', 'default',
        'title', '💰 You got paid',
        'body', format('%sh from %s for "%s" just landed in your balance.', r.duration_hours, coalesce(v_payer_name, 'them'), r.title),
        'data', jsonb_build_object('path', '/(tabs)/requests?filter=upcoming')
      );
    end if;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;

-- ============================================================
-- MIGRATION: direct_messages was missing an UPDATE policy entirely
-- Run in Supabase SQL editor
-- ============================================================

-- 79. direct_messages has always had select/insert/delete policies but no
--     UPDATE policy at all. With RLS enabled and zero UPDATE policies, every
--     update is denied by default — not with an error, just 0 rows
--     affected, silently. markRead() (dm/[familyId].tsx) has been calling
--     `update direct_messages set read_at = ... where to_family_id = me`
--     this whole time and it has never once actually applied: read_at
--     never got set, so the Messages-tab unread badge (which counts
--     `read_at is null`) never cleared no matter how many times a thread
--     was opened. Recipient can mark their own inbound messages read;
--     nothing else about a message is meant to be editable this way.
create policy "dm_update" on direct_messages for update to authenticated
  using (to_family_id = current_family_id())
  with check (to_family_id = current_family_id());

-- ============================================================
-- MIGRATION: verify admin hour adjustments actually land
-- Run in Supabase SQL editor
-- ============================================================

-- 80. admin_adjust_balance returned void, so the app had to trust the
--     write happened and refetch separately to show it — if that refetch
--     ever raced or targeted a stale family object, an admin adjustment
--     could look like it silently did nothing even though it succeeded
--     (or vice versa). Returning the resulting balance lets the client
--     show the actual post-write number immediately, no refetch needed to
--     confirm it landed.
drop function if exists admin_adjust_balance(uuid, numeric, text, uuid);
create or replace function admin_adjust_balance(
  p_family_id uuid,
  p_hours     numeric,
  p_note      text,
  p_admin_id  uuid
)
returns numeric language plpgsql security definer as $$
declare
  v_new_bal numeric;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;

  select hours_balance + p_hours into v_new_bal from families where id = p_family_id for update;
  if v_new_bal is null then
    raise exception 'Household not found';
  end if;
  if v_new_bal < -20 then
    raise exception 'Balance cannot go below -20';
  end if;

  update families set hours_balance = v_new_bal where id = p_family_id;

  insert into transactions (from_family_id, to_family_id, hours, note)
    values (
      case when p_hours < 0 then p_family_id else null end,
      case when p_hours > 0 then p_family_id else null end,
      abs(p_hours),
      coalesce(p_note, 'Admin adjustment')
    );

  return v_new_bal;
end;
$$;

-- ============================================================
-- MIGRATION: Audit pass — security fixes, dead-column cleanup,
-- in-app notification inbox, request comment threads, vouches,
-- and "nudge a connection". All idempotent.
-- Run in Supabase SQL editor.
-- ============================================================

-- 81. settle_request authorization hole: the guard was
--     `not is_admin() and current_family_id() is not null and <> both parties`.
--     A caller with NO families row (mid-signup, deleted profile, a bare
--     auth session) has current_family_id() = NULL, so the middle clause
--     short-circuited the whole check to false and let them settle ANY
--     request — moving two other households' hours. The cron path needs
--     the NULL bypass (it runs with no auth context), so distinguish
--     "server/cron" (auth.uid() is null) from "a logged-in user with no
--     profile" (auth.uid() set, current_family_id() null) and only let the
--     former through.
create or replace function settle_request(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_request requests%rowtype;
  v_from    uuid;
  v_to      uuid;
begin
  select * into v_request from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'accepted' then raise exception 'Request is not in an accepted state'; end if;
  if v_request.settled_at is not null then raise exception 'Already settled'; end if;

  -- Cron/server (no auth context) is allowed. A logged-in user must be a
  -- party to the request or an admin — no more NULL-profile bypass.
  if auth.uid() is not null then
    if not (
      is_admin()
      or current_family_id() = v_request.requesting_family_id
      or current_family_id() = v_request.fulfilling_family_id
    ) then
      raise exception 'Not authorized to settle this request';
    end if;
  end if;

  if v_request.post_type = 'request' then
    v_from := v_request.requesting_family_id; v_to := v_request.fulfilling_family_id;
  else
    v_from := v_request.fulfilling_family_id; v_to := v_request.requesting_family_id;
  end if;

  update families set hours_balance = hours_balance - v_request.duration_hours where id = v_from;
  update families set hours_balance = hours_balance + v_request.duration_hours where id = v_to;
  update requests set settled_at = now() where id = p_request_id;
  insert into transactions (from_family_id, to_family_id, hours, request_id, note)
    values (v_from, v_to, v_request.duration_hours, p_request_id, 'Auto-settled on scheduled date');
end;
$$;

-- 82. families_public leaked hours_balance and is_admin to every active
--     user (queryable directly, not just via the app). Balance is
--     semi-private; is_admin lets anyone enumerate admins to target. Drop
--     both — nothing in the app reads hours_balance off the public view
--     (own balance comes from the full `families` row via auth context),
--     and is_admin was never needed here.
create or replace view families_public as
  select id, name, animal, services_offered, created_at, discoverable, photo_url
  from families
  where is_active and (current_family_id() is not null or is_admin());
grant select on families_public to authenticated;

-- 83. Drop dead columns. village_notifications was a notification-
--     preference enum the app never read or wrote. kids_info was the
--     free-text predecessor of kids_data (structured). phone was the
--     predecessor of parent1_phone. All three are write-dead in the
--     current app; kids_info/phone are still read only as `x || legacy`
--     fallbacks, removed in the same change set.
alter table families drop column if exists village_notifications;
alter table families drop column if exists kids_info;
alter table families drop column if exists phone;

-- 84. approve_offering_claim only ever applied to post_type = 'offering'
--     ("I can help" availability posts), a flow removed from the app.
--     Nothing calls it.
drop function if exists approve_offering_claim(uuid, uuid);

-- ============================================================
-- 85. In-app notification inbox. Push is fire-and-forget with no
--     history — miss one and it's gone. Every outbound push now also
--     lands as a row here. Delivery (push) and the inbox row are done in
--     one SECURITY DEFINER call so callers can't desync them and so a
--     regular user can't hand-craft an inbox row for someone else.
-- ============================================================
create table if not exists notifications (
  id         uuid primary key default uuid_generate_v4(),
  family_id  uuid not null references families(id) on delete cascade,
  title      text not null,
  body       text not null,
  path       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_family_time on notifications(family_id, created_at desc);
create index if not exists idx_notifications_unread on notifications(family_id) where read_at is null;

alter table notifications enable row level security;
drop policy if exists "notifications_select" on notifications;
drop policy if exists "notifications_update" on notifications;
drop policy if exists "notifications_delete" on notifications;
drop policy if exists "notifications_insert" on notifications;
create policy "notifications_select" on notifications for select to authenticated
  using (family_id = current_family_id());
create policy "notifications_update" on notifications for update to authenticated
  using (family_id = current_family_id()) with check (family_id = current_family_id());
create policy "notifications_delete" on notifications for delete to authenticated
  using (family_id = current_family_id());
-- Inbox rows are only ever written by the SECURITY DEFINER helpers below
-- (which bypass RLS) — no client-side inserts.
create policy "notifications_insert" on notifications for insert to authenticated
  with check (false);

-- Low-level: one recipient. Inserts the inbox row and, if the recipient
-- has a valid Expo token, sends the push.
create or replace function app_notify(
  p_family_id uuid, p_title text, p_body text, p_path text default null
)
returns void language plpgsql security definer as $$
declare v_push text;
begin
  if p_family_id is null then return; end if;

  insert into notifications (family_id, title, body, path)
    values (p_family_id, p_title, p_body, p_path);

  select push_token into v_push from families where id = p_family_id and is_active;
  if v_push like 'ExponentPushToken%' then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_array(jsonb_build_object(
        'to', v_push, 'sound', 'default', 'title', p_title, 'body', p_body,
        'data', case when p_path is null then '{}'::jsonb else jsonb_build_object('path', p_path) end
      ))
    );
  end if;
end;
$$;
grant execute on function app_notify(uuid, text, text, text) to authenticated;

-- Fan-out to the caller's accepted connections, filtered to those open to
-- the request's category (or who haven't set any category preference),
-- excluding blocked households. One batched push.
create or replace function app_notify_connections(
  p_title text, p_body text, p_path text default null, p_category text default null
)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_messages jsonb := '[]'::jsonb;
  r record;
begin
  v_me := current_family_id();
  if v_me is null then return; end if;

  for r in
    select f.id, f.push_token
    from connections c
    join families f on f.id = case when c.requester_id = v_me then c.recipient_id else c.requester_id end
    where c.status = 'accepted'
      and (c.requester_id = v_me or c.recipient_id = v_me)
      and f.is_active
      and not is_blocked(v_me, f.id)
      and (
        p_category is null
        or f.services_offered is null
        or jsonb_array_length(coalesce(f.services_offered, '[]'::jsonb)) = 0
        or f.services_offered ? p_category
      )
  loop
    insert into notifications (family_id, title, body, path) values (r.id, p_title, p_body, p_path);
    if r.push_token like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', r.push_token, 'sound', 'default', 'title', p_title, 'body', p_body,
        'data', case when p_path is null then '{}'::jsonb else jsonb_build_object('path', p_path) end
      );
    end if;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;
grant execute on function app_notify_connections(text, text, text, text) to authenticated;

-- Every active admin household.
create or replace function app_notify_admins(
  p_title text, p_body text, p_path text default null
)
returns void language plpgsql security definer as $$
declare
  v_messages jsonb := '[]'::jsonb;
  r record;
begin
  for r in select id, push_token from families where is_admin and is_active loop
    insert into notifications (family_id, title, body, path) values (r.id, p_title, p_body, p_path);
    if r.push_token like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', r.push_token, 'sound', 'default', 'title', p_title, 'body', p_body,
        'data', case when p_path is null then '{}'::jsonb else jsonb_build_object('path', p_path) end
      );
    end if;
  end loop;
  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
end;
$$;
grant execute on function app_notify_admins(text, text, text) to authenticated;

-- Mark all of the caller's unread notifications read in one shot.
create or replace function mark_all_notifications_read()
returns void language sql security definer as $$
  update notifications set read_at = now()
  where family_id = current_family_id() and read_at is null;
$$;
grant execute on function mark_all_notifications_read() to authenticated;

-- The server-side cron jobs (send_request_reminders, auto_settle_requests,
-- send_upcoming_sit_reminders) push directly via net.http_post and now
-- also drop an inbox row so those land in history too.
create or replace function send_request_reminders()
returns void language plpgsql security definer as $$
declare
  v_messages jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select req.id, req.title, req.requesting_family_id, f.push_token
    from requests req
    join families f on f.id = req.requesting_family_id
    where req.post_type = 'request'
      and req.status = 'open'
      and req.reminder_sent = false
      and req.date = (current_date + 7)
  loop
    insert into notifications (family_id, title, body, path)
      values (r.requesting_family_id, '⏰ Still looking for help',
        format('No one has accepted your request "%s" yet — it''s scheduled in a week.', r.title),
        format('/request/%s', r.id));
    if r.push_token like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', r.push_token, 'title', '⏰ Still looking for help',
        'body', format('No one has accepted your request "%s" yet — it''s scheduled in a week. Consider sending a personal message or finding an alternative.', r.title),
        'sound', 'default');
    end if;
    update requests set reminder_sent = true where id = r.id;
  end loop;
  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'), body := v_messages);
  end if;
end;
$$;

-- Day-of settlement sweep — same as migration 78, plus an inbox row per
-- notification so settled/paid events show up in notification history.
create or replace function auto_settle_requests()
returns void language plpgsql security definer as $$
declare
  r record;
  v_from uuid;
  v_to uuid;
  v_earner_name text;
  v_payer_name text;
  v_push_from text;
  v_push_to text;
  v_messages jsonb := '[]'::jsonb;
begin
  for r in
    select id, title, duration_hours, post_type, requesting_family_id, fulfilling_family_id
    from requests
    where status = 'accepted'
      and settled_at is null
      and reversed_at is null
      and fulfilling_family_id is not null
      and coalesce(end_date, date) < current_date
  loop
    if r.post_type = 'request' then
      v_from := r.requesting_family_id; v_to := r.fulfilling_family_id;
    else
      v_from := r.fulfilling_family_id; v_to := r.requesting_family_id;
    end if;

    perform settle_request(r.id);
    update requests set status = 'completed' where id = r.id;

    select name into v_earner_name from families where id = v_to;
    select name into v_payer_name from families where id = v_from;
    select push_token into v_push_from from families where id = v_from;
    select push_token into v_push_to from families where id = v_to;

    insert into notifications (family_id, title, body, path) values
      (v_from, '✅ Hours settled',
       format('We paid %s %sh for "%s". Didn''t happen? Open it to reverse.', coalesce(v_earner_name, 'your helper'), r.duration_hours, r.title),
       format('/request/%s', r.id)),
      (v_to, '💰 You got paid',
       format('%sh from %s for "%s" just landed in your balance.', r.duration_hours, coalesce(v_payer_name, 'them'), r.title),
       format('/request/%s', r.id));

    if v_push_from like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_from, 'sound', 'default', 'title', '✅ Hours settled',
        'body', format('We paid %s %sh for "%s". Didn''t happen? Tap here to reverse.', coalesce(v_earner_name, 'your helper'), r.duration_hours, r.title),
        'data', jsonb_build_object('path', format('/request/%s', r.id)));
    end if;
    if v_push_to like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_to, 'sound', 'default', 'title', '💰 You got paid',
        'body', format('%sh from %s for "%s" just landed in your balance.', r.duration_hours, coalesce(v_payer_name, 'them'), r.title),
        'data', jsonb_build_object('path', format('/request/%s', r.id)));
    end if;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'), body := v_messages);
  end if;
end;
$$;

-- Day-before reminder for a confirmed booking — same as migration 74, plus
-- inbox rows.
create or replace function send_upcoming_sit_reminders()
returns void language plpgsql security definer as $$
declare
  r record;
  v_messages jsonb := '[]'::jsonb;
  v_push_req text;
  v_push_ful text;
  v_other_name text;
begin
  for r in
    select id, title, start_time, requesting_family_id, fulfilling_family_id
    from requests
    where status = 'accepted'
      and sit_reminder_sent = false
      and fulfilling_family_id is not null
      and date = (current_date + 1)
  loop
    select name into v_other_name from families where id = r.fulfilling_family_id;
    select push_token into v_push_req from families where id = r.requesting_family_id;
    insert into notifications (family_id, title, body, path) values
      (r.requesting_family_id, '📅 Tomorrow',
       format('"%s" with %s is tomorrow at %s.', r.title, coalesce(v_other_name, 'your helper'), r.start_time),
       format('/request/%s', r.id));
    if v_push_req like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_req, 'sound', 'default', 'title', '📅 Tomorrow',
        'body', format('"%s" with %s is tomorrow at %s.', r.title, coalesce(v_other_name, 'your helper'), r.start_time),
        'data', jsonb_build_object('path', format('/request/%s', r.id)));
    end if;

    select name into v_other_name from families where id = r.requesting_family_id;
    select push_token into v_push_ful from families where id = r.fulfilling_family_id;
    insert into notifications (family_id, title, body, path) values
      (r.fulfilling_family_id, '📅 Tomorrow',
       format('"%s" for %s is tomorrow at %s.', r.title, coalesce(v_other_name, 'them'), r.start_time),
       format('/request/%s', r.id));
    if v_push_ful like 'ExponentPushToken%' then
      v_messages := v_messages || jsonb_build_object(
        'to', v_push_ful, 'sound', 'default', 'title', '📅 Tomorrow',
        'body', format('"%s" for %s is tomorrow at %s.', r.title, coalesce(v_other_name, 'them'), r.start_time),
        'data', jsonb_build_object('path', format('/request/%s', r.id)));
    end if;

    update requests set sit_reminder_sent = true where id = r.id;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform net.http_post(url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'), body := v_messages);
  end if;
end;
$$;

-- ============================================================
-- 86. Request comment threads. Replaces the "Chat about this request"
--     DM-prefill hack with a thread anchored to the request itself,
--     visible to everyone who can see the request.
-- ============================================================
create or replace function can_see_request(p_request_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from requests r where r.id = p_request_id and (
      r.requesting_family_id = current_family_id()
      or r.fulfilling_family_id = current_family_id()
      or r.target_household_id = current_family_id()
      or is_admin()
      or exists (
        select 1 from connections c
        where c.status = 'accepted'
          and (
            (c.requester_id = r.requesting_family_id and c.recipient_id = current_family_id())
            or (c.recipient_id = r.requesting_family_id and c.requester_id = current_family_id())
          )
      )
    )
  );
$$;

create table if not exists request_comments (
  id          uuid primary key default uuid_generate_v4(),
  request_id  uuid not null references requests(id) on delete cascade,
  family_id   uuid not null references families(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_request_comments_request on request_comments(request_id, created_at);

alter table request_comments enable row level security;
drop policy if exists "request_comments_select" on request_comments;
drop policy if exists "request_comments_insert" on request_comments;
drop policy if exists "request_comments_delete" on request_comments;
create policy "request_comments_select" on request_comments for select to authenticated
  using (can_see_request(request_id));
create policy "request_comments_insert" on request_comments for insert to authenticated
  with check (family_id = current_family_id() and can_see_request(request_id));
create policy "request_comments_delete" on request_comments for delete to authenticated
  using (family_id = current_family_id() or is_admin());

-- Notify the other side(s) of the request when a comment lands: everyone
-- who has posted on it, plus the requester and fulfiller, minus the author.
create or replace function notify_request_comment(p_request_id uuid, p_body text)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_req requests%rowtype;
  v_author text;
  r record;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;
  select * into v_req from requests where id = p_request_id;
  if not found then return; end if;
  select name into v_author from families where id = v_me;

  for r in
    select distinct fam_id from (
      select requesting_family_id as fam_id from requests where id = p_request_id
      union
      select fulfilling_family_id from requests where id = p_request_id
      union
      select family_id from request_comments where request_id = p_request_id
    ) s
    where fam_id is not null and fam_id <> v_me
  loop
    perform app_notify(r.fam_id, format('💬 %s commented', v_author),
      left(p_body, 140), format('/request/%s', p_request_id));
  end loop;
end;
$$;
grant execute on function notify_request_comment(uuid, text) to authenticated;

-- ============================================================
-- 87. Vouches. A lightweight public trust signal — you can vouch for a
--     household you're connected with. Shown on their profile.
-- ============================================================
create table if not exists vouches (
  id          uuid primary key default uuid_generate_v4(),
  voucher_id  uuid not null references families(id) on delete cascade,
  vouched_id  uuid not null references families(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now(),
  unique (voucher_id, vouched_id),
  check (voucher_id <> vouched_id)
);
create index if not exists idx_vouches_vouched on vouches(vouched_id);

alter table vouches enable row level security;
drop policy if exists "vouches_select" on vouches;
drop policy if exists "vouches_insert" on vouches;
drop policy if exists "vouches_delete" on vouches;
-- Public trust signal — any active user can read them.
create policy "vouches_select" on vouches for select to authenticated
  using (current_family_id() is not null or is_admin());
create policy "vouches_insert" on vouches for insert to authenticated
  with check (
    voucher_id = current_family_id()
    and voucher_id <> vouched_id
    and are_connected(voucher_id, vouched_id)
    and not is_blocked(voucher_id, vouched_id)
  );
create policy "vouches_delete" on vouches for delete to authenticated
  using (voucher_id = current_family_id());

-- ============================================================
-- 88. Nudge a specific connection about one of your open requests.
--     Rate-limited to once per (request, recipient) per 24h so it can't
--     be used to spam.
-- ============================================================
create table if not exists request_nudges (
  request_id     uuid not null references requests(id) on delete cascade,
  from_family_id uuid not null references families(id) on delete cascade,
  to_family_id   uuid not null references families(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (request_id, from_family_id, to_family_id)
);
alter table request_nudges enable row level security;
drop policy if exists "request_nudges_select" on request_nudges;
create policy "request_nudges_select" on request_nudges for select to authenticated
  using (from_family_id = current_family_id() or to_family_id = current_family_id());
-- Written only by the RPC below.
create policy "request_nudges_insert" on request_nudges for insert to authenticated
  with check (false);

create or replace function nudge_connection(p_request_id uuid, p_to_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_me   uuid;
  v_req  requests%rowtype;
  v_name text;
  v_last timestamptz;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;

  select * into v_req from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.requesting_family_id <> v_me then raise exception 'Not your request'; end if;
  if v_req.status <> 'open' then raise exception 'Request is no longer open'; end if;
  if p_to_family_id = v_me then raise exception 'Cannot nudge yourself'; end if;
  if not are_connected(v_me, p_to_family_id) then raise exception 'Not connected'; end if;
  if is_blocked(v_me, p_to_family_id) then raise exception 'Not connected'; end if;

  select created_at into v_last from request_nudges
    where request_id = p_request_id and from_family_id = v_me and to_family_id = p_to_family_id;
  if v_last is not null and v_last > now() - interval '24 hours' then
    raise exception 'You already nudged them about this in the last day';
  end if;

  insert into request_nudges (request_id, from_family_id, to_family_id)
    values (p_request_id, v_me, p_to_family_id)
  on conflict (request_id, from_family_id, to_family_id)
    do update set created_at = now();

  select name into v_name from families where id = v_me;
  perform app_notify(p_to_family_id, format('👋 %s could use your help', v_name),
    format('"%s" — tap to take a look', v_req.title), format('/request/%s', p_request_id));
end;
$$;
grant execute on function nudge_connection(uuid, uuid) to authenticated;

-- ============================================================
-- 89. Realtime: the app subscribes to these new tables the same way it
--     already does for messages/requests/etc. They must be in the
--     supabase_realtime publication or those .on('postgres_changes')
--     listeners silently never fire. Guarded so re-running is a no-op.
-- ============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table notifications;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table request_comments;
  exception when others then null;
  end;
end $$;

-- ============================================================
-- SEED: create the admin household
-- After running this schema, sign up via the app with:
--   email: lindsayomaits@gmail.com
-- Then run:
--   update families set is_admin = true where email = 'lindsayomaits@gmail.com';
-- ============================================================
