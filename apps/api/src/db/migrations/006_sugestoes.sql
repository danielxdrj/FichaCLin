-- Suporte: categoria para o cliente sugerir melhorias ou pedir novas áreas/funcionalidades.
ALTER TABLE support_tickets DROP CONSTRAINT support_tickets_category_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_category_check
  CHECK (category IN ('problema_tecnico', 'erro_funcionalidade', 'acesso', 'seguranca', 'duvida', 'orientacao',
                      'sugestao', 'outro'));
