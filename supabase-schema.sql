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
-- SEED: create the admin household
-- After running this schema, sign up via the app with:
--   email: lindsayomaits@gmail.com
-- Then run:
--   update families set is_admin = true where email = 'lindsayomaits@gmail.com';
-- ============================================================
