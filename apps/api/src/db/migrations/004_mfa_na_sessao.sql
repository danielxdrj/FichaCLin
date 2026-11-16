-- A exigência de 2FA é decidida no momento do login e gravada na sessão.
-- Assim, mudar a política do consultório não derruba quem já está usando o sistema:
-- a nova regra vale a partir do próximo login.
ALTER TABLE sessions ADD COLUMN mfa_required boolean NOT NULL DEFAULT false;
