# ADR-002 — Estrutura de produção

- **Data:** 16/11/2026
- **Status:** Aceita (16/11/2026) — implementada em `docker-compose.yml` e `deploy/`; guia em [PRODUCAO.md](../deploy/PRODUCAO.md)
- **Requisitos de origem:** REQ-13, REQ-27, REQ-28, REQ-29, REQ-08 ([matriz](../conformidade/MATRIZ.md))

## Contexto

O PDF de requisitos descreve ~10 consultórios na largada, VPS Hostinger com Docker/Portainer e migração
futura para AWS. Os dados são de saúde (sensíveis), devem ficar preferencialmente no Brasil (REQ-13), com
TLS (REQ-27), criptografia em repouso (REQ-28) e backup diário criptografado **fora da VPS** (REQ-29).

Duas opções foram consideradas:

| | A. Uma VPS, uma stack no Portainer | B. Peças separadas (VPS da API, front em outro lugar, banco em outro lugar) |
|---|---|---|
| Custo | 1 servidor | 2–3 servidores ou serviços |
| Rede | Banco em rede Docker interna, sem porta pública | Banco exposto na internet (com firewall/TLS) ou VPN entre máquinas |
| Login (cookie) | Mesma origem: cookie `SameSite=Lax` + cabeçalho anti-CSRF funcionam como estão | Front em outro domínio exige CORS e cookie `SameSite=None`, ou mudar a autenticação |
| Dados no Brasil | Uma escolha de região | Cada fornecedor precisa ficar no Brasil; CDN de front costuma servir do exterior |
| Operação | Um `docker stack`/`compose` para atualizar | Deploys e monitoramento separados |
| Escala | Suficiente para dezenas de consultórios | Necessária só com carga bem maior |

## Decisão (proposta)

**Fase 1 — agora: opção A.** Uma VPS **localizada no Brasil**, com uma stack no Portainer:

```
                 Internet (HTTPS 443)
                        │
              ┌─────────▼─────────┐
              │  proxy (Caddy)     │  TLS automático (Let's Encrypt), HSTS
              │  app.fichaclin...  │  /      → arquivos do front (build do Vite)
              └───┬───────────┬───┘  /api/* → api:3333
                  │           │
        ┌─────────▼──┐   ┌────▼──────────┐
        │ web (estático)│  │ api (Node)     │  usuário do banco: fichaclin_app (sem BYPASSRLS)
        └────────────┘   └────┬──────────┘
                              │ rede interna Docker (sem porta publicada)
                        ┌─────▼─────┐
                        │ db         │  PostgreSQL 16, volume em disco criptografado
                        └─────┬─────┘
                              │ pg_dump diário, criptografado (age/GPG)
                        ┌─────▼─────────────────────┐
                        │ backup fora da VPS (Brasil)│  object storage S3-compatível
                        └───────────────────────────┘
   job "migrate" (roda e termina): aplica migrações com fichaclin_owner antes de subir a api
```

Regras da fase 1:

1. **Front e API na mesma origem** (`https://app.dominio`), atrás do proxy. Mantém o cookie de sessão e a
   proteção CSRF como estão; nenhum CORS.
2. **Banco sem porta publicada.** Só a `api` e o job `migrate` alcançam o `db` pela rede interna.
   Acesso administrativo: túnel SSH, nunca porta aberta.
3. **Dois papéis no banco** (ADR-001): `fichaclin_owner` só no job de migração; `fichaclin_app` na API.
4. **Segredos** (senhas do banco, chaves de backup) como *secrets* do Portainer/variáveis de ambiente da
   stack — nunca no Git.
5. **Backup diário criptografado fora da VPS**, em provedor/região no Brasil, com **teste de restauração
   mensal** registrado (REQ-29).
6. **Logs**: a API já não registra dados de pacientes (REQ-36). Se usar Sentry ou similar, desligar envio de
   corpo de requisição e dados de usuário (REQ-13).
7. **Imagens com versão fixa** (`fichaclin-api:1.4.0`, não `latest`), para conseguir voltar uma versão.

**Fase 2 — quando crescer ou migrar para AWS (sa-east-1, São Paulo):** separar sem mudar código:

| Hoje (VPS) | AWS |
|---|---|
| `db` (container) | RDS PostgreSQL com criptografia em repouso e backups automáticos |
| `api` (container) | ECS Fargate ou EC2 com o mesmo container |
| `web` + `proxy` | S3 + CloudFront **ou** manter o proxy servindo o front na mesma origem |
| backup S3-compatível | Snapshots do RDS + cópia para outra conta/região no Brasil |

A API já lê tudo de variáveis de ambiente (`DATABASE_URL`, `DATABASE_OWNER_URL` etc.), então trocar o banco
de container por RDS é troca de configuração.

## Pendências para colocar em produção

| Item | Requisito | Situação |
|---|---|---|
| Confirmar que o plano/VPS escolhido fica em datacenter no Brasil | REQ-13 | Pendente — verificar no contrato do provedor |
| Criptografia do disco/volume do banco | REQ-28 | Pendente — depende do provedor (disco criptografado) |
| Dockerfiles da `api`, `web` e `backup`, stack e Caddy | REQ-27 | Feito — `docker-compose.yml`, `deploy/` |
| Rotina de backup + teste de restauração documentado | REQ-29 | Feito no software (`deploy/backup.sh`, `restore.sh`); falta contratar o storage e registrar os testes mensais |
| Domínio e DNS | REQ-27 | Pendente |
| Monitoramento de disponibilidade e alertas | — | Pendente |
| Plano de resposta a incidentes (aviso ao consultório em 24h) | REQ-09 | Pendente — fora do software |

## Consequências

- Um ponto único de falha na fase 1 (a VPS). Aceitável para ~10 consultórios **se** o backup externo e o
  teste de restauração existirem; o tempo de recuperação esperado é o de recriar a VPS e restaurar o dump.
- Separar o front em outro domínio (opção B) exigiria rever a autenticação por cookie e a proteção CSRF;
  por isso a recomendação é manter a mesma origem também na fase 2.
