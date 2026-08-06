export function lastNamesLabel(f: { name: string; parent1_name: string | null; parent2_name: string | null }): string {
  const lastName = (full: string) => full.trim().split(/\s+/).pop() ?? '';
  const l1 = f.parent1_name ? lastName(f.parent1_name) : '';
  const l2 = f.parent2_name ? lastName(f.parent2_name) : '';
  if (l1 && l2) return l1 === l2 ? l1 : `${l1} & ${l2}`;
  return l1 || l2 || f.name;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function calcAge(birthday: string): number {
  const today = new Date();
  const bday = new Date(birthday + 'T00:00:00');
  let age = today.getFullYear() - bday.getFullYear();
  const m = today.getMonth() - bday.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bday.getDate())) age--;
  return Math.max(0, age);
}

export function displayKidsData(kids: { name: string; birthday: string | null }[]): string {
  return kids
    .filter(k => k.name.trim())
    .map(k => k.birthday ? `${k.name.trim()} (age ${calcAge(k.birthday)})` : k.name.trim())
    .join(', ');
}

export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

// Replaces birth year patterns with calculated age.
// Supports: "born 2018", "(born 2018)", "b. 2018-03", "dob 2018/03/15", "(2018)"
export function renderKidsInfo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const currentYear = new Date().getFullYear();

  return raw.replace(
    /(?:born|b\.|dob)[:\s]+(\d{4})(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?|\(born\s+(\d{4})(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?\)|\b(20[01]\d|199\d)\b/gi,
    (match, y1, y2, y3) => {
      const year = parseInt(y1 ?? y2 ?? y3, 10);
      if (isNaN(year) || year < 1990 || year > currentYear) return match;
      const age = currentYear - year;
      // If the original was a standalone year in parens, replace the whole thing
      if (/^\(20[01]\d\)$|^(199\d)$/.test(match.trim())) return `(age ${age})`;
      return `age ${age}`;
    }
  );
}
