# Matriz de conformidade — Fichaclin

Fonte única dos requisitos: [`Fichaclin_Requisitos_Legais.pdf`](Fichaclin_Requisitos_Legais.pdf)
(levantamento técnico de 16/11/2026; **não é parecer jurídico**, como o próprio documento declara).

Cada requisito recebe um ID `REQ-NN`. O código cita esse ID em comentários
(`// REQ-NN`) para que seja possível responder "por que o Fichaclin funciona assim?".

## Legenda de status

| Status | Significado |
|---|---|
| **Técnico ✔** | Controle técnico implementado e testado neste repositório |
| **Funcional ✔** | Funcionalidade de tela/fluxo implementada |
| **Parcial** | Parte implementada; o que falta está descrito |
| **Pendente** | Ainda não implementado |
| **Fora do software** | Depende de contrato, processo, infraestrutura ou pessoa; o software não garante sozinho |
| **Jurídico ⚖** | Depende de validação por advogado (ver [DUVIDAS_JURIDICAS.md](DUVIDAS_JURIDICAS.md)) |

> Nenhuma linha "✔" significa "em conformidade legal". Significa apenas que o controle
> técnico descrito existe. A conformidade depende também dos itens "Fora do software" e "Jurídico".

## Matriz

| ID | Requisito (seção do PDF) | Impacto no sistema | Onde é implementado | Como é validado | Status |
|---|---|---|---|---|---|
| REQ-01 | Consultório = controlador; Fichaclin = operador dos dados de pacientes (§1 item 1, §2) | Separação de dados por consultório; Fichaclin só trata dados para prestar o serviço | Contrato/Termos; `clinics` como dono dos dados (`apps/api/src/db/migrations/001_schema.sql`) | Revisão contratual | Fora do software · Jurídico ⚖ |
| REQ-02 | DPA assinado com cada consultório; aceite do DPA na tela 07 (§1 item 2, §8.3, §9) | Registro do aceite do DPA por versão | `legal_acceptances` (tipo `dpa`), rota `POST /clinic/dpa/accept`, tela Configurações · Consultório | `api.test.ts` | Técnico ✔ (registro de aceite) · Texto do DPA: Jurídico ⚖ |
| REQ-03 | Termos de Uso e Política de Privacidade com aceite registrado (versão, data, IP, usuário), na 1ª entrada e a cada nova versão (§1 item 3, §9 tela 01) | Bloqueio do uso até aceitar a versão vigente | `legal_documents`, `legal_acceptances`; middleware `requireCurrentTerms`; tela de aceite após login | `api.test.ts` (nova versão exige novo aceite) | Técnico ✔ · Texto dos documentos: Jurídico ⚖ |
| REQ-04 | Assinatura: MVP com assinatura eletrônica simples (login + 2FA + carimbo de tempo + hash + trilha); fase 2 ICP-Brasil (PAdES); orientar via em papel sem ICP (§1 item 4, §5) | Registros clínicos assinados com hash SHA-256; método `simples-2fa` quando a sessão passou pelo 2FA, `simples` quando não (2FA opcional, ver REQ-24); aviso na tela de evolução | `clinical_entries.content_hash`, `signature_method`; `routes/clinical.ts`; aviso na tela 06 | `api.test.ts` | Parcial (MVP) · Sem 2FA, **não** atende a descrição do PDF · ICP-Brasil: Pendente (fase 2) · Jurídico ⚖ |
| REQ-05 | Guarda mínima de 20 anos; nunca apagar prontuário ao excluir paciente (só inativar) (§1 item 5, §5 Lei 13.787) | Pacientes e prontuários não podem ser apagados | Gatilhos `prevent_delete` em `patients`, `clinical_entries`, `anamnesis_responses`; `PATCH /patients/:id/inactivate` | `db.test.ts` (DELETE é rejeitado pelo banco) | Técnico ✔ · Política de retenção física: Fora do software |
| REQ-06 | Exportação do prontuário (PDF + dados estruturados); cópia ao paciente ou responsável (§1 item 5, §5, §9 tela 13) | Exportação completa do paciente | `GET /patients/:id/export` (JSON estruturado) e página imprimível (`/pacientes/:id/exportar`, impressão em PDF pelo navegador) | `api.test.ts` | Parcial (PDF via impressão do navegador; PDF gerado no servidor: Pendente) |
| REQ-07 | Log de auditoria imutável: quem abriu, criou, alterou ou exportou cada prontuário (§1 item 6, §6.3) | Toda leitura/escrita/exportação de dados clínicos gera evento | Tabela `audit_log` (somente INSERT/SELECT, gatilho bloqueia UPDATE/DELETE, encadeamento de hash); `services/audit.ts` | `db.test.ts`, `api.test.ts` | Técnico ✔ |
| REQ-08 | Logs de acesso (IP, data e hora) guardados sob sigilo por 6 meses (§1 item 6, §6.4 Marco Civil art. 15) | Registro de acesso por requisição; expurgo após 6 meses | Tabela `access_log`; hook `onResponse`; função `purge_access_log()` agendada | `db.test.ts` (expurgo) | Técnico ✔ |
| REQ-09 | Plano de resposta a incidentes; aviso ao consultório em até 24h; registro de incidente por 5 anos (§1 item 7, §6.1) | Processo documentado | — | — | Pendente · Fora do software |
| REQ-10 | Encarregado (DPO) nomeado e canal publicado (§1 item 8, §6.2) | Canal do encarregado visível na tela de Suporte | Config `DPO_NAME` / `DPO_EMAIL`; tela Configurações · Suporte | Revisão manual | Parcial (canal exibido) · Nomeação: Fora do software |
| REQ-11 | Responsável legal obrigatório para menor de 18 (nome, CPF, parentesco, contato) (§1 item 9, §4.1) | Validação de cadastro por idade | `domain/patient.ts` (`isMinor`, `validatePatient`); tela 03 mostra bloco "Responsável legal" | `domain.test.ts`, `api.test.ts` | Técnico ✔ |
| REQ-12 | Menores: assinatura e cópia do prontuário pelo responsável; consentimentos de marketing/imagem pedidos ao responsável e desligados por padrão (§4.1) | Consentimento de menor registra o responsável como quem consentiu | `domain/patient.ts`, `patient_consents.granted_by` | `domain.test.ts`, `api.test.ts` | Parcial (assinatura do paciente/responsável em papel no MVP) |
| REQ-13 | Hospedar dados de pacientes no Brasil; listar suboperadores; ferramentas de erro sem dados de pacientes (§1 item 10, §7) | Escolha de infraestrutura; logs da aplicação sem dados de pacientes | `docs/arquitetura/ADR-001`; logger com `redact` (`apps/api/src/server.ts`) | Revisão de config | Parcial · Hospedagem: Fora do software |
| REQ-14 | Base legal tutela da saúde: não exigir consentimento para o prontuário (§3) | Cadastro e prontuário não dependem de consentimento | `domain/patient.ts` (sem campo obrigatório de consentimento) | `domain.test.ts`, `api.test.ts` | Técnico ✔ |
| REQ-15 | Consentimentos separados e desmarcados (marketing, imagem, pesquisa) com data, versão do texto e quem coletou (§3) | Tabela de consentimentos versionada | `patient_consents`; tela 03 | `domain.test.ts`, `api.test.ts` | Técnico ✔ |
| REQ-16 | Lembretes de consulta: base legal decidida pelo consultório; sistema só permite configurar (§3) | Configuração por consultório | `clinics.reminder_legal_basis` | Revisão manual | Funcional ✔ (configuração) · Jurídico ⚖ |
| REQ-17 | Usuários maiores de 18 e vinculados a consultório contratante (§4.3, §8.1) | Cláusula dos Termos; usuário só existe vinculado a consultório | `memberships` | — | Parcial · Idade: Fora do software (Termos) |
| REQ-18 | ECA Digital: reavaliar se houver portal/app do paciente (§4.2) | Não há área do paciente no MVP | — | — | Não se aplica ao MVP · Jurídico ⚖ se houver portal |
| REQ-19 | Evolução/odontograma: autor, CRO, data/hora automáticos; ordem cronológica; travar após assinar; correção por adendo (§5, §9 telas 05/06) | Registros imutáveis após assinatura | `clinical_entries` + gatilho `lock_signed_entry`; `POST /entries/:id/addendum` | `api.test.ts`, `db.test.ts` | Técnico ✔ |
| REQ-20 | TCLE eletrônico com autenticidade, integridade e rastreabilidade (§5) | Documento de consentimento de tratamento | — | — | Pendente |
| REQ-21 | Anamnese: versão do modelo salva junto da resposta; histórico imutável; assinatura do paciente/responsável (§9 telas 04/10) | Modelos versionados; respostas não editáveis | `anamnesis_templates` (versão), `anamnesis_responses` (gatilho bloqueia UPDATE/DELETE) | `api.test.ts` | Técnico ✔ · Assinatura do paciente: Parcial (papel) |
| REQ-22 | Controle de acesso por papel: dono, dentista, recepção; recepção sem dados clínicos por padrão; log de alteração de permissão (§5, §9 tela 08) | RBAC por consultório | `domain/permissions.ts`; `requirePermission`; auditoria `membership.role_changed` | `domain.test.ts`, `api.test.ts` | Técnico ✔ |
| REQ-23 | Senhas com Argon2 (§6.3) | Hash de senha | `services/password.ts` (argon2id) | `domain.test.ts`, `api.test.ts` | Técnico ✔ |
| REQ-24 | 2FA obrigatório para dentistas e administradores (§6.3, §9 tela 01) | **Divergência por decisão de produto** (ver abaixo): 2FA opcional, recomendado na interface, exigível pelo consultório; cadastro por QR code; dispositivo lembrado por 90 dias | `services/totp.ts`, `services/trusted-device.ts`, `clinics.require_mfa`; Configurações · Segurança | `domain.test.ts`, `api.test.ts` | **Divergente** · Jurídico ⚖ |
| REQ-25 | Bloqueio após tentativas de login (§9 tela 01) | Conta bloqueada temporariamente | `users.failed_logins`, `locked_until` | `domain.test.ts`, `api.test.ts` | Técnico ✔ |
| REQ-26 | Isolamento por consultório (RLS no Postgres); usuário só vê consultórios com vínculo (§6.3, §9 tela 09) | Toda consulta passa por RLS com `app.clinic_id` | Políticas RLS em `001_schema.sql`; `db/tenant.ts` | `db.test.ts` (consultório A não lê dados do B) | Técnico ✔ |
| REQ-27 | HTTPS em tudo (§6.3) | TLS no proxy de produção; cookies `Secure`; cabeçalhos de segurança | `deploy/Caddyfile` (certificado automático, HSTS, CSP); `COOKIE_SECURE` (padrão `true` em produção) | Stack local: cabeçalhos conferidos | Técnico ✔ (configuração) · Domínio/DNS: Pendente |
| REQ-28 | Criptografia em repouso do banco e dos arquivos (§6.3) | Volume/disco criptografado | — | — | Pendente · Fora do software |
| REQ-29 | Backup diário criptografado fora da VPS, com teste de restauração (§6.3) | Serviço `backup` na stack: dump diário, criptografia `age` obrigatória, envio por `rclone`; script de restauração em banco separado | `deploy/backup.sh`, `deploy/restore.sh`, `docs/deploy/PRODUCAO.md` | Teste local: backup cifrado restaurado com contagens conferidas | Parcial · Storage externo e registro mensal dos testes: Fora do software |
| REQ-30 | Acesso do suporte só com autorização do consultório e registrado em log (§6.3, §9 tela 12) | Autorização com prazo (máx. 72h), ligada opcionalmente a um chamado; concessão, revogação (com autor) e expiração auditadas; módulo de Suporte com chamados | `support_grants`, `support_tickets`, `routes/support.ts`; tela Suporte | `api.test.ts`, `support-agenda.test.ts` | Técnico ✔ (autorização e registro) · Acesso efetivo da equipe de suporte: Pendente · Processo: Fora do software |
| REQ-31 | Dados do controlador: razão social, CNPJ, responsável técnico e CRO (§9 tela 07) | Campos do consultório | `clinics`; tela Configurações · Consultório | Revisão manual | Funcional ✔ |
| REQ-32 | Inadimplência suspende uso, mas permite exportar (§8.1, §9 tela 13) | Status `suspended` bloqueia escrita, mantém leitura/exportação | `clinics.billing_status`; `requireWritable` | `api.test.ts` | Técnico ✔ |
| REQ-33 | Tela de Auditoria para o dono ver quem acessou cada prontuário (§9 "Novo") | Consulta ao `audit_log` filtrada por paciente | `GET /audit`; tela Auditoria | `api.test.ts` | Funcional ✔ |
| REQ-34 | Documentos: Termos, Política, DPA, ROPA, RIPD, plano de incidentes, política de backup, política de acesso do suporte (§8) | Textos e processos | Versões de exemplo **marcadas como rascunho** no seed | — | Pendente · Jurídico ⚖ |
| REQ-35 | Fim do contrato: prazo de exportação (ex.: 90 dias) e guarda de 20 anos (§8.1) | Exportação disponível em suspensão | Coberto parcialmente por REQ-06/REQ-32 | — | Parcial · Jurídico ⚖ |
| REQ-36 | Sigilo profissional em logs e suporte (§5 Código de Ética) | Logs técnicos sem conteúdo clínico | `redact` do logger; `audit_log` guarda IDs, não conteúdo | Revisão de código | Técnico ✔ |

## Conflitos com a arquitetura proposta

Nenhum conflito bloqueante identificado. Decisões tomadas por causa do PDF (detalhes em
[ADR-001](../arquitetura/ADR-001-stack-e-isolamento.md)):

1. **PostgreSQL com RLS** em vez de filtro só na aplicação (REQ-26).
2. **Imutabilidade no banco** (gatilhos), não só na API, para prontuário, anamnese e auditoria (REQ-05, REQ-07, REQ-19, REQ-21).
3. **Inativação no lugar de exclusão** de pacientes (REQ-05).
4. **Assinatura em duas fases**: hash + 2FA no MVP; ICP-Brasil na fase 2 (REQ-04).

## Rodada de refinamento de UX (16/11/2026)

Decisões D-03 a D-08 (agenda, chamados de suporte, anexos) em [REFINAMENTO-UX.md](../produto/REFINAMENTO-UX.md).
Nenhuma diverge do PDF; todas reaproveitam permissões e regras de isolamento já existentes.

## Divergências decididas pelo produto

### D-01 — 2FA opcional (REQ-24, afeta REQ-04) · 16/11/2026

- **O PDF diz:** "2FA obrigatório para dentistas e administradores" (§6.3) e descreve a assinatura do MVP
  como "login + 2FA + carimbo de tempo + hash" (§5).
- **Decisão do produto:** o cliente cria a conta e usa o teste grátis de 7 dias sem 2FA. O sistema
  **recomenda** o 2FA (aviso permanente até ativar) e o cliente ativa em Configurações · Segurança, por QR code.
  Depois de ativado, o código é pedido no login, exceto em dispositivo marcado como "não solicitar novamente"
  (90 dias, revogável). O dono pode **exigir** 2FA de toda a equipe.
- **Impacto técnico:** sessões sem 2FA podem acessar e assinar prontuários. Assinaturas feitas sem 2FA ficam
  marcadas como `simples` (com 2FA: `simples-2fa`), para que o histórico mostre a diferença.
- **Risco:** menor proteção de dados sensíveis (LGPD art. 46) e assinatura mais fraca que a descrita no PDF.
- **Mitigação disponível:** a opção "Exigir 2FA de todos os usuários" restaura o comportamento do PDF por consultório.
  Para não ser agressiva, ela vale a partir do próximo login (não desconecta ninguém) e só pode ser ligada por
  um dono que já usa 2FA. A ativação do 2FA pode ser cancelada a qualquer momento antes da confirmação do código.
- **Status:** divergente — levar ao advogado (item 8 de [DUVIDAS_JURIDICAS.md](DUVIDAS_JURIDICAS.md)).

### D-02 — Cadastro aberto com teste grátis de 7 dias · 16/11/2026

- Não diverge do PDF, mas cria obrigações: o aceite dos Termos e da Política é registrado no próprio cadastro
  (REQ-03), e o DPA (REQ-02) continua pendente até o dono aceitar em Configurações · Consultório.
- **Pendente:** confirmação de e-mail e limite de tentativas no cadastro (proteção contra abuso).
