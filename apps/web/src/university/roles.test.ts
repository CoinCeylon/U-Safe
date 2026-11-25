import { describe, expect, it } from 'vitest';
import { canAccess, ruleForPath, ROUTE_RULES, rulesForRole } from './roles';

describe('M063 university role guards', () => {
  it('denies a seeded investigator access to registrar pages', () => {
    const roster = ruleForPath('/roster');
    expect(roster).not.toBeNull();
    expect(canAccess('investigator', roster?.roles ?? [])).toBe(false);
  });

  it('denies a seeded registrar access to investigator pages', () => {
    const complaints = ruleForPath('/complaints');
    expect(complaints).not.toBeNull();
    expect(canAccess('registrar', complaints?.roles ?? [])).toBe(false);
  });

  it('denies an unknown role every route', () => {
    for (const rule of ROUTE_RULES) {
      expect(canAccess('ugc_officer', rule.roles)).toBe(false);
      expect(canAccess(null, rule.roles)).toBe(false);
      expect(canAccess(undefined, rule.roles)).toBe(false);
    }
  });

  it('lets an admin open every route', () => {
    for (const rule of ROUTE_RULES) {
      expect(canAccess('admin', rule.roles)).toBe(true);
    }
  });

  it('lets each role open its own pages', () => {
    const complaints = ruleForPath('/complaints')?.roles ?? [];
    const roster = ruleForPath('/roster')?.roles ?? [];
    expect(canAccess('investigator', complaints)).toBe(true);
    expect(canAccess('registrar', roster)).toBe(true);
  });

  it('builds navigation from the role rules', () => {
    expect(rulesForRole('investigator').map((rule) => rule.path)).toEqual([
      '/',
      '/complaints',
      '/keys',
    ]);
    expect(rulesForRole('registrar').map((rule) => rule.path)).toEqual([
      '/',
      '/roster',
      '/keys',
    ]);
    expect(rulesForRole('admin').map((rule) => rule.path)).toEqual([
      '/',
      '/complaints',
      '/roster',
      '/keys',
    ]);
  });

  it('returns null for unknown paths', () => {
    expect(ruleForPath('/nope')).toBeNull();
  });
});
