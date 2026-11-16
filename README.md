# Fichaclin

SaaS de prontuário odontológico multi-consultório (projeto FORGE / Fichaclin — Protótipo MVP).

> **Aviso.** Este software implementa controles técnicos derivados do documento
> [`docs/conformidade/Fichaclin_Requisitos_Legais.pdf`](docs/conformidade/Fichaclin_Requisitos_Legais.pdf).
> Implementar um controle **não** significa conformidade legal. O status de cada requisito
> (implementado, parcial, pendente ou dependente de validação jurídica) está na
> [matriz de conformidade](docs/conformidade/MATRIZ.md).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `apps/api` | API em Node.js + Fastify + PostgreSQL (RLS por consultório) |
| `apps/web` | Interface em React + Vite (telas do protótipo do Figma) |
| `docs/conformidade` | PDF de requisitos legais, matriz de conformidade, dúvidas jurídicas |
| `docs/arquitetura` | Decisões de arquitetura (ADRs) |

## Rodando localmente

Pré-requisitos: Node.js 22+, Docker.

```bash
npm install
docker compose up -d db          # PostgreSQL 16 local
npm run db:migrate               # cria tabelas, RLS e gatilhos
npm run db:seed                  # dados FICTÍCIOS de desenvolvimento
npm run dev                      # API em :3333 e web em :5173
```

Acesse http://localhost:5173. As credenciais de desenvolvimento ficam em
[`apps/api/src/db/seed.ts`](apps/api/src/db/seed.ts) (somente dados fictícios).
Dono e dentista exigem 2FA; para ver o código atual dos usuários de teste:

```bash
npm run dev:totp
```

O usuário de recepção não usa 2FA e não vê dados clínicos (REQ-22). O consultório
"Odonto Centro Vila Nova" do seed está suspenso, para demonstrar o modo somente leitura (REQ-32).
Para recriar o banco do zero: `docker compose down -v` e repita os passos acima.

> A porta do Postgres é **5434**, para não conflitar com outros projetos locais.

## Testes

```bash
npm test                         # testes de domínio e de integração (precisa do db rodando)
```
