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
import { SupportPage } from './pages/Support';
import { AgendaPage } from './pages/Agenda';
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
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/suporte" element={<SupportPage />} />
        <Route path="/suporte/:ticketId" element={<SupportPage />} />
        <Route path="/auditoria" element={<AuditPage />} />
        <Route path="/configuracoes/:tab?" element={<SettingsPage />} />
        {/* Endereços antigos continuam funcionando */}
        <Route path="/usuarios" element={<Navigate to="/configuracoes/usuarios" replace />} />
        <Route path="/modelo-anamnese" element={<Navigate to="/configuracoes/anamnese" replace />} />
        <Route path="/configuracoes/suporte" element={<Navigate to="/suporte" replace />} />
        <Route path="*" element={<Navigate to="/pacientes" replace />} />
      </Route>
    </Routes>
  );
}
