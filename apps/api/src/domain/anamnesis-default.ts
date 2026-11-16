/** Modelo inicial de anamnese criado para cada consultório novo (o dono pode editar e versionar). */
export const DEFAULT_ANAMNESIS = {
  title: 'Anamnese odontológica padrão',
  questions: [
    { id: 'tratamento', section: 'Saúde geral', text: 'Está em tratamento médico atualmente?', type: 'yesno', alert: false },
    { id: 'medicamentos', section: 'Saúde geral', text: 'Faz uso de algum medicamento?', type: 'yesno', alert: false },
    { id: 'alergia', section: 'Saúde geral', text: 'Tem alergia a algum medicamento ou anestésico?', type: 'yesno', alert: true },
    { id: 'cardiaco', section: 'Saúde geral', text: 'Tem problema cardíaco ou pressão alta?', type: 'yesno', alert: true },
    { id: 'diabetes', section: 'Saúde geral', text: 'Tem diabetes?', type: 'yesno', alert: true },
    { id: 'anticoagulante', section: 'Saúde geral', text: 'Usa anticoagulante?', type: 'yesno', alert: true },
    { id: 'gestante', section: 'Saúde geral', text: 'Está gestante?', type: 'yesno', alert: true },
    { id: 'sangramento', section: 'Histórico odontológico', text: 'Teve sangramento excessivo após extração?', type: 'yesno', alert: false },
    { id: 'queixa', section: 'Histórico odontológico', text: 'Qual a queixa principal?', type: 'text', alert: false },
  ],
};

export const TRIAL_DAYS = 7;
