import { todayString } from './utils';
import type { Request } from '../types';

// Completed (and expired) requests stay visible — greyed, at the bottom —
// for this many days, then move to the archive.
export const ARCHIVE_AFTER_DAYS = 7;

type Dated = Pick<Request, 'status' | 'date' | 'end_date'>;

export function lastDay(r: Pick<Request, 'date' | 'end_date'>): string {
  return r.end_date ?? r.date;
}

// The server flips these to 'expired' once a day (expire_stale_requests);
// this also catches the ones that passed since the last sweep so the UI
// never shows a dead request as live.
export function isExpired(r: Dated, today = todayString()): boolean {
  if (r.status === 'expired') return true;
  return (r.status === 'open' || r.status === 'offered') && lastDay(r) < today;
}

// When a request was "done" — completed (paid out), or expired.
function doneAt(r: Pick<Request, 'status' | 'date' | 'end_date' | 'settled_at' | 'expired_at'>): Date {
  const stamp = r.status === 'expired' ? r.expired_at : r.settled_at;
  return stamp ? new Date(stamp) : new Date(lastDay(r) + 'T23:59:59');
}

export function isArchived(r: Pick<Request, 'status' | 'date' | 'end_date' | 'settled_at' | 'expired_at'>): boolean {
  if (r.status !== 'completed' && !isExpired(r)) return false;
  return Date.now() - doneAt(r).getTime() > ARCHIVE_AFTER_DAYS * 86400000;
}

// A time suggestion the viewer has to answer.
export function proposalAwaitingMe(r: Pick<Request, 'proposed_date' | 'proposed_by' | 'requesting_family_id' | 'fulfilling_family_id'>, myId: string | undefined): boolean {
  if (!myId || !r.proposed_date || r.proposed_by === myId) return false;
  return r.requesting_family_id === myId || r.fulfilling_family_id === myId;
}

// Anything sitting on the viewer to act on — an offer to approve on their
// own post, or a time suggestion from the other side.
export function needsMyAction(r: Request, myId: string | undefined): boolean {
  if (!myId || isExpired(r)) return false;
  if (proposalAwaitingMe(r, myId)) return true;
  return r.status === 'offered' && r.requesting_family_id === myId && !r.proposed_date;
}

export function formatShortDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
