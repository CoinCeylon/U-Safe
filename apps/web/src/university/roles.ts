/**
 * Role guard map for the university portal (M063). Every route lists the
 * staff roles that may open it; the guard wrapper in main.ts enforces this
 * before the route handler runs.
 *
 * - registrar: roster and enrollment
 * - investigator: complaints and status
 * - admin: everything, plus keys
 */

export type StaffRole = 'registrar' | 'investigator' | 'admin';

export const STAFF_ROLES: readonly StaffRole[] = [
  'registrar',
  'investigator',
  'admin',
];

export interface RouteRoleRule {
  /** Route hash path, for example '/roster'. */
  path: string;
  /** Roles allowed to open the route. An empty list allows nobody. */
  roles: readonly StaffRole[];
  /** Human label shown in the navigation and access-denied view. */
  label: string;
}

export const ROUTE_RULES: readonly RouteRoleRule[] = [
  { path: '/', label: 'Home', roles: STAFF_ROLES },
  {
    path: '/complaints',
    label: 'Complaints',
    roles: ['investigator', 'admin'],
  },
  { path: '/roster', label: 'Roster', roles: ['registrar', 'admin'] },
  { path: '/keys', label: 'Keys', roles: ['admin'] },
];

/** Returns the rule for an exact path, or null when the path is unknown. */
export const ruleForPath = (path: string): RouteRoleRule | null =>
  ROUTE_RULES.find((rule) => rule.path === path) ?? null;

/** True when the staff role appears in the allowed roles list. */
export const canAccess = (
  role: string | null | undefined,
  allowed: readonly StaffRole[],
): boolean =>
  role !== null && role !== undefined && allowed.includes(role as StaffRole);

/** All rules a given staff role may open; used to build the navigation. */
export const rulesForRole = (
  role: string | null | undefined,
): RouteRoleRule[] => ROUTE_RULES.filter((rule) => canAccess(role, rule.roles));
