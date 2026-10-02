import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { needsMyAction } from './requestState';
import type { Request } from '../types';

// Requests waiting on this household — an offer to approve on their own
// post, or a time suggestion from the other side. Drives the Requests tab
// badge and the banner explaining it, so the number is never a mystery.
// `mine` = how many of those are the viewer's own posts (live in "Mine");
// the rest are ones they're helping with (live in "Scheduled").
export function useActionCount(familyId: string | undefined) {
  const [counts, setCounts] = useState({ total: 0, mine: 0 });

  const refresh = useCallback(async () => {
    if (!familyId) { setCounts({ total: 0, mine: 0 }); return; }
    const { data } = await supabase
      .from('requests')
      .select('id, status, date, end_date, requesting_family_id, fulfilling_family_id, proposed_date, proposed_by')
      .eq('post_type', 'request')
      .in('status', ['offered', 'accepted'])
      .or(`requesting_family_id.eq.${familyId},fulfilling_family_id.eq.${familyId}`);
    const pending = ((data ?? []) as Request[]).filter(r => needsMyAction(r, familyId));
    setCounts({ total: pending.length, mine: pending.filter(r => r.requesting_family_id === familyId).length });
  }, [familyId]);

  useEffect(() => {
    refresh();
    if (!familyId) return;
    const channel = supabase
      .channel(`action_count_${familyId}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [familyId, refresh]);

  return { ...counts, refresh };
}
