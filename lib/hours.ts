import { supabase } from './supabase';

type PendingRow = {
  post_type: string;
  status: string;
  duration_hours: number;
  requesting_family_id: string;
  fulfilling_family_id: string | null;
  settled_at: string | null;
};

async function fetchPendingRows(familyId: string): Promise<PendingRow[]> {
  const { data } = await supabase
    .from('requests')
    .select('post_type, status, duration_hours, requesting_family_id, fulfilling_family_id, settled_at')
    .or(`requesting_family_id.eq.${familyId},fulfilling_family_id.eq.${familyId}`)
    .or('status.in.(open,offered),and(status.eq.accepted,settled_at.is.null)');
  return data ?? [];
}

// A request/offering only actually moves hours once it auto-settles on its
// scheduled date — open, offered, and accepted-but-unsettled requests are
// all still just a liability or gain sitting outside hours_balance. This
// adds those up so the UI (and the new-request block) can show what
// balance would be if everything outstanding resolved, instead of a raw
// balance that looks healthier than it really is.
export async function getPendingDelta(familyId: string): Promise<number> {
  const rows = await fetchPendingRows(familyId);
  let delta = 0;
  for (const r of rows) {
    const iAmRequester = r.requesting_family_id === familyId;
    const iAmFulfiller = r.fulfilling_family_id === familyId;
    // post_type 'request': hours flow requester → fulfiller on accept.
    // post_type 'offering': reversed — flow claimer → poster on approve.
    if (r.post_type === 'request') {
      if (iAmRequester) delta -= r.duration_hours;
      else if (iAmFulfiller) delta += r.duration_hours;
    } else {
      if (iAmRequester) delta += r.duration_hours;
      else if (iAmFulfiller) delta -= r.duration_hours;
    }
  }
  return delta;
}

// Same underlying rows as getPendingDelta, split into the two directions
// instead of netted together — "on the way" (you offered to help, hours
// land once the other person accepts) vs "possible spend" (your own open
// requests, hours leave once someone fulfills them).
export async function getPendingBreakdown(familyId: string): Promise<{ incoming: number; outgoing: number }> {
  const rows = await fetchPendingRows(familyId);
  let incoming = 0;
  let outgoing = 0;
  for (const r of rows) {
    const iAmRequester = r.requesting_family_id === familyId;
    const iAmFulfiller = r.fulfilling_family_id === familyId;
    if (r.post_type === 'request') {
      if (iAmRequester) outgoing += r.duration_hours;
      else if (iAmFulfiller) incoming += r.duration_hours;
    } else {
      if (iAmRequester) incoming += r.duration_hours;
      else if (iAmFulfiller) outgoing += r.duration_hours;
    }
  }
  return { incoming, outgoing };
}
