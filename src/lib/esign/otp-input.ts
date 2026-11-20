/**
 * What goes into the one-time-code box. Typing keeps digits only. A paste of
 * a whole line ("Your code for Agreement 2026 is 123456") takes the six-digit
 * number rather than the first six digits it meets.
 */
export function codeFromInput(value: string): string {
  const six = value.match(/(?:^|\D)(\d{6})(?!\d)/);
  if (six) return six[1];
  return value.replace(/\D/g, "").slice(0, 6);
}
