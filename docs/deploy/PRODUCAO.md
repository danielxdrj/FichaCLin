# Produção — VPS com Portainer

Estrutura decidida no [ADR-002](../arquitetura/ADR-002-producao.md): **tudo em uma VPS no Brasil**, em uma
stack do Portainer, com backup criptografado enviado para fora da VPS.

```
Internet ──443──► web (Caddy: HTTPS + front + /api) ──► api ──► db
                                                         ▲
                                       migrate (roda e termina antes da api)
                                       backup ──► dump diário criptografado ──► storage fora da VPS
```

| Serviço | Imagem | Porta pública | Observação |
|---|---|---|---|
| `web` | `fichaclin-web` (Caddy + build do front) | 80, 443 | Emite e renova o certificado TLS sozinho |
| `api` | `fichaclin-api` | nenhuma | Usuário do banco `fichaclin_app` (sujeito ao RLS) |
| `migrate` | `fichaclin-api` | nenhuma | Usuário `fichaclin_owner`; executa e termina |
| `db` | `postgres:16-alpine` | **nenhuma** | Rede interna sem saída para a internet |
| `backup` | `fichaclin-backup` | nenhuma | Único serviço com saída para a internet (envio do backup) |

O mesmo `docker-compose.yml` roda no seu computador (veja o [README](../../README.md)). No Portainer, **não**
use o `docker-compose.override.yml`: ele existe só para o ambiente local (abre a porta do banco e permite
backup sem criptografia).

## 1. Antes de subir

- [ ] VPS em **datacenter no Brasil** (confirmar no contrato) — REQ-13
- [ ] Disco/volume da VPS **criptografado** — REQ-28
- [ ] Domínio apontando para o IP da VPS (registro A/AAAA de `app.seudominio.com.br`)
- [ ] Firewall da VPS: liberar só 22 (SSH, de preferência restrito ao seu IP), 80 e 443
- [ ] Storage para o backup **fora da VPS**, também no Brasil (bucket S3-compatível)
- [ ] Par de chaves `age` para o backup (passo 2)

## 2. Chave do backup

Gere **no seu computador**, não na VPS:

```bash
age-keygen -o fichaclin-backup-chave-privada.txt
```

- A linha `# public key: age1...` é a **chave pública** → vai para `BACKUP_AGE_RECIPIENT` na stack.
- O arquivo inteiro é a **chave privada** → guarde fora do servidor (cofre de senhas + uma cópia offline).
  Sem ela, os backups não podem ser abertos. Ela só vai para a VPS durante um teste de restauração.

## 3. Criar a stack no Portainer

1. **Stacks → Add stack → Repository**, apontando para este repositório e para o arquivo `docker-compose.yml`
   (ou cole o conteúdo do arquivo no editor web, se preferir).
2. Em **Environment variables**, defina:

| Variável | Exemplo | Obrigatória |
|---|---|---|
| `DB_OWNER_PASSWORD` | senha longa aleatória | sim |
| `APP_DB_PASSWORD` | outra senha longa aleatória | sim |
| `SITE_ADDRESS` | `app.seudominio.com.br` | sim |
| `FICHACLIN_VERSION` | `0.1.0` | recomendado (permite voltar versão) |
| `DPO_NAME` / `DPO_EMAIL` | encarregado nomeado | sim (REQ-10) |
| `BACKUP_AGE_RECIPIENT` | `age1...` | sim (sem ela o backup não roda) |
| `BACKUP_RCLONE_REMOTE` | `backup:fichaclin-backups` | sim (REQ-29) |
| `BACKUP_RCLONE_TYPE` | `s3` | sim |
| `BACKUP_RCLONE_PROVIDER` | `Other` (ou o do provedor) | sim |
| `BACKUP_RCLONE_ENDPOINT` | URL S3 do provedor | sim |
| `BACKUP_RCLONE_ACCESS_KEY_ID` / `BACKUP_RCLONE_SECRET_ACCESS_KEY` | credenciais do bucket | sim |
| `BACKUP_KEEP_DAYS` | `7` (cópias locais; o histórico longo fica no bucket) | não |

Gere as senhas com, por exemplo, `openssl rand -base64 32`. **Nunca** coloque esses valores no Git.

3. **Deploy the stack.** Ordem automática: `db` saudável → `migrate` aplica as migrações e termina → `api`
   saudável → `web` sobe e pede o certificado.

## 4. Primeiro acesso

O cliente cria a conta pela própria tela de login ("Criar conta · 7 dias grátis").
Para criar ou vincular um acesso pelo servidor (a senha é pedida no terminal, sem aparecer na tela).
No Portainer: **Containers → fichaclin-api → Console** ou, por SSH:

```bash
docker exec -it fichaclin-api-1 node apps/api/dist/cli/create-user.js --email voce@exemplo.com --name "Seu Nome"
```

**Nunca** rode o seed de desenvolvimento em produção: ele é bloqueado com `NODE_ENV=production`.

Os Termos, a Política e o DPA do seed são rascunhos. Em produção, publique as versões revisadas pelo advogado
(tabela `legal_documents`) antes de abrir o cadastro — REQ-34.

## 5. Atualizar versão

1. Gere as imagens da nova versão (`FICHACLIN_VERSION=0.2.0`).
2. No Portainer, altere `FICHACLIN_VERSION` e clique em **Update the stack**.
3. O `migrate` roda de novo antes da `api` nova subir. Migrações são só para frente; para voltar de versão,
   restaure o backup feito antes da atualização.

## 6. Backup e restauração (REQ-29)

- O serviço `backup` faz um dump por dia, criptografa com a chave pública e envia ao bucket.
- Veja os logs: **Containers → fichaclin-backup → Logs** (`gerado ...`, `enviado para ...`).
- Backup manual imediato: `docker compose exec backup backup.sh --once`

**Teste de restauração — mensal, registrado:**

```bash
# 1. copie a chave privada para a VPS só durante o teste
docker compose cp fichaclin-backup-chave-privada.txt backup:/tmp/chave.txt
# 2. restaure num banco separado (o script recusa restaurar por cima do banco em uso)
docker compose exec backup restore.sh /backups/fichaclin-AAAAMMDDTHHMMSSZ.dump.age fichaclin_restore_teste /tmp/chave.txt
# 3. confira as contagens exibidas, apague o banco de teste e a chave
docker compose exec backup sh -c 'dropdb fichaclin_restore_teste && rm /tmp/chave.txt'
```

Anote data, arquivo usado, contagens e quem fez o teste — é a evidência pedida pelo REQ-29.

## 7. O que este guia ainda não cobre

- Monitoramento de disponibilidade e alertas (ex.: Uptime Kuma ou serviço externo).
- Plano de resposta a incidentes e aviso ao consultório em 24h (REQ-09) — processo, fora do software.
- Pipeline para publicar as imagens num registro (ex.: GHCR) em vez de construir na VPS.
