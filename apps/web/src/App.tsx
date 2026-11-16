import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './lib/session';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { MfaPage } from './pages/Mfa';
import { TermsPage } from './pages/Terms';
import { ClinicPickerPage } from './pages/ClinicPicker';
import { PatientsPage } from './pages/Patients';
import { PatientFormPage } from './pages/PatientForm';
import { PatientRecordPage } from './pages/PatientRecord';
import { ExportPage } from './pages/Export';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';
import { TemplateEditorPage } from './pages/TemplateEditor';
import { AuditPage } from './pages/Audit';

/**
 * Sequência de entrada (tela 01 → 09): login → 2FA (REQ-24) → aceite de Termos/Política (REQ-03)
 * → seletor de consultório (REQ-26) → aplicação.
 */
export function App() {
  const { me, loading } = useSession();
  if (loading) return <div className="empty">Carregando…</div>;
  if (!me) return <LoginPage />;
  if (me.mfa.required && !me.mfa.verified) return <MfaPage />;
  if (me.pendingLegal.length > 0) return <TermsPage />;
  if (!me.current) return <ClinicPickerPage />;

  return (
    <Routes>
      <Route path="/pacientes/:id/exportar" element={<ExportPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/pacientes" replace />} />
        <Route path="/pacientes" element={<PatientsPage />} />
        <Route path="/pacientes/novo" element={<PatientFormPage />} />
        <Route path="/pacientes/:id/editar" element={<PatientFormPage />} />
        <Route path="/pacientes/:id/:tab?" element={<PatientRecordPage />} />
        <Route path="/configuracoes/:tab?" element={<SettingsPage />} />
        <Route path="/usuarios" element={<UsersPage />} />
        <Route path="/modelo-anamnese" element={<TemplateEditorPage />} />
        <Route path="/auditoria" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/pacientes" replace />} />
      </Route>
    </Routes>
  );
}
