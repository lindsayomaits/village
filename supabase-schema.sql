-- ============================================================
-- Babysit Exchange — Supabase Schema
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
      'Sit cancelled — hours returned'
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
-- SEED: create the admin household
-- After running this schema, sign up via the app with:
--   email: lindsayomaits@gmail.com
-- Then run:
--   update families set is_admin = true where email = 'lindsayomaits@gmail.com';
-- ============================================================
