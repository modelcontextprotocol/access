import { describe, expect, it } from 'vitest';
import { splitName, suggestPrefix, validateName, validatePrefix } from '../src/validation';
import { findMember, isEligible, teamsFor } from '../src/eligibility';
import { ineligibleMember, memberWithPrefix } from './helpers';

describe('validateName', () => {
  it('accepts unicode names and normalises whitespace', () => {
    expect(validateName('  José  María ', 'First name')).toEqual({ ok: true, value: 'José María' });
    expect(validateName("O'Brien-Smith", 'Last name').ok).toBe(true);
  });
  it('rejects empty, long and markup', () => {
    expect(validateName('', 'First name').ok).toBe(false);
    expect(validateName('a'.repeat(61), 'First name').ok).toBe(false);
    expect(validateName('<script>', 'First name').ok).toBe(false);
    expect(validateName(42, 'First name').ok).toBe(false);
  });
});

describe('validatePrefix', () => {
  it('accepts simple addresses', () => {
    expect(validatePrefix('Ada.Lovelace')).toEqual({ ok: true, value: 'ada.lovelace' });
    expect(validatePrefix('ada-l')).toEqual({ ok: true, value: 'ada-l' });
  });
  it('rejects bad shapes', () => {
    for (const bad of ['a', '1ada', 'ada..l', 'ada.', 'ada-', 'ada_l', 'ada l', 'x'.repeat(31)]) {
      expect(validatePrefix(bad).ok, bad).toBe(false);
    }
  });
  it('rejects reserved names and team slugs', () => {
    expect(validatePrefix('postmaster').ok).toBe(false);
    expect(validatePrefix('maintainers').ok).toBe(false);
    expect(validatePrefix('infrastructure-wg').ok).toBe(false);
  });
});

describe('helpers', () => {
  it('suggests a prefix from a login', () => {
    expect(suggestPrefix('Ada_Lovelace')).toBe('ada-lovelace');
    expect(suggestPrefix('42')).toBe('');
  });
  it('splits names', () => {
    expect(splitName('Ada King Lovelace')).toEqual({ first: 'Ada King', last: 'Lovelace' });
    expect(splitName(null)).toEqual({ first: '', last: '' });
  });
});

describe('eligibility from config', () => {
  it('matches logins case-insensitively and follows provisionUser', () => {
    const m = memberWithPrefix();
    expect(isEligible(findMember(m.github!.toUpperCase()))).toBe(true);
    expect(isEligible(findMember(ineligibleMember().github!))).toBe(false);
    expect(isEligible(findMember('definitely-not-a-configured-user'))).toBe(false);
  });
  it('includes parent teams', () => {
    const teams = teamsFor(findMember('sambhav'));
    expect(teams).toContain('infrastructure-wg');
    expect(teams).toContain('working-groups');
  });
});
