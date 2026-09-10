-- ============================================================
-- HOW TO RUN THIS
-- 1. Open your project at supabase.com
-- 2. Left sidebar -> "SQL Editor" -> "New query"
-- 3. Paste this ENTIRE file into the box
-- 4. Click "Run" (bottom right)
-- 5. It should say "Success. No rows returned"
--
-- It's safe to run more than once (nothing breaks if you re-run it).
-- Run it BEFORE opening the new app build, or notifications will be broken.
-- ============================================================

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
