-- Rodada de refinamento: módulo de Suporte (chamados) e base da Agenda.
-- Isolamento por consultório (REQ-26) e auditoria (REQ-07) seguem as mesmas regras do schema inicial.

-- ---------------------------------------------------------------------------
-- Suporte: chamados
-- ---------------------------------------------------------------------------
CREATE TABLE support_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  number          integer NOT NULL,                 -- número sequencial por consultório (#12)
  category        text NOT NULL CHECK (category IN ('problema_tecnico', 'erro_funcionalidade', 'acesso',
                                                    'seguranca', 'duvida', 'orientacao', 'outro')),
  category_other  text,                             -- obrigatório quando category = 'outro'
  priority        text NOT NULL CHECK (priority IN ('baixa', 'normal', 'alta', 'critica')),
  subject         text NOT NULL,
  description     text NOT NULL,                    -- orientação na tela: não incluir dados de pacientes (REQ-36)
  status          text NOT NULL DEFAULT 'aberta'
                    CHECK (status IN ('aberta', 'em_analise', 'aguardando_cliente', 'resolvida', 'encerrada')),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  UNIQUE (clinic_id, number),
  CHECK (category <> 'outro' OR coalesce(length(trim(category_other)), 0) > 0)
);
CREATE INDEX support_tickets_clinic_idx ON support_tickets (clinic_id, created_at DESC);

-- Histórico do chamado (comentários e mudanças de situação). Só inserção.
CREATE TABLE support_ticket_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id),
  kind        text NOT NULL CHECK (kind IN ('comentario', 'status')),
  body        text,
  from_status text,
  to_status   text,
  author_id   uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_events_ticket_idx ON support_ticket_events (ticket_id, created_at);

-- Autorização de acesso do suporte (REQ-30): vínculo com o chamado e trilha completa.
ALTER TABLE support_grants
  ADD COLUMN ticket_id uuid REFERENCES support_tickets(id),
  ADD COLUMN revoked_by uuid REFERENCES users(id),
  ADD COLUMN expiry_audited boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Agenda: compromissos do consultório. NÃO é a timeline de auditoria.
-- Sem exclusão: compromisso é cancelado (status), preservando o histórico.
-- ---------------------------------------------------------------------------
CREATE TABLE agenda_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  kind             text NOT NULL CHECK (kind IN ('consulta', 'retorno', 'compromisso', 'lembrete')),
  title            text NOT NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  patient_id       uuid REFERENCES patients(id),
  professional_id  uuid REFERENCES users(id),
  status           text NOT NULL DEFAULT 'agendado'
                     CHECK (status IN ('agendado', 'confirmado', 'concluido', 'cancelado', 'faltou')),
  notes            text,                             -- administrativo; dados clínicos ficam no prontuário
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX agenda_events_clinic_time_idx ON agenda_events (clinic_id, starts_at);

-- ---------------------------------------------------------------------------
-- Imutabilidade, RLS e permissões do papel da aplicação
-- ---------------------------------------------------------------------------
CREATE TRIGGER tickets_no_delete BEFORE DELETE ON support_tickets FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER ticket_events_no_delete BEFORE DELETE ON support_ticket_events FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER ticket_events_no_update BEFORE UPDATE ON support_ticket_events FOR EACH ROW EXECUTE FUNCTION prevent_update();
CREATE TRIGGER agenda_no_delete BEFORE DELETE ON agenda_events FOR EACH ROW EXECUTE FUNCTION prevent_delete();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_tickets', 'support_ticket_events', 'agenda_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) '
                   'WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON support_tickets, agenda_events TO fichaclin_app;
GRANT SELECT, INSERT ON support_ticket_events TO fichaclin_app;
