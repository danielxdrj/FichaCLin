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

/**
 * REQ-24 — DIVERGÊNCIA DOCUMENTADA (decisão de produto, 16/11/2026):
 * o PDF recomenda 2FA obrigatório para dono e dentista; o Fichaclin torna o 2FA opcional.
 * É exigido quando o próprio usuário ativou, ou quando algum consultório ao qual ele
 * está vinculado exige 2FA de todos os usuários (configuração do controlador).
 */
export function requiresMfa(opts: { userEnabled: boolean; clinicRequires: boolean }): boolean {
  return opts.userEnabled || opts.clinicRequires;
}
