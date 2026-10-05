import { useEffect, useState, type FormEvent } from 'react';

type OvertimeSettings = {
  enabled: boolean;
  timeBankEnabled: boolean;
  monthlyLimitMinutes: number | null;
};

type OvertimeDay = {
  date: string;
  isWorkday: boolean;
  exception: { type: string; note: string | null } | null;
  plannedMinutes: number;
  workedMinutes: number;
  personalAbsenceMinutes: number;
  companyActivityMinutes: number;
  overtimeMinutes: number;
  bankMinutes: number;
  timeEntryCount: number;
  occurrenceCount: number;
  hasAnyData: boolean;
};

type OvertimeSummary = {
  month: string;
  settings: OvertimeSettings;
  totals: {
    plannedMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
    bankBalanceMinutes: number;
    daysWorked: number;
  };
  days: OvertimeDay[];
};

type BankMovement = {
  id: string;
  date: string;
  type: 'CREDIT' | 'DEBIT' | 'ADJUSTMENT';
  minutes: number;
  reason: string;
};

type OvertimeEntry = {
  id: string;
  date: string;
  minutes: number;
  includeInMonth: boolean | null;
  reason: string | null;
};

const formatMinutes = (minutes: number) => {
  const sign = minutes < 0 ? '-' : '';
  const absolute = Math.abs(minutes);
  return `${sign}${Math.floor(absolute / 60)}h ${String(absolute % 60).padStart(2, '0')}min`;
};

const parseResponse = async <T,>(response: Response): Promise<T> => {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? 'Não foi possível concluir a operação.');
  return payload as T;
};

type Props = {
  apiUrl: string;
  token: string;
  navigation: React.ReactNode;
  onLogout: () => void;
  page: 'overtime' | 'timeBank' | 'overtimeSettings';
};

export default function OvertimePanel({ apiUrl, token, navigation, onLogout, page }: Props) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState<OvertimeSummary | null>(null);
  const [movements, setMovements] = useState<BankMovement[]>([]);
  const [overtimeEntries, setOvertimeEntries] = useState<OvertimeEntry[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [settings, setSettings] = useState<OvertimeSettings>({ enabled: true, timeBankEnabled: true, monthlyLimitMinutes: null });
  const [entryForm, setEntryForm] = useState({ date: `${month}-01`, minutes: '', includeInMonth: '', reason: '' });
  const [movementForm, setMovementForm] = useState({ date: `${month}-01`, type: 'ADJUSTMENT', minutes: '', reason: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [summaryResponse, settingsResponse] = await Promise.all([
          fetch(`${apiUrl}/api/overtime/summary?month=${month}`, { headers }),
          fetch(`${apiUrl}/api/overtime/settings`, { headers }),
        ]);
        const [nextSummary, nextSettings] = await Promise.all([
          parseResponse<OvertimeSummary>(summaryResponse),
          parseResponse<OvertimeSettings>(settingsResponse),
        ]);
        let bank: { movements: BankMovement[] } = { movements: [] };
        if (nextSettings.timeBankEnabled) {
          const bankResponse = await fetch(`${apiUrl}/api/overtime/bank?month=${month}`, { headers });
          bank = await parseResponse<{ movements: BankMovement[] }>(bankResponse);
        }
        let entries: { entries: OvertimeEntry[] } = { entries: [] };
        if (nextSettings.enabled) {
          const entriesResponse = await fetch(`${apiUrl}/api/overtime/entries?month=${month}`, { headers });
          entries = await parseResponse<{ entries: OvertimeEntry[] }>(entriesResponse);
        }
        if (isActive) {
          setSummary(nextSummary);
          setSettings(nextSettings);
          setMovements(bank.movements);
          setOvertimeEntries(entries.entries);
        }
      } catch (loadError) {
        if (isActive) setError(loadError instanceof Error ? loadError.message : 'Erro ao carregar horas extras.');
      } finally {
        if (isActive) setIsLoading(false);
      }
    };
    void load();
    return () => { isActive = false; };
  }, [apiUrl, month, token]);

  const saveSettings = async () => {
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/api/overtime/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(settings),
      });
      const payload = await parseResponse<{ settings: OvertimeSettings }>(response);
      setSettings(payload.settings);
      setMessage('Configuração atualizada.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Erro ao salvar configuração.');
    }
  };

  const addOvertime = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/api/overtime/entries${editingEntryId ? `/${editingEntryId}` : ''}`, {
        method: editingEntryId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...entryForm,
          minutes: Number(entryForm.minutes),
          includeInMonth: entryForm.includeInMonth === '' ? null : entryForm.includeInMonth === 'true',
        }),
      });
      const payload = await parseResponse<{ entry: OvertimeEntry }>(response);
      setOvertimeEntries((current) => [
        ...current.filter(({ id }) => id !== payload.entry.id),
        payload.entry,
      ].sort((left, right) => left.date.localeCompare(right.date)));
      setMessage(editingEntryId ? 'Lançamento de hora extra atualizado.' : 'Lançamento de hora extra salvo.');
      setEditingEntryId(null);
      setEntryForm((current) => ({ ...current, minutes: '', reason: '' }));
      setMonth((current) => current);
      const refresh = await fetch(`${apiUrl}/api/overtime/summary?month=${month}`, { headers: { Authorization: `Bearer ${token}` } });
      setSummary(await parseResponse<OvertimeSummary>(refresh));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Erro ao salvar hora extra.');
    }
  };

  const deleteOvertime = async (id: string) => {
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/overtime/entries/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await parseResponse(response);
      setOvertimeEntries((current) => current.filter((entry) => entry.id !== id));
      setMessage('Lançamento excluído.');
      const refresh = await fetch(`${apiUrl}/api/overtime/summary?month=${month}`, { headers: { Authorization: `Bearer ${token}` } });
      setSummary(await parseResponse<OvertimeSummary>(refresh));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Erro ao excluir lançamento.');
    }
  };

  const addMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/api/overtime/bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...movementForm, minutes: Number(movementForm.minutes) }),
      });
      await parseResponse(response);
      setMessage('Movimento do banco de horas registrado.');
      setMovementForm((current) => ({ ...current, minutes: '', reason: '' }));
      const refresh = await fetch(`${apiUrl}/api/overtime/summary?month=${month}`, { headers: { Authorization: `Bearer ${token}` } });
      setSummary(await parseResponse<OvertimeSummary>(refresh));
      const bankRefresh = await fetch(`${apiUrl}/api/overtime/bank?month=${month}`, { headers: { Authorization: `Bearer ${token}` } });
      setMovements((await parseResponse<{ movements: BankMovement[] }>(bankRefresh)).movements);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Erro ao movimentar banco de horas.');
    }
  };

  const download = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/overtime/export?month=${month}&format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.message ?? 'Não foi possível gerar o relatório.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `relatorio-ponto-${month}.${format}`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Erro ao exportar relatório.');
    }
  };

  const title = page === 'overtimeSettings'
    ? 'Configuração de horas extras e banco'
    : page === 'timeBank'
      ? 'Banco de horas'
      : 'Apuração de horas extras';

  return (
    <div className="page-shell">
      <div className="dashboard-card workspace-card report-card">
        <div className="topbar"><div><span className="eyebrow">{page === 'overtimeSettings' ? 'Configurações' : 'Controle de jornada'}</span><h2>{title}</h2></div><button type="button" className="secondary-button" onClick={onLogout}>Sair</button></div>
        {navigation}
        {error && <p className="alert error">{error}</p>}
        {message && <p className="alert success">{message}</p>}

        {page === 'overtimeSettings' && (
          <>
            <section className="report-section">
              <h3>Regras de apuração</h3>
              <p className="form-hint">Defina como o sistema calcula as horas extras e alimenta o banco.</p>
              <div className="report-settings">
                <label><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} />Apurar horas extras</label>
                <label><input type="checkbox" checked={settings.timeBankEnabled} onChange={(event) => setSettings((current) => ({ ...current, timeBankEnabled: event.target.checked }))} />Acumular no banco de horas</label>
                <label>Limite mensal (minutos)<input type="number" min="0" max="100000" value={settings.monthlyLimitMinutes ?? ''} onChange={(event) => setSettings((current) => ({ ...current, monthlyLimitMinutes: event.target.value === '' ? null : Number(event.target.value) }))} /></label>
                <button type="button" className="primary-button" onClick={() => void saveSettings()}>Salvar configuração</button>
              </div>
            </section>
            <section className="report-section">
              <h3>Movimentar banco de horas</h3>
              <p className="form-hint">Registre créditos, débitos ou correções com justificativa.</p>
              <form className="report-form" onSubmit={addMovement}>
                <label>Data<input type="date" required value={movementForm.date} onChange={(event) => setMovementForm((current) => ({ ...current, date: event.target.value }))} /></label>
                <label>Tipo<select value={movementForm.type} onChange={(event) => setMovementForm((current) => ({ ...current, type: event.target.value }))}><option value="ADJUSTMENT">Ajuste positivo ou negativo</option><option value="CREDIT">Crédito</option><option value="DEBIT">Débito</option></select></label>
                <label>Minutos<input type="number" required value={movementForm.minutes} onChange={(event) => setMovementForm((current) => ({ ...current, minutes: event.target.value }))} /></label>
                <label>Motivo<input required minLength={3} maxLength={500} value={movementForm.reason} onChange={(event) => setMovementForm((current) => ({ ...current, reason: event.target.value }))} /></label>
                <button type="submit" className="secondary-button">Registrar movimento</button>
              </form>
            </section>
          </>
        )}

        {page !== 'overtimeSettings' && (
          <div className="report-toolbar">
            <label>Competência<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setEntryForm((current) => ({ ...current, date: `${event.target.value}-01` })); setMovementForm((current) => ({ ...current, date: `${event.target.value}-01` })); }} /></label>
            {page === 'overtime' && <div className="export-actions"><button type="button" className="secondary-button" onClick={() => void download('csv')}>CSV</button><button type="button" className="secondary-button" onClick={() => void download('xlsx')}>XLSX</button><button type="button" className="secondary-button" onClick={() => void download('pdf')}>PDF</button></div>}
          </div>
        )}

        {page === 'overtime' && (
          <>
            {isLoading && <p className="loading-note">Calculando a competência...</p>}
            {summary && <>
              <div className="dashboard-metrics report-metrics overtime-metrics">
                <div><span>Jornada prevista</span><strong>{formatMinutes(summary.totals.plannedMinutes)}</strong></div>
                <div><span>Tempo apurado</span><strong>{formatMinutes(summary.totals.workedMinutes)}</strong></div>
                <div><span>Horas extras</span><strong>{formatMinutes(summary.totals.overtimeMinutes)}</strong></div>
              </div>
              <section className="report-section">
                <div className="section-heading"><h3>Resumo diário</h3><span>{summary.totals.daysWorked} dias com marcações</span></div>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Data</th><th>Previsto</th><th>Apurado</th><th>Ausência</th><th>Extra</th><th>Eventos</th></tr></thead><tbody>
                  {summary.days.map((day) => <tr key={day.date} className={!day.isWorkday ? 'report-day-off' : ''}><td>{day.date}{day.exception?.note && <small>{day.exception.note}</small>}</td><td>{formatMinutes(day.plannedMinutes)}</td><td>{formatMinutes(day.workedMinutes)}</td><td>{formatMinutes(day.personalAbsenceMinutes)}</td><td>{formatMinutes(day.overtimeMinutes)}</td><td>{day.timeEntryCount + day.occurrenceCount}</td></tr>)}
                </tbody></table></div>
              </section>
            </>}
            <section className="report-section">
              <h3>Lançamentos de horas extras</h3>
              {overtimeEntries.length > 0 && <ol className="audit-list">{overtimeEntries.map((entry) => <li key={entry.id}><span>{entry.date.slice(0, 10)} · {formatMinutes(entry.minutes)} · {entry.includeInMonth === null ? 'Herdado' : entry.includeInMonth ? 'Incluído' : 'Excluído'}</span><div className="record-actions"><button type="button" className="text-button" onClick={() => { setEditingEntryId(entry.id); setEntryForm({ date: entry.date.slice(0, 10), minutes: String(entry.minutes), includeInMonth: entry.includeInMonth === null ? '' : String(entry.includeInMonth), reason: entry.reason ?? '' }); }}>Editar</button><button type="button" className="text-button danger-link" onClick={() => void deleteOvertime(entry.id)}>Excluir</button></div><small>{entry.reason}</small></li>)}</ol>}
              <form className="report-form" onSubmit={addOvertime}>
                <label>Data<input type="date" required value={entryForm.date} onChange={(event) => setEntryForm((current) => ({ ...current, date: event.target.value }))} /></label>
                <label>Duração (minutos)<input type="number" min="1" max="1440" required value={entryForm.minutes} onChange={(event) => setEntryForm((current) => ({ ...current, minutes: event.target.value }))} /></label>
                <label>Inclusão na competência<select value={entryForm.includeInMonth} onChange={(event) => setEntryForm((current) => ({ ...current, includeInMonth: event.target.value }))}><option value="">Seguir configuração</option><option value="true">Incluir</option><option value="false">Não incluir</option></select></label>
                <label>Motivo<input required minLength={3} maxLength={500} value={entryForm.reason} onChange={(event) => setEntryForm((current) => ({ ...current, reason: event.target.value }))} /></label>
                <button type="submit" className="primary-button">{editingEntryId ? 'Salvar lançamento' : 'Registrar hora extra'}</button>
                {editingEntryId && <button type="button" className="text-button" onClick={() => { setEditingEntryId(null); setEntryForm((current) => ({ ...current, minutes: '', reason: '' })); }}>Cancelar edição</button>}
              </form>
            </section>
          </>
        )}

        {page === 'timeBank' && (
          <>
            {isLoading && <p className="loading-note">Carregando saldo...</p>}
            {summary && <>
              <div className={`bank-balance ${summary.totals.bankBalanceMinutes < 0 ? 'negative' : ''}`}><span>Saldo acumulado</span><strong>{formatMinutes(summary.totals.bankBalanceMinutes)}</strong><small>Até {month}</small></div>
              {!settings.timeBankEnabled && <p className="empty-note">O banco de horas está desativado. Ative-o em Configurações.</p>}
            </>}
            <section className="report-section">
              <div className="section-heading"><h3>Movimentações</h3><span>{movements.length} nesta competência</span></div>
              {movements.length > 0 ? <ol className="audit-list">{movements.map((movement) => <li key={movement.id}><span>{movement.type === 'CREDIT' ? 'Crédito' : movement.type === 'DEBIT' ? 'Débito' : 'Ajuste'} · {formatMinutes(movement.minutes)}</span><time>{movement.date.slice(0, 10)}</time><small>{movement.reason}</small></li>)}</ol> : <p className="empty-note">Nenhuma movimentação manual nesta competência.</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
