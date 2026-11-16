import type { PoolClient } from 'pg';

export interface AuditEvent {
  clinicId: string;
  userId: string | null;
  action: string; // ex.: patient.view, clinical.sign, record.export
  entity: string;
  entityId?: string | null;
  patientId?: string | null;
  /** Somente identificadores e rótulos. Nunca conteúdo clínico (REQ-36). */
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * REQ-07: registra quem abriu, criou, alterou ou exportou cada prontuário.
 * Roda na mesma transação da operação: se a auditoria falhar, a operação é desfeita.
 */
export async function audit(db: PoolClient, e: AuditEvent): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, patient_id, metadata, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.clinicId, e.userId, e.action, e.entity, e.entityId ?? null, e.patientId ?? null, e.metadata ?? {}, e.ip ?? null],
  );
}
