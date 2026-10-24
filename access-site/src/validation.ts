import { RESERVED_PREFIXES } from './eligibility';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'\-]*$/u;
// Lowercase letters, digits, hyphens; dots only between other characters.
const PREFIX_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;

export function validateName(raw: unknown, label: string): ValidationResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: `${label} is required.` };
  const value = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 60) {
    return { ok: false, error: `${label} must be 1 to 60 characters.` };
  }
  if (!NAME_PATTERN.test(value)) {
    return {
      ok: false,
      error: `${label} can contain letters, spaces, hyphens, apostrophes and dots.`,
    };
  }
  return { ok: true, value };
}

export function validatePrefix(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Email name is required.' };
  const value = raw.trim().toLowerCase();
  if (value.length < 2 || value.length > 30) {
    return { ok: false, error: 'Email name must be 2 to 30 characters.' };
  }
  if (!PREFIX_PATTERN.test(value) || value.endsWith('-')) {
    return {
      ok: false,
      error:
        'Email name can use lowercase letters, digits, hyphens and single dots, and must start with a letter.',
    };
  }
  if (RESERVED_PREFIXES.has(value)) {
    return { ok: false, error: `"${value}" is reserved. Please pick another.` };
  }
  return { ok: true, value };
}

/** Best-effort default email name from a GitHub login. */
export function suggestPrefix(login: string): string {
  const cleaned = login
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 30);
  return cleaned.length >= 2 ? cleaned : '';
}

/** Splits a GitHub display name into first and last name, best effort. */
export function splitName(fullName: string | null | undefined): { first: string; last: string } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}
