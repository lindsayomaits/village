import type { Request } from '../types';

export type MentionEntry = { label: string; familyId: string; animal: string | null };

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'mention'; label: string; entry: MentionEntry }
  | { type: 'tag'; label: string; request: Request };

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Which trigger (@ for a person, # for a request) is being typed right now, if any.
export function getActiveTrigger(text: string, cursor: number): { type: '@' | '#'; query: string } | null {
  const before = text.slice(0, cursor);
  const match = before.match(/([@#])([^\s@#]*)$/);
  if (!match) return null;
  return { type: match[1] as '@' | '#', query: match[2] };
}

export function extractMentionedTargets(body: string, entries: MentionEntry[]): string[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => b.label.length - a.label.length);
  const pattern = new RegExp(`@(${sorted.map(e => escapeRegex(e.label)).join('|')})(?=\\s|$)`, 'g');
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    const entry = sorted.find(e => e.label === m![1]);
    if (entry) found.push(entry.familyId);
  }
  return found;
}

export function extractTaggedRequests(body: string, openRequests: Request[]): Request[] {
  if (openRequests.length === 0) return [];
  const sorted = [...openRequests].sort((a, b) => b.title.length - a.title.length);
  const pattern = new RegExp(`#(${sorted.map(r => escapeRegex(r.title)).join('|')})(?=\\s|$)`, 'g');
  const found: Request[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    const req = sorted.find(r => r.title === m![1]);
    if (req) found.push(req);
  }
  return found;
}

export function buildSegments(body: string, mentionEntries: MentionEntry[], openRequests: Request[]): Segment[] {
  const matches: { index: number; length: number; seg: Segment }[] = [];

  if (mentionEntries.length > 0) {
    const sorted = [...mentionEntries].sort((a, b) => b.label.length - a.label.length);
    const pattern = new RegExp(`@(${sorted.map(e => escapeRegex(e.label)).join('|')})(?=\\s|$)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(body)) !== null) {
      const entry = sorted.find(e => e.label === m![1]);
      if (entry) matches.push({ index: m.index, length: m[0].length, seg: { type: 'mention', label: m[0], entry } });
    }
  }

  if (openRequests.length > 0) {
    const sorted = [...openRequests].sort((a, b) => b.title.length - a.title.length);
    const pattern = new RegExp(`#(${sorted.map(r => escapeRegex(r.title)).join('|')})(?=\\s|$)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(body)) !== null) {
      const req = sorted.find(r => r.title === m![1]);
      if (req) matches.push({ index: m.index, length: m[0].length, seg: { type: 'tag', label: m[0], request: req } });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  const clean: typeof matches = [];
  let cursor = 0;
  for (const mm of matches) {
    if (mm.index < cursor) continue;
    clean.push(mm);
    cursor = mm.index + mm.length;
  }

  const segments: Segment[] = [];
  let last = 0;
  for (const mm of clean) {
    if (mm.index > last) segments.push({ type: 'text', text: body.slice(last, mm.index) });
    segments.push(mm.seg);
    last = mm.index + mm.length;
  }
  if (last < body.length) segments.push({ type: 'text', text: body.slice(last) });
  return segments;
}
