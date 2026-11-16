# Refinamento de UX e produto — rodada 1 (16/11/2026)

Branch: `feat/refinamento-ux-saas`. Requisitos de origem: [MATRIZ.md](../conformidade/MATRIZ.md).

## Navegação

| Antes | Agora |
|---|---|
| Configurações, Usuários e Modelo de anamnese no mesmo nível dos módulos | Menu principal só com módulos operacionais: **Pacientes, Agenda, Suporte, Auditoria** |
| Suporte como aba de Configurações | Suporte é módulo próprio (`/suporte`) |
| Atalhos do paciente (Anamnese, Odontograma, Histórico) no menu | Ficam nas abas da ficha do paciente |
| Configurações no menu | ⚙ Configurações e Sair no rodapé, junto do usuário |
| Sem recolher; abaixo de 900px o menu empilhava acima do conteúdo | ≥768px: menu fixo, recolhível para só ícones (preferência salva no navegador); <768px: gaveta com botão de menu, fundo escurecido, Esc e navegação fecham |

Endereços antigos redirecionam: `/usuarios` → `/configuracoes/usuarios`, `/modelo-anamnese` → `/configuracoes/anamnese`,
`/configuracoes/suporte` → `/suporte`.

## Usuários e papéis

**Causa do problema relatado:** a tela não tinha estado de "usuário selecionado". A "Equipe" era uma tabela sem
seleção e "Permissões por usuário" era uma matriz com uma coluna por usuário não-proprietário; ela só refletia
mudanças quando a troca de papel recarregava a lista.

**Correção:** mestre-detalhe. O usuário selecionado fica na URL (`?usuario=<id>`), e o painel de detalhe é derivado
da mesma lista vinda do servidor; toda alteração vai para a API e a lista é recarregada mantendo a seleção.
O painel mostra papel atribuído, situação, 2FA e **permissões efetivas**, indicando a origem de cada uma:
"Do papel", "Concedida a mais", "Removida do padrão" ou "Exclusiva do(a) proprietário(a)".

- "Dono" virou **"Proprietário(a)"** só na apresentação; o identificador interno continua `owner`.
- Filtro Todos / Ativos / Inativos (controle segmentado com contagem).
- Situação e 2FA com texto + forma, não só cor.
- Trocar papel de quem tem permissões personalizadas e desativar/reativar pedem confirmação.

## Suporte

- Chamados com motivo pré-definido (Outro(a) exige motivo informado), prioridade (Baixa/Normal/Alta/Crítica),
  assunto, descrição, histórico de comentários e encerramento pelo cliente.
- Situações: Aberta, Em análise, Aguardando cliente, Resolvida, Encerrada.
- Autorização de acesso do suporte com motivo, chamado relacionado, quem autorizou, início, expiração, duração,
  situação (ativa/expirada/revogada) e quem revogou. Prazo máximo de 72h; nunca permanente.
- Auditoria: abertura, comentário, encerramento, concessão, revogação e **expiração** (registrada uma vez,
  na primeira leitura após vencer). Texto dos chamados não vai para a auditoria (REQ-36).
- Continua disponível com consultório suspenso.

## Agenda

Base estrutural: visão do dia e de 7 dias, filtro por profissional, criar/editar, marcar confirmado/concluído/faltou,
cancelar. Tipos: consulta, retorno, compromisso, lembrete. **Separada da auditoria**: agenda = o que está marcado;
auditoria = o que aconteceu no sistema.

## Decisões de segurança e conservadoras

| # | Decisão | Motivo |
|---|---|---|
| D-03 | Agenda usa `patients:read`/`patients:write`, sem permissão nova | O pedido proíbe criar permissões não definidas; agendar é tarefa administrativa ligada ao cadastro. Recepção agenda e continua sem dados clínicos (REQ-22) |
| D-04 | Qualquer membro abre chamado e vê só os próprios; `support:manage` (proprietário) vê todos | Sem permissão nova; chamados podem conter detalhes de uso de outros usuários |
| D-05 | Sem anexos em chamados | Não há armazenamento de arquivos com criptografia em repouso (REQ-28); anexos poderiam conter dados de pacientes |
| D-06 | Agenda sem exclusão (só cancelar) | Preserva histórico; mesmo padrão de inativação do sistema |
| D-07 | Observação da agenda e descrição de chamados com aviso "não inclua informação clínica/dados de pacientes" | Minimização e sigilo (PDF §5, REQ-36) |
| D-08 | Paciente e profissional da agenda validados no servidor (mesmo consultório, ativos; profissional = proprietário ou dentista) | Front não é barreira de segurança; RLS + validação na API |

Isolamento por consultório: as tabelas novas (`support_tickets`, `support_ticket_events`, `agenda_events`) têm RLS
com a mesma política das demais (REQ-26). Testes cobrem acesso cruzado entre consultórios.

## Pendências desta rodada

- **Painel interno da equipe de suporte** (responder e mudar a situação dos chamados) e o **mecanismo de acesso**
  do suporte ao ambiente: hoje existe a autorização registrada, mas nenhuma conta de suporte usa essa autorização.
- **Anexos** em chamados, quando houver storage criptografado.
- Agenda: detecção de conflito de horário por profissional, visão de calendário semanal em grade, lembretes ao
  paciente (depende da decisão de base legal — dúvida jurídica 6).
- Revisão visual das telas não tocadas nesta rodada (ficha do paciente, cadastro, configurações do consultório):
  ainda usam mais cartões que o novo padrão.
