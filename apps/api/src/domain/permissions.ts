/**
 * REQ-22: papéis mínimos (dono, dentista, recepção) e recepção sem acesso
 * a dados clínicos por padrão. O dono pode ajustar permissões por usuário;
 * toda alteração é auditada (`membership.permissions_changed`).
 */
export const PERMISSIONS = [
  'patients:read',
  'patients:write',
  'clinical:read',
  'clinical:write',
  'anamnesis:template',
  'export',
  'users:manage',
  'clinic:manage',
  'audit:read',
  'support:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = 'owner' | 'dentist' | 'reception';

export const ROLE_DEFAULTS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  dentist: ['patients:read', 'patients:write', 'clinical:read', 'clinical:write', 'anamnesis:template', 'export'],
  reception: ['patients:read', 'patients:write'],
};

/** Permissões que nunca podem ser concedidas fora do papel dono. */
const OWNER_ONLY: readonly Permission[] = ['users:manage', 'clinic:manage', 'audit:read', 'support:manage'];

export function effectivePermissions(role: Role, custom: string[] | null | undefined): Permission[] {
  if (!custom) return [...ROLE_DEFAULTS[role]];
  const valid = custom.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
  if (role === 'owner') return [...PERMISSIONS];
  return valid.filter((p) => !OWNER_ONLY.includes(p));
}

export function can(perms: readonly Permission[], needed: Permission): boolean {
  return perms.includes(needed);
}

/** REQ-24: 2FA obrigatório para dentistas e administradores. */
export function requiresMfa(roles: Role[]): boolean {
  return roles.some((r) => r === 'owner' || r === 'dentist');
}
