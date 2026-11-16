-- Fichaclin — schema inicial.
-- Requisitos referenciados: docs/conformidade/MATRIZ.md
-- Executado com o papel dono (fichaclin_owner). A aplicação usa fichaclin_app,
-- que não é dono das tabelas e por isso está sujeito ao RLS (REQ-26).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Contexto da requisição (setado pela API em cada transação — ver src/db/tenant.ts)
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_clinic_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.clinic_id', true), '')::uuid $$;

CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- REQ-05: prontuário e pacientes nunca são apagados.
CREATE FUNCTION prevent_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Exclusão proibida em % (REQ-05: guarda mínima de 20 anos; use inativação)', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- ---------------------------------------------------------------------------
-- Tabelas globais (sem dados de pacientes)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE CHECK (email = lower(email)),
  name           text NOT NULL,
  cro            text,                              -- REQ-19: CRO do dentista nos registros
  password_hash  text NOT NULL,                     -- REQ-23: argon2id
  totp_secret    text,                              -- REQ-24
  totp_enabled   boolean NOT NULL DEFAULT false,
  failed_logins  integer NOT NULL DEFAULT 0,        -- REQ-25
  locked_until   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  token_hash    text NOT NULL UNIQUE,
  clinic_id     uuid,
  mfa_verified  boolean NOT NULL DEFAULT false,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);

-- REQ-02 / REQ-03 / REQ-34: documentos legais versionados.
CREATE TABLE legal_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('terms', 'privacy', 'dpa')),
  version       integer NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

-- REQ-03: prova de aceite (versão, data, IP, usuário). Imutável.
CREATE TABLE legal_acceptances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES legal_documents(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  clinic_id    uuid,                                 -- preenchido no aceite do DPA (REQ-02)
  ip           text,
  user_agent   text,
  accepted_at  timestamptz NOT NULL DEFAULT now()
);

-- REQ-08: registros de acesso (Marco Civil art. 15), guardados por 6 meses.
CREATE TABLE access_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid,
  clinic_id   uuid,
  ip          text,
  method      text NOT NULL,
  route       text NOT NULL,
  status      integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_log_created_at_idx ON access_log (created_at);

CREATE FUNCTION purge_access_log() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM access_log WHERE created_at < now() - interval '6 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- Consultórios e vínculos
-- ---------------------------------------------------------------------------
CREATE TABLE clinics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  legal_name            text,              -- REQ-31: razão social do controlador
  cnpj                  text,
  tech_lead_name        text,              -- REQ-31: responsável técnico
  tech_lead_cro         text,
  phone                 text,
  email                 text,
  address               jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_status        text NOT NULL DEFAULT 'trial'
                          CHECK (billing_status IN ('trial', 'active', 'suspended')),  -- REQ-32
  plan                  text NOT NULL DEFAULT 'essencial',
  trial_ends_at         timestamptz,
  reminder_legal_basis  text CHECK (reminder_legal_basis IN ('tutela_saude', 'consentimento')), -- REQ-16
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  role         text NOT NULL CHECK (role IN ('owner', 'dentist', 'reception')), -- REQ-22
  permissions  text[],                    -- NULL = padrão do papel
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, user_id)
);

-- REQ-30: acesso do suporte só com autorização do consultório.
CREATE TABLE support_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  granted_by  uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Pacientes (dados de saúde — dados sensíveis, LGPD art. 5º II)
-- ---------------------------------------------------------------------------
CREATE TABLE patients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  full_name       text NOT NULL,
  social_name     text,
  birth_date      date NOT NULL,                 -- REQ-11: obrigatória para calcular a idade
  cpf             text,
  sex             text,
  profession      text,
  marital_status  text,
  phone           text,
  email           text,
  address         jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes           text,
  guardian        jsonb,                         -- REQ-11: responsável legal do menor
  active          boolean NOT NULL DEFAULT true, -- REQ-05: inativar em vez de excluir
  inactivated_at  timestamptz,
  inactivated_by  uuid REFERENCES users(id),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_clinic_idx ON patients (clinic_id, full_name);

-- REQ-15: consentimentos separados, versionados, com quem coletou. Histórico só de inserção.
CREATE TABLE patient_consents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id),
  patient_id          uuid NOT NULL REFERENCES patients(id),
  purpose             text NOT NULL CHECK (purpose IN ('marketing', 'image', 'research')),
  granted             boolean NOT NULL,
  text_version        text NOT NULL,
  granted_by_name     text NOT NULL,              -- REQ-12: responsável, se menor
  granted_by_relation text NOT NULL CHECK (granted_by_relation IN ('paciente', 'responsavel')),
  collected_by        uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- REQ-21: modelos de anamnese versionados.
CREATE TABLE anamnesis_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  version     integer NOT NULL,
  title       text NOT NULL,
  questions   jsonb NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, version)
);

-- REQ-21: resposta guarda a versão do modelo e é imutável.
CREATE TABLE anamnesis_responses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id),
  patient_id          uuid NOT NULL REFERENCES patients(id),
  template_id         uuid NOT NULL REFERENCES anamnesis_templates(id),
  template_version    integer NOT NULL,
  questions_snapshot  jsonb NOT NULL,
  answers             jsonb NOT NULL,
  author_id           uuid NOT NULL REFERENCES users(id),
  signed_by_name      text NOT NULL,
  signed_by_relation  text NOT NULL CHECK (signed_by_relation IN ('paciente', 'responsavel')),
  content_hash        text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- REQ-19 / REQ-04: evolução e odontograma. Imutável após assinatura; correção por adendo.
CREATE TABLE clinical_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id),
  patient_id        uuid NOT NULL REFERENCES patients(id),
  kind              text NOT NULL CHECK (kind IN ('evolution', 'odontogram', 'addendum')),
  content           jsonb NOT NULL,
  author_id         uuid NOT NULL REFERENCES users(id),
  author_name       text NOT NULL,
  author_cro        text,
  amends_id         uuid REFERENCES clinical_entries(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  signed_at         timestamptz,
  content_hash      text,
  signature_method  text CHECK (signature_method IN ('simples-2fa', 'icp-brasil')),
  CHECK (kind <> 'addendum' OR amends_id IS NOT NULL),
  CHECK ((signed_at IS NULL) = (content_hash IS NULL))
);
CREATE INDEX clinical_entries_patient_idx ON clinical_entries (patient_id, created_at);

CREATE FUNCTION lock_signed_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Registro clínico assinado não pode ser alterado (REQ-19: use adendo)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.clinic_id <> OLD.clinic_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Campos de autoria e vínculo são imutáveis (REQ-19)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION prevent_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro imutável em % (REQ-07/REQ-21)', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- ---------------------------------------------------------------------------
-- REQ-07: log de auditoria imutável com encadeamento de hash por consultório.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid,
  patient_id  uuid,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- só IDs e rótulos; nunca conteúdo clínico (REQ-36)
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash   text,
  hash        text NOT NULL
);
CREATE INDEX audit_log_patient_idx ON audit_log (clinic_id, patient_id, created_at DESC);

CREATE FUNCTION audit_row_hash(p_prev text, r audit_log) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(
    coalesce(p_prev, '') || '|' || r.clinic_id || '|' || coalesce(r.user_id::text, '') || '|' ||
    r.action || '|' || r.entity || '|' || coalesce(r.entity_id::text, '') || '|' ||
    coalesce(r.patient_id::text, '') || '|' || r.metadata::text || '|' ||
    to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'sha256'), 'hex')
$$;

CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.clinic_id::text, 0));
  SELECT hash INTO NEW.prev_hash FROM audit_log
   WHERE clinic_id = NEW.clinic_id ORDER BY id DESC LIMIT 1;
  NEW.hash := audit_row_hash(NEW.prev_hash, NEW);
  RETURN NEW;
END $$;

-- Recalcula a cadeia do consultório; retorna o id do primeiro registro adulterado ou NULL.
CREATE FUNCTION verify_audit_chain(p_clinic uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE r audit_log; prev text := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_log WHERE clinic_id = p_clinic ORDER BY id LOOP
    IF r.prev_hash IS DISTINCT FROM prev OR r.hash <> audit_row_hash(prev, r) THEN
      RETURN r.id;
    END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Gatilhos de imutabilidade
-- ---------------------------------------------------------------------------
CREATE TRIGGER patients_no_delete BEFORE DELETE ON patients FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER consents_no_delete BEFORE DELETE ON patient_consents FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER consents_no_update BEFORE UPDATE ON patient_consents FOR EACH ROW EXECUTE FUNCTION prevent_update();
CREATE TRIGGER entries_no_delete BEFORE DELETE ON clinical_entries FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER entries_lock BEFORE UPDATE ON clinical_entries FOR EACH ROW EXECUTE FUNCTION lock_signed_entry();
CREATE TRIGGER anamnesis_no_delete BEFORE DELETE ON anamnesis_responses FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER anamnesis_no_update BEFORE UPDATE ON anamnesis_responses FOR EACH ROW EXECUTE FUNCTION prevent_update();
CREATE TRIGGER templates_no_delete BEFORE DELETE ON anamnesis_templates FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER templates_no_update BEFORE UPDATE ON anamnesis_templates FOR EACH ROW EXECUTE FUNCTION prevent_update();
CREATE TRIGGER audit_chain_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_chain();
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION prevent_update();
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER acceptances_no_update BEFORE UPDATE ON legal_acceptances FOR EACH ROW EXECUTE FUNCTION prevent_update();

-- ---------------------------------------------------------------------------
-- REQ-26: Row Level Security por consultório
-- ---------------------------------------------------------------------------
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinics_member ON clinics
  USING (id = app_clinic_id()
         OR EXISTS (SELECT 1 FROM memberships m
                     WHERE m.clinic_id = clinics.id AND m.user_id = app_user_id() AND m.active))
  WITH CHECK (id = app_clinic_id());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_scope ON memberships
  USING (clinic_id = app_clinic_id() OR user_id = app_user_id())
  WITH CHECK (clinic_id = app_clinic_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_grants', 'patients', 'patient_consents', 'anamnesis_templates',
                           'anamnesis_responses', 'clinical_entries', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) '
                   'WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Permissões do papel da aplicação (mínimo necessário)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO fichaclin_app;
GRANT SELECT, INSERT, UPDATE ON users, sessions TO fichaclin_app;
GRANT SELECT ON legal_documents TO fichaclin_app;
GRANT SELECT, INSERT ON legal_acceptances TO fichaclin_app;
GRANT INSERT ON access_log TO fichaclin_app;
GRANT SELECT, UPDATE ON clinics TO fichaclin_app;
GRANT SELECT, INSERT, UPDATE ON memberships, support_grants, patients, clinical_entries TO fichaclin_app;
GRANT SELECT, INSERT ON patient_consents, anamnesis_templates, anamnesis_responses, audit_log TO fichaclin_app;
GRANT USAGE ON SEQUENCE access_log_id_seq, audit_log_id_seq TO fichaclin_app;
GRANT EXECUTE ON FUNCTION purge_access_log() TO fichaclin_app;
