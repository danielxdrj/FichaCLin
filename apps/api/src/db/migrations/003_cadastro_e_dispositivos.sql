-- Cadastro do próprio cliente (teste grátis de 7 dias) e "não solicitar 2FA neste dispositivo".

-- O cadastro cria o consultório com o papel da aplicação; o RLS continua valendo:
-- a API seta app.clinic_id com o id do novo consultório antes de inserir (WITH CHECK).
GRANT INSERT ON clinics TO fichaclin_app;

-- Dispositivos confiáveis: com 2FA ativado, o código não é pedido de novo neste navegador
-- até o prazo vencer, o usuário revogar ou desativar o 2FA. Só o hash do token fica no banco.
CREATE TABLE trusted_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE,
  user_agent  text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX trusted_devices_user_idx ON trusted_devices (user_id);
GRANT SELECT, INSERT, UPDATE ON trusted_devices TO fichaclin_app;
