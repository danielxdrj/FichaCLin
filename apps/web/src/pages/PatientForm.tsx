import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, post, put } from '../lib/api';
import { ageFrom } from '../lib/format';
import { Card, ErrorAlert, Field, Input, PageHead, Select, Textarea } from '../components/ui';

type Consents = { marketing: boolean; image: boolean; research: boolean };
interface Form {
  fullName: string; socialName: string; birthDate: string; cpf: string; sex: string; profession: string; maritalStatus: string;
  phone: string; email: string; notes: string;
  address: { cep: string; street: string; number: string; complement: string; district: string; city: string; state: string };
  guardian: { name: string; cpf: string; relationship: string; phone: string };
  consents: Consents;
}

const EMPTY: Form = {
  fullName: '', socialName: '', birthDate: '', cpf: '', sex: '', profession: '', maritalStatus: '', phone: '', email: '', notes: '',
  address: { cep: '', street: '', number: '', complement: '', district: '', city: '', state: '' },
  guardian: { name: '', cpf: '', relationship: '', phone: '' },
  consents: { marketing: false, image: false, research: false },
};

/** Textos e versões iguais aos da API (REQ-15). */
export const CONSENT_LABELS: Record<keyof Consents, string> = {
  marketing: 'Autorizo receber lembretes e novidades por WhatsApp e e-mail.',
  image: 'Autorizo o uso de fotos clínicas em redes sociais e portfólio.',
  research: 'Autorizo o uso dos meus dados em pesquisa ou estatística não anonimizada.',
};

/** 03 — Cadastro do paciente (REQ-11, REQ-14, REQ-15). */
export function PatientFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api(`/patients/${id}`).then((p) => {
      setForm({
        ...EMPTY,
        ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])),
        address: { ...EMPTY.address, ...(p.address ?? {}) },
        guardian: { ...EMPTY.guardian, ...(p.guardian ?? {}) },
        consents: EMPTY.consents,
      } as Form);
    }).catch(setError);
  }, [id]);

  const minor = useMemo(() => /^\d{4}-\d{2}-\d{2}$/.test(form.birthDate) && ageFrom(form.birthDate) < 18, [form.birthDate]);
  const set = (k: keyof Form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const setAddr = (k: keyof Form['address'], v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));
  const setGuardian = (k: keyof Form['guardian'], v: string) => setForm((f) => ({ ...f, guardian: { ...f.guardian, [k]: v } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const body = {
      ...form,
      email: form.email || null,
      guardian: minor ? form.guardian : null,
      consents: editing ? undefined : form.consents,
    };
    try {
      if (editing) {
        await put(`/patients/${id}`, body);
        navigate(`/pacientes/${id}`);
      } else {
        const r = await post<{ id: string }>('/patients', body);
        navigate(`/pacientes/${r.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setFieldErrors(Object.fromEntries((err.details as { field: string; message: string }[]).map((d) => [d.field, d.message])));
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fe = (k: string) => fieldErrors[k] ?? null;

  return (
    <form onSubmit={submit}>
      <PageHead
        crumb={<><Link to="/pacientes">Pacientes</Link> / {editing ? 'Editar' : 'Novo paciente'}</>}
        title={editing ? 'Editar paciente' : 'Novo paciente'}
        subtitle="Campos com * são obrigatórios."
        actions={<>
          <Link className="btn" to={editing ? `/pacientes/${id}` : '/pacientes'}>Cancelar</Link>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar paciente'}</button>
        </>}
      />
      <div className="grid-2">
        <div className="stack">
          <Card title="Dados pessoais">
            <div className="form-grid">
              <Field className="col-8" label="Nome completo *" error={fe('fullName')}>
                <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} required />
              </Field>
              <Field className="col-4" label="Nome social">
                <Input value={form.socialName} onChange={(e) => set('socialName', e.target.value)} />
              </Field>
              <Field className="col-4" label="Data de nascimento *" error={fe('birthDate')} hint={minor ? 'Menor de 18: responsável legal obrigatório' : undefined}>
                <Input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} required />
              </Field>
              <Field className="col-4" label="CPF">
                <Input value={form.cpf} placeholder="000.000.000-00" onChange={(e) => set('cpf', e.target.value)} />
              </Field>
              <Field className="col-4" label="Sexo">
                <Select value={form.sex} onChange={(e) => set('sex', e.target.value)} options={[['', 'Selecione'], 'Feminino', 'Masculino', 'Outro', 'Prefere não informar']} />
              </Field>
              <Field className="col-6" label="Profissão">
                <Input value={form.profession} onChange={(e) => set('profession', e.target.value)} />
              </Field>
              <Field className="col-6" label="Estado civil">
                <Select value={form.maritalStatus} onChange={(e) => set('maritalStatus', e.target.value)} options={[['', 'Selecione'], 'Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União estável']} />
              </Field>
            </div>
          </Card>

          {minor && (
            <Card title={<>Responsável legal <span className="subtle" style={{ fontWeight: 400 }}>obrigatório para menores</span></>}>
              <div className="form-grid">
                <div className="col-12 alert warning">
                  Paciente menor de idade: o responsável assina o prontuário, recebe a cópia e decide sobre os consentimentos (LGPD art. 14).
                </div>
                <Field className="col-6" label="Nome do responsável *" error={fe('guardian.name') ?? fe('guardian')}>
                  <Input value={form.guardian.name} onChange={(e) => setGuardian('name', e.target.value)} required />
                </Field>
                <Field className="col-6" label="CPF do responsável *" error={fe('guardian.cpf')}>
                  <Input value={form.guardian.cpf} onChange={(e) => setGuardian('cpf', e.target.value)} required />
                </Field>
                <Field className="col-6" label="Parentesco *" error={fe('guardian.relationship')}>
                  <Select value={form.guardian.relationship} onChange={(e) => setGuardian('relationship', e.target.value)} required
                    options={[['', 'Selecione'], 'Mãe', 'Pai', 'Tutor(a) legal', 'Avó/Avô', 'Outro']} />
                </Field>
                <Field className="col-6" label="Contato do responsável *" error={fe('guardian.phone')}>
                  <Input value={form.guardian.phone} onChange={(e) => setGuardian('phone', e.target.value)} required />
                </Field>
              </div>
            </Card>
          )}

          <Card title="Contato">
            <div className="form-grid">
              <Field className="col-6" label="Celular / WhatsApp *" error={fe('phone')}>
                <Input value={form.phone} placeholder="(11) 90000-0000" onChange={(e) => set('phone', e.target.value)} required />
              </Field>
              <Field className="col-6" label="E-mail" error={fe('email')}>
                <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field className="col-3" label="CEP"><Input value={form.address.cep} onChange={(e) => setAddr('cep', e.target.value)} /></Field>
              <Field className="col-6" label="Endereço"><Input value={form.address.street} onChange={(e) => setAddr('street', e.target.value)} /></Field>
              <Field className="col-3" label="Número"><Input value={form.address.number} onChange={(e) => setAddr('number', e.target.value)} /></Field>
              <Field className="col-4" label="Bairro"><Input value={form.address.district} onChange={(e) => setAddr('district', e.target.value)} /></Field>
              <Field className="col-6" label="Cidade"><Input value={form.address.city} onChange={(e) => setAddr('city', e.target.value)} /></Field>
              <Field className="col-2" label="UF"><Input maxLength={2} value={form.address.state} onChange={(e) => setAddr('state', e.target.value.toUpperCase())} /></Field>
            </div>
          </Card>
        </div>

        <div className="stack">
          {!editing && (
            <Card title="Consentimentos opcionais">
              <p className="subtle">
                O prontuário não depende de consentimento (tutela da saúde, LGPD art. 11, II, f). Marque apenas o que
                {minor ? ' o responsável ' : ' o paciente '}autorizar.
              </p>
              {(Object.keys(CONSENT_LABELS) as (keyof Consents)[]).map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={form.consents[k]} onChange={(e) => set('consents', { ...form.consents, [k]: e.target.checked })} />
                  <span>{CONSENT_LABELS[k]}</span>
                </label>
              ))}
              <p className="subtle">Registramos data, versão do texto e quem coletou.</p>
            </Card>
          )}
          <Card title="Observações">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Informações administrativas (não clínicas)" />
          </Card>
          <ErrorAlert error={error} />
        </div>
      </div>
    </form>
  );
}
