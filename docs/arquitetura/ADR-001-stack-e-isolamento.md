# ADR-001 — Stack, isolamento por consultório e imutabilidade

- **Data:** 16/11/2026
- **Status:** Aceita
- **Requisitos de origem:** REQ-05, REQ-07, REQ-08, REQ-19, REQ-21, REQ-23, REQ-24, REQ-26 ([matriz](../conformidade/MATRIZ.md))

## Contexto

O PDF de requisitos descreve um SaaS multi-consultório (~10 consultórios na largada), hospedado em VPS
com Docker/Portainer e migração futura para AWS (região sa-east-1). Os dados são de saúde (sensíveis) e
o prontuário tem guarda mínima de 20 anos, com registros não editáveis após assinatura.

O documento de arquitetura no Figma ("FORGE — Documento de Arquitetura") descreve a plataforma FORGE de
agentes; ele não fixa a stack do Fichaclin. A página "Fichaclin — Protótipo MVP" fixa as 13 telas.

## Decisão

| Camada | Escolha | Motivo |
|---|---|---|
| Banco | PostgreSQL 16 | RLS nativo (REQ-26), gatilhos para imutabilidade (REQ-05/07/19/21), roda em Docker e no RDS |
| API | Node.js 22 + Fastify + TypeScript, SQL direto com `pg` | Controle total da transação para setar `app.clinic_id` antes de cada consulta |
| Senha | argon2id | Exigência explícita do PDF (REQ-23) |
| 2FA | TOTP (RFC 6238) | Funciona com qualquer app autenticador; obrigatório para dono e dentista (REQ-24) |
| Sessão | Cookie `HttpOnly` + `SameSite=Lax` com token opaco guardado em hash no banco | Revogável; sem segredo no navegador |
| Web | React + Vite + TypeScript, CSS com tokens (claro/escuro) | Reproduz o protótipo do Figma |
| Deploy | `docker compose` (db + api + web) | Compatível com Portainer |

### Isolamento por consultório (REQ-26)

- A API conecta com o papel `fichaclin_app`, que **não** é dono das tabelas e não tem `BYPASSRLS`.
- Cada requisição autenticada abre uma transação e executa
  `set_config('app.clinic_id', <id>, true)` e `set_config('app.user_id', <id>, true)`.
- Toda tabela com dados de consultório tem `ENABLE ROW LEVEL SECURITY` e política
  `clinic_id = app_clinic_id()` (lê `current_setting('app.clinic_id')`). Como `fichaclin_app` não é
  dono das tabelas, o RLS sempre se aplica a ele; o papel dono só é usado em migrações e no seed.
- Um bug de filtro na aplicação não vaza dados entre consultórios, pois o próprio banco filtra.

### Imutabilidade (REQ-05, REQ-07, REQ-19, REQ-21)

- `patients`, `clinical_entries`, `anamnesis_responses`: gatilho rejeita `DELETE`.
- `clinical_entries`: gatilho rejeita `UPDATE` quando `signed_at` não é nulo; correção = novo registro com `amends_id`.
- `anamnesis_responses`: gatilho rejeita qualquer `UPDATE`.
- `audit_log`: gatilho rejeita `UPDATE`/`DELETE`; cada linha guarda `prev_hash` e `hash` (encadeamento por consultório),
  o que torna adulteração detectável mesmo por quem tem acesso de superusuário.

### Logs de acesso (REQ-08)

`access_log` guarda IP, data/hora, usuário e rota por requisição. `purge_access_log()` remove registros com
mais de 6 meses e é chamada periodicamente pela API.

## Consequências

- Migrações rodam com um papel dono (`fichaclin_owner`); a aplicação nunca usa esse papel.
- Não é possível "corrigir" um registro assinado direto no banco sem desabilitar gatilhos — intencional.
- Itens de infraestrutura (TLS, criptografia de disco, backup externo, região Brasil) ficam fora deste
  repositório e estão marcados como pendentes na matriz (REQ-27, REQ-28, REQ-29, REQ-13).
- Assinatura ICP-Brasil (PAdES) fica para a fase 2 (REQ-04).
