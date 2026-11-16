-- Decisão de produto de 16/11/2026: 2FA passa a ser opcional por usuário e pode ser
-- exigido pelo consultório. DIVERGE da recomendação do PDF (§6.3, REQ-24) — ver MATRIZ.md.

-- O consultório (controlador) decide se exige 2FA de todos os seus usuários.
ALTER TABLE clinics ADD COLUMN require_mfa boolean NOT NULL DEFAULT false;

-- Assinaturas feitas sem 2FA ficam identificadas como 'simples' (REQ-04).
ALTER TABLE clinical_entries DROP CONSTRAINT clinical_entries_signature_method_check;
ALTER TABLE clinical_entries ADD CONSTRAINT clinical_entries_signature_method_check
  CHECK (signature_method IN ('simples', 'simples-2fa', 'icp-brasil'));
