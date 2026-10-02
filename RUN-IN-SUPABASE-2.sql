-- ============================================================
-- HOW TO RUN THIS
-- 1. Open your project at supabase.com
-- 2. Left sidebar -> "SQL Editor" -> "New query"
-- 3. Paste this ENTIRE file into the box
-- 4. Click "Run" (bottom right)
-- 5. It should say "Success. No rows returned"
--
-- It's safe to run more than once (nothing breaks if you re-run it).
-- Run it BEFORE opening the new app build — the app reads the new
-- 'expired' status and the proposed_* columns.
-- ============================================================

-- ============================================================
-- MIGRATION: Expired requests, time proposals ("can you do this time
-- instead?"), and removing expired requests. All idempotent.
-- ============================================================

-- 90. 'expired' status. An open or offered request whose date (or, for
--     a flexible/overnight one, its end date) passes with nobody
--     confirmed never moves hours — it was just sitting in the pending
--     buckets forever, inflating "possible spend"/"on the way" and
--     cluttering every list as "Past date".
alter table requests drop constraint if exists requests_status_check;
alter table requests add constraint requests_status_check
  check (status in ('open', 'offered', 'accepted', 'completed', 'cancelled', 'expired'));
alter table requests add column if not exists expired_at timestamptz;

-- 91. Pending hours only count requests that can still happen. Accepted
--     but unsettled ones stay in (auto_settle_requests pays them out the
--     day after), but past-date open/offered ones are dead.
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
    and (
      (status in ('open', 'offered') and coalesce(end_date, date) >= current_date)
      or (status = 'accepted' and settled_at is null)
    );
$$;

-- 92. Daily sweep: flip past-date open/offered requests to 'expired'.
--     Only notifies for ones that expired in the last couple of days, so
--     the first run doesn't flood everyone with a backlog of old posts.
create or replace function expire_stale_requests()
returns void language plpgsql security definer as $$
declare
  r record;
begin
  for r in
    select id, title, status, requesting_family_id, fulfilling_family_id,
           coalesce(end_date, date) as last_day
    from requests
    where status in ('open', 'offered')
      and coalesce(end_date, date) < current_date
    for update skip locked
  loop
    update requests
      set status = 'expired', expired_at = now(), fulfilling_family_id = null
      where id = r.id;

    if r.last_day >= current_date - 2 then
      perform app_notify(r.requesting_family_id, '⌛ Request expired',
        format('"%s" passed its date without a confirmed helper — no hours moved. Repost it with a new date or remove it.', r.title),
        format('/request/%s', r.id));
      if r.status = 'offered' and r.fulfilling_family_id is not null then
        perform app_notify(r.fulfilling_family_id, '⌛ Offer expired',
          format('Your offer on "%s" expired before it was approved — no hours moved.', r.title),
          format('/request/%s', r.id));
      end if;
    end if;
  end loop;
end;
$$;

do $$
begin
  perform cron.unschedule('expire-requests-daily');
exception when others then null;
end $$;
select cron.schedule('expire-requests-daily', '5 9 * * *', $$select expire_stale_requests();$$);

-- Clear the existing backlog right now rather than waiting for tomorrow.
select expire_stale_requests();

-- 93. Owners can remove an expired request as well as an open one.
drop policy if exists "requests_delete" on requests;
create policy "requests_delete" on requests for delete to authenticated using (
  requesting_family_id = current_family_id() and status in ('open', 'expired')
);

-- 94. Time proposals. Either side of a request can say "I can't do that
--     time, but I can do this one" — the helper when offering (or after),
--     the requester as a counter, and either side to reschedule an
--     already-accepted booking. Only one proposal is live at a time; the
--     other party accepts or declines it.
alter table requests add column if not exists proposed_date date;
alter table requests add column if not exists proposed_start_time text;
alter table requests add column if not exists proposed_note text;
alter table requests add column if not exists proposed_by uuid references families(id) on delete set null;

-- Any status change out of offered/accepted, or a change of helper
-- (retract, decline, back out, cancel, expire), makes a pending proposal
-- meaningless — clear it here instead of in every RPC that does that.
create or replace function clear_stale_time_proposal()
returns trigger language plpgsql as $$
begin
  if new.proposed_date is not null and (
    new.status not in ('offered', 'accepted')
    or new.fulfilling_family_id is distinct from old.fulfilling_family_id
  ) then
    new.proposed_date := null;
    new.proposed_start_time := null;
    new.proposed_note := null;
    new.proposed_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_clear_stale_time_proposal on requests;
create trigger trg_clear_stale_time_proposal
  before update on requests
  for each row execute function clear_stale_time_proposal();

create or replace function propose_request_time(
  p_request_id uuid, p_date date, p_start_time text, p_note text default null
)
returns void language plpgsql security definer as $$
declare
  v_me  uuid;
  v_req requests%rowtype;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_date is null or p_date < current_date then raise exception 'Pick a date that hasn''t passed yet'; end if;
  if coalesce(trim(p_start_time), '') = '' then raise exception 'Pick a time'; end if;

  select * into v_req from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;

  if v_req.status = 'open' then
    if v_req.requesting_family_id = v_me then
      raise exception 'Edit your own request to change its time';
    end if;
    -- Same connection/block checks as a plain offer.
    perform offer_request(p_request_id, v_me);
  elsif v_req.status in ('offered', 'accepted') then
    if not (v_me = v_req.requesting_family_id or v_me = coalesce(v_req.fulfilling_family_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
      raise exception 'Not authorized to reschedule this request';
    end if;
    if v_req.status = 'accepted' and v_req.settled_at is not null then
      raise exception 'This one already settled';
    end if;
  else
    raise exception 'This request can''t be rescheduled';
  end if;

  update requests set
    proposed_date = p_date,
    proposed_start_time = trim(p_start_time),
    proposed_note = nullif(trim(coalesce(p_note, '')), ''),
    proposed_by = v_me
  where id = p_request_id;
end;
$$;
grant execute on function propose_request_time(uuid, date, text, text) to authenticated;

create or replace function respond_to_time_proposal(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer as $$
declare
  v_me        uuid;
  v_req       requests%rowtype;
  v_shift     integer;
  v_payer     uuid;
  v_projected numeric;
begin
  v_me := current_family_id();
  if v_me is null then raise exception 'Not authenticated'; end if;

  select * into v_req from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.proposed_date is null then raise exception 'No time change is pending'; end if;
  if v_req.status not in ('offered', 'accepted') then raise exception 'This request can''t be rescheduled'; end if;
  if not (v_me = v_req.requesting_family_id or v_me = v_req.fulfilling_family_id or is_admin()) then
    raise exception 'Not authorized to respond';
  end if;
  if v_me = v_req.proposed_by then raise exception 'Waiting on the other person to respond'; end if;

  if not p_accept then
    if v_req.status = 'offered' then
      -- The offer was only ever for that time — declining it releases the
      -- request back to the board (the trigger clears the proposal).
      update requests set status = 'open', fulfilling_family_id = null where id = p_request_id;
    else
      -- Accepted booking: the original time stands.
      update requests set proposed_date = null, proposed_start_time = null, proposed_note = null, proposed_by = null
        where id = p_request_id;
    end if;
    return;
  end if;

  -- offered → accepted needs the same balance guard approve_offer has.
  if v_req.status = 'offered' then
    v_payer := case when v_req.post_type = 'request' then v_req.requesting_family_id else v_req.fulfilling_family_id end;
    select hours_balance + pending_hours_delta(v_payer) into v_projected
      from families where id = v_payer for update;
    if v_projected < -20 then
      raise exception 'Balance would drop below -20 once outstanding commitments settle';
    end if;
  end if;

  v_shift := v_req.proposed_date - v_req.date;
  update requests set
    date = proposed_date,
    start_time = proposed_start_time,
    -- Overnight keeps its length; a flexible window collapses to the
    -- agreed day.
    end_date = case when is_overnight and end_date is not null then end_date + v_shift else null end,
    category_details = case when category_details is null then null else category_details - 'timing_flexible' end,
    status = case when status = 'offered' then 'accepted' else status end,
    reminder_sent = false,
    sit_reminder_sent = false,
    proposed_date = null, proposed_start_time = null, proposed_note = null, proposed_by = null
  where id = p_request_id;
end;
$$;
grant execute on function respond_to_time_proposal(uuid, boolean) to authenticated;

-- 95. approve_offer: if the helper suggested a different time, approving
--     "as posted" would silently book them for a time they said they
--     can't do. Make the requester answer the suggestion instead.
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
  if v_request.proposed_date is not null then
    raise exception 'A different time was suggested — accept or decline that first';
  end if;

  select hours_balance + pending_hours_delta(v_request.requesting_family_id) into v_projected
    from families where id = v_request.requesting_family_id for update;
  if v_projected < -20 then
    raise exception 'Balance would drop below -20 once outstanding commitments settle';
  end if;

  update requests set status = 'accepted' where id = p_request_id;
end;
$$;
