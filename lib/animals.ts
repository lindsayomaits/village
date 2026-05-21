export const ANIMALS = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐼', '🐨',
  '🐸', '🐧', '🦆', '🦉', '🦋', '🐢', '🐬', '🦭',
  '🦝', '🦔', '🐿️', '🦦', '🦌', '🐝', '🦜', '🦩',
  '🦚', '🐙', '🐠', '🦫',
];

export function getFamilyAnimal(familyId: string, chosen?: string | null): string {
  if (chosen) return chosen;
  let hash = 0;
  for (let i = 0; i < familyId.length; i++) {
    hash = ((hash << 5) - hash) + familyId.charCodeAt(i);
    hash |= 0;
  }
  return ANIMALS[Math.abs(hash) % ANIMALS.length];
}
