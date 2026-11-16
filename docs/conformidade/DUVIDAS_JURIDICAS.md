# Dúvidas para validação jurídica

Itens que o software **não resolve sozinho**. Origem: seção 10 do PDF de requisitos
e pontos marcados como "Jurídico ⚖" na [matriz](MATRIZ.md).

| # | Dúvida | Requisitos afetados | Situação no código hoje |
|---|---|---|---|
| 1 | O modelo de assinatura eletrônica do MVP (login + 2FA + hash + carimbo de tempo) é aceitável enquanto o consultório mantiver a via em papel? | REQ-04, REQ-19, REQ-21 | Implementado como "assinatura eletrônica simples"; a tela de evolução avisa que, sem ICP-Brasil, a via em papel assinada deve ser mantida |
| 2 | Como tratar a guarda de 20 anos quando um consultório cancela a assinatura? | REQ-05, REQ-35 | Dados nunca são apagados; suspensão mantém exportação. Plano de arquivamento: indefinido |
| 3 | O CDC pode ser aplicado a consultórios menores? Como redigir a limitação de responsabilidade? | REQ-34 | Fora do software |
| 4 | Enquadramento no ECA Digital caso exista portal do paciente | REQ-18 | Não há portal no MVP |
| 5 | Status de adequação da UE (Res. CD/ANPD 32/2026) e cláusulas para suboperadores nos EUA | REQ-13 | O próprio PDF pede confirmação ("Confirme esse ponto com o advogado") |
| 6 | Lembretes de consulta por WhatsApp: tutela da saúde ou consentimento? | REQ-16 | Sistema só permite o consultório configurar a base legal; nenhum envio implementado |
| 7 | Textos de Termos de Uso, Política de Privacidade e DPA | REQ-02, REQ-03, REQ-34 | O seed cria versões marcadas como **RASCUNHO — não usar em produção** |
