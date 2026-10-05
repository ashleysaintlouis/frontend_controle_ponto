import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import OvertimePanel from './OvertimePanel';
import './App.css';

type AuthMode = 'login' | 'register' | 'recover' | 'reset';
type AppView = 'preferences' | 'dashboard' | 'schedule' | 'records' | 'occurrences' | 'overtime' | 'timeBank' | 'overtimeSettings';

type User = {
  id: string;
  name: string;
  email: string;
  status: string;
  setupCompleted: boolean;
  timeFormat: 'H24' | 'H12';
  timezone: string;
  language: 'ht' | 'fr' | 'en' | 'pt-BR' | 'es';
};

type LanguageOption = 'ht' | 'fr' | 'en' | 'pt-BR' | 'es';

type ScheduleDay = {
  dayOfWeek: number;
  isWorkday: boolean;
  dailyWorkMinutes: number;
  startTime: string;
  endTime: string;
  periods: Array<{ order: number; startTime: string; endTime: string }>;
  breakStart: string | null;
  breakEnd: string | null;
  entryToleranceMinutes: number;
  exitToleranceMinutes: number;
  breakStartToleranceMinutes: number;
  breakEndToleranceMinutes: number;
};

type SchedulePolicy = {
  defaultDailyWorkMinutes: number;
  entryToleranceMinutes: number;
  exitToleranceMinutes: number;
  breakStartToleranceMinutes: number;
  breakEndToleranceMinutes: number;
};

type ScheduleException = {
  id: string;
  date: string;
  type: 'HOLIDAY' | 'DAY_OFF' | 'WORKDAY_OVERRIDE';
  note: string | null;
  startTime: string | null;
  endTime: string | null;
};

type TimeEntry = {
  id: string;
  type: string;
  timestamp: string;
  isManual: boolean;
  notes: string | null;
  images?: ImageAttachment[];
};

type ImageAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

type Occurrence = {
  id: string;
  type: 'PERSONAL_WITH_RETURN' | 'PERSONAL_WITHOUT_RETURN' | 'COMPANY_ACTIVITY';
  startAt: string;
  endAt: string | null;
  notes: string;
  images?: ImageAttachment[];
};

type TimeEntryAudit = {
  id: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  reason: string;
  createdAt: string;
};

type NotificationItem = {
  id: string;
  type: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'READ';
  message: string;
  scheduledAt: string;
};

type SecurityEvent = {
  id: string;
  type: string;
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

type DashboardData = {
  date: string;
  weekday: string;
  status: string;
  statusMessage: string;
  schedule: ScheduleDay;
  exception: { type: string; note: string | null } | null;
  plannedMinutes: number;
  workedMinutes: number;
  entries: Array<{ id: string; type: string; time: string; notes: string | null }>;
  occurrences: Occurrence[];
  notifications: NotificationItem[];
};

const API_URL = import.meta.env.API_URL_BACK ?? 'http://localhost:3334';
const TOKEN_KEY = 'controle-ponto-token';
const resetToken = new URLSearchParams(window.location.search).get('token');
const weekdayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const eventLabels: Record<string, string> = {
  CLOCK_IN: 'Entrada',
  BREAK_START: 'Início do intervalo',
  BREAK_END: 'Fim do intervalo',
  CLOCK_OUT: 'Saída',
  MANUAL: 'Registro manual',
};
const occurrenceLabels: Record<Occurrence['type'], string> = {
  PERSONAL_WITH_RETURN: 'Atividade pessoal com retorno',
  PERSONAL_WITHOUT_RETURN: 'Atividade pessoal sem retorno',
  COMPANY_ACTIVITY: 'Atividade da empresa',
};

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes} min`;
  return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
};

const toLocalDateTimeInput = (timestamp: string) => {
  const date = new Date(timestamp);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

const parseApiResponse = async <T,>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    const text = await response.text();
    if (contentType.includes('text/html') || /^\s*<!doctype html|^\s*<html/i.test(text)) {
      throw new Error('O servidor retornou um erro inesperado. Verifique o terminal do backend.');
    }

    throw new Error(text || 'Resposta inesperada do servidor.');
  }

  const payload = await response.json();
  return payload as T;
};

const timezones = [
  { value: 'America/Sao_Paulo', label: 'Brasil - São Paulo (GMT-3)' },
  { value: 'America/Bahia', label: 'Brasil - Bahia (GMT-3)' },
  { value: 'America/Rio_Branco', label: 'Brasil - Rio Branco (GMT-4)' },
  { value: 'America/Recife', label: 'Brasil - Recife (GMT-3)' },
  { value: 'America/New_York', label: 'Estados Unidos - Nova York (GMT-5)' },
  { value: 'America/Los_Angeles', label: 'Estados Unidos - Los Angeles (GMT-8)' },
  { value: 'Europe/London', label: 'Reino Unido - Londres (GMT+0)' },
  { value: 'Europe/Paris', label: 'França - Paris (GMT+1)' },
  { value: 'Europe/Berlin', label: 'Alemanha - Berlim (GMT+1)' },
  { value: 'Asia/Tokyo', label: 'Japão - Tóquio (GMT+9)' },
  { value: 'Australia/Sydney', label: 'Austrália - Sydney (GMT+10)' },
  { value: 'UTC', label: 'Tempo Universal (UTC)' },
];

const languageOptions: Array<{ value: LanguageOption; label: string }> = [
  { value: 'ht', label: 'Crioulo haitiano (Kreyòl ayisyen)' },
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'es', label: 'Español' },
];

const isBrazilTimezone = (timezone: string) =>
  ['America/Sao_Paulo', 'America/Bahia', 'America/Rio_Branco', 'America/Recife'].includes(timezone);

function App() {
  const [authMode, setAuthMode] = useState<AuthMode>(
    new URLSearchParams(window.location.search).get('mode') === 'reset' && resetToken
      ? 'reset'
      : 'login',
  );
  const [allowGoogleOAuth, setAllowGoogleOAuth] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<AppView>('dashboard');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [welcomeAnimation, setWelcomeAnimation] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);
  const [schedulePolicy, setSchedulePolicy] = useState<SchedulePolicy>({
    defaultDailyWorkMinutes: 480,
    entryToleranceMinutes: 10,
    exitToleranceMinutes: 10,
    breakStartToleranceMinutes: 10,
    breakEndToleranceMinutes: 10,
  });
  const [scheduleExceptions, setScheduleExceptions] = useState<ScheduleException[]>([]);
  const [exceptionForm, setExceptionForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: 'HOLIDAY' as ScheduleException['type'],
    note: '',
    startTime: '09:00',
    endTime: '18:00',
  });
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [allowedClockTypes, setAllowedClockTypes] = useState<string[]>([]);
  const [timeEntryAudit, setTimeEntryAudit] = useState<TimeEntryAudit[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [recordDate, setRecordDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [dashboardRefresh, setDashboardRefresh] = useState(0);
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [isRecordsLoading, setIsRecordsLoading] = useState(false);
  const [isOccurrenceLoading, setIsOccurrenceLoading] = useState(false);
  const [isClockLoading, setIsClockLoading] = useState(false);
  const [manualEntry, setManualEntry] = useState({ type: 'CLOCK_IN', timestamp: '', reason: '' });
  const [manualImages, setManualImages] = useState<File[]>([]);
  const [editingEntry, setEditingEntry] = useState<{ id: string; type: string; timestamp: string; reason: string; images: File[] } | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<{ id: string; reason: string } | null>(null);
  const [occurrenceForm, setOccurrenceForm] = useState({
    type: 'PERSONAL_WITH_RETURN' as Occurrence['type'],
    startAt: '',
    endAt: '',
    notes: '',
  });
  const [occurrenceImages, setOccurrenceImages] = useState<File[]>([]);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    timeFormat: 'H24',
    timezone: 'America/Sao_Paulo',
    language: 'pt-BR' as LanguageOption,
  });

  const showLanguageSelector = !isBrazilTimezone(form.timezone);

  const greeting = useMemo(() => {
    if (!user) return authMode === 'reset' ? 'Redefinir senha' : 'Acesso ao sistema';
    return `Bem-vindo, ${user.name}`;
  }, [authMode, user]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth/config`);
        const payload = await parseApiResponse<{
          allowGoogleOAuth?: boolean;
          googleClientId?: string;
        }>(response);
        setAllowGoogleOAuth(Boolean(payload.allowGoogleOAuth));
        setGoogleClientId(payload.googleClientId ?? '');
      } catch {
        setAllowGoogleOAuth(true);
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    if (!token) return;

    const loadProfile = async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Sessão inválida');
        }

        const payload = await parseApiResponse<{ user: User }>(response);
        setUser(payload.user);
        setView(payload.user.setupCompleted ? 'dashboard' : 'preferences');
        setWelcomeMessage(
          payload.user.setupCompleted ? `Bem-vinda de volta, ${payload.user.name}.` : '',
        );
        setForm((current) => ({
          ...current,
          timeFormat: payload.user.timeFormat,
          timezone: payload.user.timezone,
          language: payload.user.language ?? 'pt-BR',
        }));
        setRecordDate(new Intl.DateTimeFormat('en-CA', { timeZone: payload.user.timezone }).format(new Date()));
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      }
    };

    loadProfile();
  }, [token]);

  useEffect(() => {
    if (!token || view !== 'schedule') return;
    let isActive = true;

    const loadSchedule = async () => {
      setIsScheduleLoading(true);
      setError('');
      try {
        const month = exceptionForm.date.slice(0, 7);
        const [scheduleResponse, exceptionsResponse, policyResponse] = await Promise.all([
          fetch(`${API_URL}/api/schedules`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_URL}/api/schedules/exceptions?month=${month}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_URL}/api/schedules/settings`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const [payload, exceptionPayload, policyPayload] = await Promise.all([
          parseApiResponse<{ days: ScheduleDay[] }>(scheduleResponse),
          parseApiResponse<{ exceptions: ScheduleException[] }>(exceptionsResponse),
          parseApiResponse<{ policy: SchedulePolicy }>(policyResponse),
        ]);
        if (!scheduleResponse.ok || !exceptionsResponse.ok || !policyResponse.ok) throw new Error('Não foi possível carregar a jornada.');
        if (isActive) {
          setScheduleDays(payload.days);
          setScheduleExceptions(exceptionPayload.exceptions);
          setSchedulePolicy(policyPayload.policy);
        }
      } catch (requestError) {
        if (isActive) setError(requestError instanceof Error ? requestError.message : 'Erro ao carregar jornada.');
      } finally {
        if (isActive) setIsScheduleLoading(false);
      }
    };

    loadSchedule();
    return () => { isActive = false; };
  }, [token, view, exceptionForm.date]);

  useEffect(() => {
    if (!token || view !== 'dashboard') return;
    let isActive = true;

    const loadDashboard = async () => {
      setIsDashboardLoading(true);
      try {
        const response = await fetch(`${API_URL}/api/dashboard/today`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await parseApiResponse<DashboardData & { message?: string }>(response);
        if (!response.ok) throw new Error(payload.message ?? 'Não foi possível carregar o resumo de hoje.');
        if (isActive) {
          setDashboardData(payload);
          setOccurrences(payload.occurrences ?? []);
        }
      } catch (requestError) {
        if (isActive) setError(requestError instanceof Error ? requestError.message : 'Erro ao carregar o Início.');
      } finally {
        if (isActive) setIsDashboardLoading(false);
      }
    };

    loadDashboard();
    return () => { isActive = false; };
  }, [token, view, dashboardRefresh]);

  useEffect(() => {
    if (!token || view !== 'records') return;
    let isActive = true;

    const loadRecords = async () => {
      setIsRecordsLoading(true);
      setError('');
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [entriesResponse, nextResponse, auditResponse, securityResponse] = await Promise.all([
          fetch(`${API_URL}/api/time-entries?date=${recordDate}`, { headers }),
          fetch(`${API_URL}/api/time-entries/next`, { headers }),
          fetch(`${API_URL}/api/time-entries/audit`, { headers }),
          fetch(`${API_URL}/api/audit/security`, { headers }),
        ]);
        const [entriesPayload, nextPayload, auditPayload, securityPayload] = await Promise.all([
          parseApiResponse<{ entries: TimeEntry[] }>(entriesResponse),
          parseApiResponse<{ allowedTypes: string[] }>(nextResponse),
          parseApiResponse<{ audit: TimeEntryAudit[] }>(auditResponse),
          parseApiResponse<{ events: SecurityEvent[] }>(securityResponse),
        ]);
        if (!entriesResponse.ok || !nextResponse.ok || !auditResponse.ok || !securityResponse.ok) {
          throw new Error('Não foi possível carregar as marcações de hoje.');
        }
        if (isActive) {
          setTimeEntries(entriesPayload.entries);
          setAllowedClockTypes(nextPayload.allowedTypes);
          setTimeEntryAudit(auditPayload.audit);
          setSecurityEvents(securityPayload.events);
        }
      } catch (requestError) {
        if (isActive) setError(requestError instanceof Error ? requestError.message : 'Erro ao carregar marcações.');
      } finally {
        if (isActive) setIsRecordsLoading(false);
      }
    };

    loadRecords();
    return () => { isActive = false; };
  }, [token, view, dashboardRefresh, recordDate]);

  useEffect(() => {
    if (!token || view !== 'occurrences') return;
    let isActive = true;

    const loadOccurrences = async () => {
      setIsOccurrenceLoading(true);
      setError('');
      try {
        const response = await fetch(`${API_URL}/api/occurrences`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await parseApiResponse<{ occurrences: Occurrence[]; message?: string }>(response);
        if (!response.ok) throw new Error(payload.message ?? 'Não foi possível carregar ocorrências.');
        if (isActive) setOccurrences(payload.occurrences);
      } catch (requestError) {
        if (isActive) setError(requestError instanceof Error ? requestError.message : 'Erro ao carregar ocorrências.');
      } finally {
        if (isActive) setIsOccurrenceLoading(false);
      }
    };

    loadOccurrences();
    return () => { isActive = false; };
  }, [token, view]);

  useEffect(() => {
    if (!token) return;
    let isActive = true;
    const createdUrls: string[] = [];
    const imageRequests = [
      ...timeEntries.flatMap((entry) => (entry.images ?? []).map((image) => ({
        image,
        path: `/api/time-entries/images/${image.id}`,
      }))),
      ...occurrences.flatMap((occurrence) => (occurrence.images ?? []).map((image) => ({
        image,
        path: `/api/occurrences/images/${image.id}`,
      }))),
    ];

    void Promise.all(imageRequests.map(async ({ image, path }) => {
      try {
        const response = await fetch(`${API_URL}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return null;
        const imageUrl = URL.createObjectURL(await response.blob());
        createdUrls.push(imageUrl);
        return [image.id, imageUrl] as const;
      } catch {
        return null;
      }
    })).then((loadedImages) => {
      if (isActive) setImageUrls(Object.fromEntries(loadedImages.filter((item): item is readonly [string, string] => item !== null)));
      else createdUrls.forEach((imageUrl) => URL.revokeObjectURL(imageUrl));
    });

    return () => {
      isActive = false;
      createdUrls.forEach((imageUrl) => URL.revokeObjectURL(imageUrl));
    };
  }, [token, timeEntries, occurrences]);

  const handleChange = (field: string, value: string) => {
    setForm((current) => {
      if (field === 'timezone') {
        const nextTimezone = value;
        const nextLanguage = isBrazilTimezone(nextTimezone)
          ? 'pt-BR'
          : current.language || 'en-US';

        return { ...current, timezone: nextTimezone, language: nextLanguage };
      }

      if (field === 'language') {
        return { ...current, language: value as LanguageOption };
      }

      return { ...current, [field]: value };
    });
  };

  const readImageFiles = (files: FileList | null): File[] | null => {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length > 3) {
      setError('Anexe no máximo 3 imagens por registro.');
      return null;
    }
    if (selectedFiles.some((file) => file.size > 5 * 1024 * 1024)) {
      setError('Cada imagem pode ter até 5 MB.');
      return null;
    }
    if (selectedFiles.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setError('Use imagens JPEG, PNG ou WebP.');
      return null;
    }
    setError('');
    return selectedFiles;
  };

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if ((authMode === 'register' || authMode === 'reset') && form.password !== form.confirmPassword) {
      setError('As senhas informadas não coincidem.');
      return;
    }

    setIsLoading(true);

    const endpoint = {
      login: '/api/auth/login',
      register: '/api/auth/register',
      recover: '/api/auth/forgot-password',
      reset: '/api/auth/reset-password',
    }[authMode];

    try {
      const body =
        authMode === 'recover'
          ? { email: form.email }
          : authMode === 'reset'
            ? { token: resetToken, password: form.password }
            : {
              name: form.name,
              email: form.email,
              password: form.password,
            };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await parseApiResponse<{
        message?: string;
        token?: string;
        user?: User;
        emailSent?: boolean;
        newUser?: boolean;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.message ?? 'Não foi possível concluir a operação.');
      }

      if (authMode === 'recover') {
        if (!payload.message) {
          throw new Error('Resposta inesperada do servidor.');
        }

        setMessage(payload.message);
        return;
      }

      if (authMode === 'reset') {
        setMessage(payload.message ?? 'Senha redefinida com sucesso.');
        setAuthMode('login');
        setForm((current) => ({ ...current, password: '', confirmPassword: '' }));
        window.history.replaceState({}, '', window.location.pathname);
        return;
      }

      if (authMode === 'register') {
        setAuthMode('login');
        setForm((current) => ({ ...current, name: '', password: '', confirmPassword: '' }));
        setMessage(
          payload.emailSent
            ? 'Cadastro realizado. Faça login para configurar sua conta.'
            : 'Cadastro realizado. Faça login para continuar; o e-mail de boas-vindas não foi enviado.',
        );
        return;
      }

      const nextToken = payload.token;

      if (!nextToken || !payload.user) {
        throw new Error('Resposta do servidor incompleta.');
      }

      localStorage.setItem(TOKEN_KEY, nextToken);
      setToken(nextToken);
      setUser(payload.user);
      const setupCompleted = payload.user.setupCompleted;
      setView(setupCompleted ? 'dashboard' : 'preferences');
      setWelcomeMessage(setupCompleted ? `Bem-vinda de volta, ${payload.user.name}.` : '');
      setMessage('');
      setAuthMode('login');
      setForm((current) => ({ ...current, name: '', password: '', confirmPassword: '' }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro inesperado.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async (credential: string) => {
    setError('');
    setMessage('');

    try {
      const response = await fetch(`${API_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      const payload = await parseApiResponse<{
        message?: string;
        token?: string;
        user?: User;
        emailSent?: boolean;
        newUser?: boolean;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.message ?? 'Não foi possível entrar com o Google.');
      }

      if (!payload.token || !payload.user) {
        throw new Error('Resposta do servidor incompleta.');
      }

      localStorage.setItem(TOKEN_KEY, payload.token);
      setToken(payload.token);
      setUser(payload.user);
      const setupCompleted = payload.user.setupCompleted;
      setView(setupCompleted ? 'dashboard' : 'preferences');
      setWelcomeMessage(setupCompleted ? `Bem-vinda de volta, ${payload.user.name}.` : '');
      setMessage(payload.newUser && !payload.emailSent ? 'Conta criada, mas o e-mail de boas-vindas não foi enviado.' : '');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao entrar com o Google.');
    }
  };

  const updatePreferences = async () => {
    if (!token || !user) return;

    try {
      const response = await fetch(`${API_URL}/api/auth/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          timeFormat: form.timeFormat,
          timezone: form.timezone,
          language: form.language,
        }),
      });

      const payload = await parseApiResponse<{ message?: string; user?: User }>(response);

      if (!response.ok) {
        throw new Error(payload.message ?? 'Não foi possível salvar as preferências.');
      }

      if (!payload.user) {
        throw new Error('Resposta do servidor incompleta.');
      }

      const isInitialSetup = !user.setupCompleted;
      setUser(payload.user);
      setView('dashboard');
      setWelcomeMessage(isInitialSetup ? `Bem-vinda, ${payload.user.name}!` : '');
      setWelcomeAnimation(isInitialSetup);
      setMessage(isInitialSetup ? '' : 'Preferências atualizadas com sucesso.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao salvar preferências.');
    }
  };

  const updateScheduleDay = (
    dayOfWeek: number,
    field: keyof Omit<ScheduleDay, 'dayOfWeek'>,
    value: boolean | number | string | null,
  ) => {
    setScheduleDays((current) => current.map((day) =>
      day.dayOfWeek === dayOfWeek ? { ...day, [field]: value } : day,
    ));
  };

  const updateSchedulePeriod = (
    dayOfWeek: number,
    periodOrder: number,
    field: 'startTime' | 'endTime',
    value: string,
  ) => {
    setScheduleDays((current) => current.map((day) => day.dayOfWeek !== dayOfWeek ? day : {
      ...day,
      periods: day.periods.map((period) => period.order === periodOrder ? { ...period, [field]: value } : period),
    }));
  };

  const addSchedulePeriod = (dayOfWeek: number) => {
    setScheduleDays((current) => current.map((day) => {
      if (day.dayOfWeek !== dayOfWeek) return day;
      const lastPeriod = day.periods.at(-1);
      const nextStart = lastPeriod?.endTime ?? '09:00';
      const nextStartMinutes = Number(nextStart.slice(0, 2)) * 60 + Number(nextStart.slice(3));
      const nextEndMinutes = Math.min(nextStartMinutes + 60, 23 * 60 + 59);
      const endTime = `${String(Math.floor(nextEndMinutes / 60)).padStart(2, '0')}:${String(nextEndMinutes % 60).padStart(2, '0')}`;
      return { ...day, periods: [...day.periods, { order: day.periods.length, startTime: nextStart, endTime }] };
    }));
  };

  const removeSchedulePeriod = (dayOfWeek: number, periodOrder: number) => {
    setScheduleDays((current) => current.map((day) => day.dayOfWeek !== dayOfWeek ? day : {
      ...day,
      periods: day.periods.filter((period) => period.order !== periodOrder).map((period, order) => ({ ...period, order })),
    }));
  };

  const saveScheduleException = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/schedules/exceptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...exceptionForm,
          startTime: exceptionForm.type === 'WORKDAY_OVERRIDE' ? exceptionForm.startTime : null,
          endTime: exceptionForm.type === 'WORKDAY_OVERRIDE' ? exceptionForm.endTime : null,
        }),
      });
      const payload = await parseApiResponse<{ exception?: ScheduleException; message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível salvar a exceção.');
      if (payload.exception) {
        setScheduleExceptions((current) => [...current.filter((item) => item.date.slice(0, 10) !== exceptionForm.date), payload.exception!].sort((left, right) => left.date.localeCompare(right.date)));
      }
      setMessage('Exceção de calendário salva.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao salvar exceção.');
    }
  };

  const removeScheduleException = async (id: string) => {
    if (!token) return;
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/schedules/exceptions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await parseApiResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível remover a exceção.');
      setScheduleExceptions((current) => current.filter((item) => item.id !== id));
      setMessage('Exceção removida.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao remover exceção.');
    }
  };

  const saveSchedule = async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(`${API_URL}/api/schedules`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ days: scheduleDays }),
      });
      const payload = await parseApiResponse<{ days?: ScheduleDay[]; message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível salvar a jornada.');
      if (!payload.days) throw new Error('Resposta incompleta ao salvar a jornada.');
      setScheduleDays(payload.days);
      setView('dashboard');
      setMessage('Jornada semanal salva.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao salvar a jornada.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveSchedulePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/schedules/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(schedulePolicy),
      });
      const payload = await parseApiResponse<{ policy: SchedulePolicy; message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível salvar a política geral.');
      setSchedulePolicy(payload.policy);
      setMessage('Carga horária e tolerâncias gerais salvas. Dias personalizados foram preservados.');
      setScheduleDays((current) => current.map((day) => ({
        ...day,
        dailyWorkMinutes: day.dailyWorkMinutes === schedulePolicy.defaultDailyWorkMinutes
          ? payload.policy.defaultDailyWorkMinutes
          : day.dailyWorkMinutes,
        entryToleranceMinutes: day.entryToleranceMinutes === schedulePolicy.entryToleranceMinutes
          ? payload.policy.entryToleranceMinutes
          : day.entryToleranceMinutes,
        exitToleranceMinutes: day.exitToleranceMinutes === schedulePolicy.exitToleranceMinutes
          ? payload.policy.exitToleranceMinutes
          : day.exitToleranceMinutes,
        breakStartToleranceMinutes: day.breakStartToleranceMinutes === schedulePolicy.breakStartToleranceMinutes
          ? payload.policy.breakStartToleranceMinutes
          : day.breakStartToleranceMinutes,
        breakEndToleranceMinutes: day.breakEndToleranceMinutes === schedulePolicy.breakEndToleranceMinutes
          ? payload.policy.breakEndToleranceMinutes
          : day.breakEndToleranceMinutes,
      })));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao salvar a política geral.');
    }
  };

  const registerClock = async (type: string) => {
    if (!token) return;
    setIsClockLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/time-entries/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type }),
      });
      const payload = await parseApiResponse<{ message?: string; entry?: { timestamp: string } }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível registrar o ponto.');
      const recordedTime = payload.entry?.timestamp
        ? new Intl.DateTimeFormat('pt-BR', {
          timeZone: form.timezone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: form.timeFormat === 'H24' ? 'h23' : 'h12',
        }).format(new Date(payload.entry.timestamp))
        : null;
      setMessage(recordedTime ? `Ponto registrado às ${recordedTime}.` : payload.message ?? 'Ponto registrado com sucesso!');
      setDashboardRefresh((count) => count + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao registrar ponto.');
    } finally {
      setIsClockLoading(false);
    }
  };

  const submitManualEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setIsClockLoading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('type', manualEntry.type);
      body.append('timestamp', new Date(manualEntry.timestamp).toISOString());
      body.append('reason', manualEntry.reason);
      manualImages.forEach((image) => body.append('images', image));
      const response = await fetch(`${API_URL}/api/time-entries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const payload = await parseApiResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível incluir a marcação.');
      setMessage(payload.message ?? 'Ponto registrado com sucesso!');
      setManualEntry((current) => ({ ...current, timestamp: '', reason: '' }));
      setManualImages([]);
      setDashboardRefresh((count) => count + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao incluir marcação.');
    } finally {
      setIsClockLoading(false);
    }
  };

  const saveEntryEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !editingEntry) return;
    setIsClockLoading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('type', editingEntry.type);
      body.append('timestamp', new Date(editingEntry.timestamp).toISOString());
      body.append('reason', editingEntry.reason);
      editingEntry.images.forEach((image) => body.append('images', image));
      const response = await fetch(`${API_URL}/api/time-entries/${editingEntry.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const payload = await parseApiResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível corrigir a marcação.');
      setMessage(payload.message ?? 'Marcação atualizada.');
      setEditingEntry(null);
      setDashboardRefresh((count) => count + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao corrigir marcação.');
    } finally {
      setIsClockLoading(false);
    }
  };

  const deleteEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !deletingEntry) return;
    setIsClockLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/time-entries/${deletingEntry.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: deletingEntry.reason }),
      });
      const payload = await parseApiResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível excluir a marcação.');
      setMessage(payload.message ?? 'Marcação excluída.');
      setDeletingEntry(null);
      setDashboardRefresh((count) => count + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao excluir marcação.');
    } finally {
      setIsClockLoading(false);
    }
  };

  const submitOccurrence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('type', occurrenceForm.type);
      body.append('startAt', new Date(occurrenceForm.startAt).toISOString());
      if (occurrenceForm.type !== 'PERSONAL_WITHOUT_RETURN') {
        body.append('endAt', new Date(occurrenceForm.endAt).toISOString());
      }
      body.append('notes', occurrenceForm.notes);
      occurrenceImages.forEach((image) => body.append('images', image));
      const response = await fetch(`${API_URL}/api/occurrences`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const payload = await parseApiResponse<{ occurrence?: Occurrence; message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível registrar a ocorrência.');
      if (!payload.occurrence) throw new Error('Resposta incompleta ao registrar ocorrência.');
      setOccurrences((current) => [...current, payload.occurrence!].sort((left, right) => left.startAt.localeCompare(right.startAt)));
      setOccurrenceForm((current) => ({ ...current, startAt: '', endAt: '', notes: '' }));
      setOccurrenceImages([]);
      setMessage(payload.message ?? 'Ocorrência registrada.');
      setDashboardRefresh((count) => count + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao registrar ocorrência.');
    } finally {
      setIsLoading(false);
    }
  };

  const removeOccurrence = async (occurrenceId: string) => {
    if (!token) return;
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/occurrences/${occurrenceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await parseApiResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível excluir a ocorrência.');
      setOccurrences((current) => current.filter(({ id }) => id !== occurrenceId));
      setMessage(payload.message ?? 'Ocorrência excluída.');
      setDashboardRefresh((count) => count + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao excluir ocorrência.');
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await parseApiResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível atualizar o alerta.');
      setDashboardData((current) => current ? {
        ...current,
        notifications: current.notifications.map((item) => item.id === notificationId ? { ...item, status: 'READ' } : item),
      } : current);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Erro ao atualizar alerta.');
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setView('dashboard');
    setWelcomeMessage('');
    setMessage('Sessão encerrada.');
  };

  if (!token || !user) {
    return (
      <div className="page-shell">
        <div className="auth-card">
          <div className="auth-header">
            <span className="eyebrow">Controle de ponto</span>
            <h1>{greeting}</h1>
            <p>Autenticação local com validação segura e suporte ao Google.</p>
          </div>

          {authMode !== 'reset' && <div className="auth-tabs" role="tablist" aria-label="Formulário de autenticação">
            <button
              type="button"
              className={authMode === 'login' ? 'active' : ''}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={authMode === 'register' ? 'active' : ''}
              onClick={() => setAuthMode('register')}
            >
              Cadastro
            </button>
            <button
              type="button"
              className={authMode === 'recover' ? 'active' : ''}
              onClick={() => setAuthMode('recover')}
            >
              Recuperar senha
            </button>
          </div>}

          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === 'register' && (
              <label>
                Nome completo
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => handleChange('name', event.target.value)}
                  placeholder="Seu nome"
                />
              </label>
            )}

            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(event) => handleChange('email', event.target.value)}
                placeholder="seu@email.com"
              />
            </label>

            {authMode !== 'recover' && (
              <>
                <label>
                  {authMode === 'reset' ? 'Nova senha' : 'Senha'}
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) => handleChange('password', event.target.value)}
                    placeholder="Mínimo 8 caracteres"
                  />
                </label>

                {(authMode === 'register' || authMode === 'reset') && (
                  <label>
                    Confirmar senha
                    <input
                      type="password"
                      value={form.confirmPassword}
                      onChange={(event) => handleChange('confirmPassword', event.target.value)}
                      placeholder="Repita a senha"
                    />
                  </label>
                )}
              </>
            )}

            {(authMode === 'register' || authMode === 'reset') && form.password && form.confirmPassword && form.password !== form.confirmPassword && (
              <p className="field-error">As senhas informadas não coincidem.</p>
            )}

            {error && <p className="alert error">{error}</p>}
            {message && <p className="alert success">{message}</p>}

            <button type="submit" className="primary-button" disabled={isLoading}>
              {isLoading
                ? 'Aguarde...'
                : authMode === 'login'
                  ? 'Entrar'
                  : authMode === 'register'
                    ? 'Criar conta'
                    : authMode === 'reset'
                      ? 'Redefinir senha'
                      : 'Enviar link'}
            </button>
          </form>

          {authMode === 'reset' && (
            <button type="button" className="secondary-button" onClick={() => setAuthMode('login')}>
              Voltar ao login
            </button>
          )}

          {allowGoogleOAuth && googleClientId && authMode !== 'reset' && (
            <div className="google-button">
              <GoogleOAuthProvider clientId={googleClientId}>
                <GoogleLogin
                  onSuccess={({ credential }) => {
                    if (credential) void handleGoogleLogin(credential);
                    else setError('O Google não retornou uma credencial válida.');
                  }}
                  onError={() => setError('Não foi possível autenticar com o Google.')}
                  text="continue_with"
                  theme="outline"
                  width="100%"
                />
              </GoogleOAuthProvider>
            </div>
          )}
        </div>
      </div>
    );
  }

  const navigation = (
    <nav className="workspace-nav" aria-label="Navegação principal">
      <button type="button" aria-current={view === 'dashboard' ? 'page' : undefined} className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>Início</button>
      <details className={`nav-group ${view === 'records' || view === 'occurrences' ? 'active' : ''}`}>
        <summary>Registros<span aria-hidden="true">⌄</span></summary>
        <div className="nav-group-menu">
          <button type="button" aria-current={view === 'records' ? 'page' : undefined} className={view === 'records' ? 'active' : ''} onClick={(event) => { setView('records'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Marcações</button>
          <button type="button" aria-current={view === 'occurrences' ? 'page' : undefined} className={view === 'occurrences' ? 'active' : ''} onClick={(event) => { setView('occurrences'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Ocorrências</button>
        </div>
      </details>
      <details className={`nav-group ${view === 'schedule' || view === 'preferences' || view === 'overtimeSettings' ? 'active' : ''}`}>
        <summary>Configurações<span aria-hidden="true">⌄</span></summary>
        <div className="nav-group-menu">
          <button type="button" aria-current={view === 'schedule' ? 'page' : undefined} className={view === 'schedule' ? 'active' : ''} onClick={(event) => { setView('schedule'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Jornada e calendário</button>
          <button type="button" aria-current={view === 'preferences' ? 'page' : undefined} className={view === 'preferences' ? 'active' : ''} onClick={(event) => { setView('preferences'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Preferências</button>
          <button type="button" aria-current={view === 'overtimeSettings' ? 'page' : undefined} className={view === 'overtimeSettings' ? 'active' : ''} onClick={(event) => { setView('overtimeSettings'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Horas extras e banco</button>
        </div>
      </details>
      <details className={`nav-group ${view === 'overtime' || view === 'timeBank' ? 'active' : ''}`}>
        <summary>Relatórios<span aria-hidden="true">⌄</span></summary>
        <div className="nav-group-menu">
          <button type="button" aria-current={view === 'overtime' ? 'page' : undefined} className={view === 'overtime' ? 'active' : ''} onClick={(event) => { setView('overtime'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Apuração de extras</button>
          <button type="button" aria-current={view === 'timeBank' ? 'page' : undefined} className={view === 'timeBank' ? 'active' : ''} onClick={(event) => { setView('timeBank'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Banco de horas</button>
        </div>
      </details>
    </nav>
  );

  if (view === 'overtime' || view === 'timeBank' || view === 'overtimeSettings') {
    return <OvertimePanel apiUrl={API_URL} token={token} navigation={navigation} onLogout={logout} page={view} />;
  }

  if (view === 'preferences') {
    return (
      <div className="page-shell">
        <div className="dashboard-card workspace-card">
          <div className="topbar">
            <div><span className="eyebrow">{user.setupCompleted ? 'Sua conta' : 'Primeiro acesso'}</span><h2>{user.setupCompleted ? 'Preferências' : 'Vamos configurar sua apresentação'}</h2></div>
            {user.setupCompleted && <button type="button" className="secondary-button" onClick={logout}>Sair</button>}
          </div>
          {user.setupCompleted && navigation}
          {error && <p className="alert error">{error}</p>}
          {message && <p className="alert success">{message}</p>}
          <div className="preferences-panel">
            <h3>Preferências de apresentação</h3>
            <label>
              Formato de hora
              <select value={form.timeFormat} onChange={(event) => handleChange('timeFormat', event.target.value)}>
                <option value="H24">24 horas</option><option value="H12">12 horas</option>
              </select>
            </label>
            <label>
              Fuso horário
              <select value={form.timezone} onChange={(event) => handleChange('timezone', event.target.value)}>
                {timezones.map((timezone) => <option key={timezone.value} value={timezone.value}>{timezone.label}</option>)}
              </select>
            </label>
            {showLanguageSelector && (
              <label>
                Idioma do sistema
                <select value={form.language} onChange={(event) => handleChange('language', event.target.value)}>
                  {languageOptions.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="primary-button" onClick={updatePreferences}>
              {user.setupCompleted ? 'Salvar preferências' : 'Salvar e abrir Início'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'schedule') {
    return (
      <div className="page-shell">
        <div className="dashboard-card workspace-card">
          <div className="topbar">
            <div><span className="eyebrow">Configuração</span><h2>Jornada semanal</h2></div>
            <button type="button" className="secondary-button" onClick={logout}>Sair</button>
          </div>
          {navigation}
          {error && <p className="alert error">{error}</p>}
          {message && <p className="alert success">{message}</p>}
          {isScheduleLoading ? <p className="loading-note">Carregando jornada...</p> : (
            <div className="schedule-editor">
              <div className="schedule-heading"><h3>Horários por dia</h3><span>Horários locais: {form.timezone}</span></div>
              <form className="policy-form" onSubmit={saveSchedulePolicy}>
                <h3>Regras gerais</h3>
                <label>Carga horária padrão (minutos)<input type="number" min="1" max="1440" required value={schedulePolicy.defaultDailyWorkMinutes} onChange={(event) => setSchedulePolicy((current) => ({ ...current, defaultDailyWorkMinutes: Number(event.target.value) }))} /></label>
                <label>Tolerância geral de entrada<input type="number" min="0" max="120" required value={schedulePolicy.entryToleranceMinutes} onChange={(event) => setSchedulePolicy((current) => ({ ...current, entryToleranceMinutes: Number(event.target.value) }))} /></label>
                <label>Tolerância geral de saída<input type="number" min="0" max="120" required value={schedulePolicy.exitToleranceMinutes} onChange={(event) => setSchedulePolicy((current) => ({ ...current, exitToleranceMinutes: Number(event.target.value) }))} /></label>
                <label>Tolerância geral início intervalo<input type="number" min="0" max="120" required value={schedulePolicy.breakStartToleranceMinutes} onChange={(event) => setSchedulePolicy((current) => ({ ...current, breakStartToleranceMinutes: Number(event.target.value) }))} /></label>
                <label>Tolerância geral fim intervalo<input type="number" min="0" max="120" required value={schedulePolicy.breakEndToleranceMinutes} onChange={(event) => setSchedulePolicy((current) => ({ ...current, breakEndToleranceMinutes: Number(event.target.value) }))} /></label>
                <button type="submit" className="secondary-button">Salvar regras gerais</button>
              </form>
              {scheduleDays.map((day) => (
                <section className={`schedule-row ${day.isWorkday ? '' : 'day-disabled'}`} key={day.dayOfWeek}>
                  <div className="schedule-day-title">
                    <label><input type="checkbox" checked={day.isWorkday} onChange={(event) => updateScheduleDay(day.dayOfWeek, 'isWorkday', event.target.checked)} /><strong>{weekdayNames[day.dayOfWeek]}</strong></label>
                  </div>
                  <label>Carga do dia (min)<input type="number" min="1" max="1440" value={day.dailyWorkMinutes} disabled={!day.isWorkday} onChange={(event) => updateScheduleDay(day.dayOfWeek, 'dailyWorkMinutes', Number(event.target.value))} /></label>
                  <div className="period-editor">
                    <span>Períodos de trabalho</span>
                    {day.periods.map((period) => (
                      <div className="period-input-row" key={period.order}>
                        <label>Início<input type="time" value={period.startTime} disabled={!day.isWorkday} onChange={(event) => updateSchedulePeriod(day.dayOfWeek, period.order, 'startTime', event.target.value)} /></label>
                        <label>Fim<input type="time" value={period.endTime} disabled={!day.isWorkday} onChange={(event) => updateSchedulePeriod(day.dayOfWeek, period.order, 'endTime', event.target.value)} /></label>
                        {day.periods.length > 1 && <button type="button" className="text-button danger-link" onClick={() => removeSchedulePeriod(day.dayOfWeek, period.order)}>Remover</button>}
                      </div>
                    ))}
                    <button type="button" className="text-button" disabled={!day.isWorkday || day.periods.length >= 4} onClick={() => addSchedulePeriod(day.dayOfWeek)}>Adicionar período</button>
                  </div>
                  <label>Início do intervalo<input type="time" value={day.breakStart ?? ''} disabled={!day.isWorkday} onChange={(event) => updateScheduleDay(day.dayOfWeek, 'breakStart', event.target.value || null)} /></label>
                  <label>Fim do intervalo<input type="time" value={day.breakEnd ?? ''} disabled={!day.isWorkday} onChange={(event) => updateScheduleDay(day.dayOfWeek, 'breakEnd', event.target.value || null)} /></label>
                  <label>Tolerância entrada (min)<input type="number" min="0" max="120" value={day.entryToleranceMinutes} disabled={!day.isWorkday} onChange={(event) => updateScheduleDay(day.dayOfWeek, 'entryToleranceMinutes', Number(event.target.value))} /></label>
                  <label>Tolerância saída (min)<input type="number" min="0" max="120" value={day.exitToleranceMinutes} disabled={!day.isWorkday} onChange={(event) => updateScheduleDay(day.dayOfWeek, 'exitToleranceMinutes', Number(event.target.value))} /></label>
                  <label>Tolerância início intervalo (min)<input type="number" min="0" max="120" value={day.breakStartToleranceMinutes} disabled={!day.isWorkday} onChange={(event) => updateScheduleDay(day.dayOfWeek, 'breakStartToleranceMinutes', Number(event.target.value))} /></label>
                  <label>Tolerância fim intervalo (min)<input type="number" min="0" max="120" value={day.breakEndToleranceMinutes} disabled={!day.isWorkday} onChange={(event) => updateScheduleDay(day.dayOfWeek, 'breakEndToleranceMinutes', Number(event.target.value))} /></label>
                </section>
              ))}
              <button type="button" className="primary-button" disabled={isLoading || scheduleDays.length !== 7} onClick={saveSchedule}>{isLoading ? 'Salvando...' : 'Salvar jornada'}</button>
            </div>
          )}
          <section className="record-section">
            <h3>Feriados, folgas e exceções</h3>
            <form className="exception-form" onSubmit={saveScheduleException}>
              <label>Data<input type="date" required value={exceptionForm.date} onChange={(event) => setExceptionForm((current) => ({ ...current, date: event.target.value }))} /></label>
              <label>Tipo<select value={exceptionForm.type} onChange={(event) => setExceptionForm((current) => ({ ...current, type: event.target.value as ScheduleException['type'] }))}><option value="HOLIDAY">Feriado</option><option value="DAY_OFF">Folga</option><option value="WORKDAY_OVERRIDE">Jornada excepcional</option></select></label>
              {exceptionForm.type === 'WORKDAY_OVERRIDE' && <><label>Entrada<input type="time" required value={exceptionForm.startTime} onChange={(event) => setExceptionForm((current) => ({ ...current, startTime: event.target.value }))} /></label><label>Saída<input type="time" required value={exceptionForm.endTime} onChange={(event) => setExceptionForm((current) => ({ ...current, endTime: event.target.value }))} /></label></>}
              <label>Descrição<input maxLength={300} value={exceptionForm.note} onChange={(event) => setExceptionForm((current) => ({ ...current, note: event.target.value }))} /></label>
              <button type="submit" className="secondary-button">Salvar exceção</button>
            </form>
            {scheduleExceptions.length ? <ul className="exception-list">{scheduleExceptions.map((item) => <li key={item.id}><span>{item.date.slice(0, 10)} · {item.type === 'HOLIDAY' ? 'Feriado' : item.type === 'DAY_OFF' ? 'Folga' : `Jornada ${item.startTime}–${item.endTime}`}{item.note ? ` · ${item.note}` : ''}</span><button type="button" className="text-button danger-link" onClick={() => void removeScheduleException(item.id)}>Remover</button></li>)}</ul> : <p className="empty-note">Nenhuma exceção neste mês.</p>}
          </section>
        </div>
      </div>
    );
  }

  if (view === 'records') {
    return (
      <div className="page-shell">
        <div className="dashboard-card workspace-card">
          <div className="topbar"><div><span className="eyebrow">Registro diário</span><h2>Marcações</h2></div><button type="button" className="secondary-button" onClick={logout}>Sair</button></div>
          {navigation}
          {error && <p className="alert error">{error}</p>}
          {message && <p className="alert success">{message}</p>}
          <section className="record-section">
            <div className="section-heading"><h3>Consultar diária</h3><span>Horário: {form.timezone}</span></div>
            <label className="record-date-filter">Data<input type="date" value={recordDate} onChange={(event) => setRecordDate(event.target.value)} /></label>
          </section>
          {recordDate === new Intl.DateTimeFormat('en-CA', { timeZone: form.timezone }).format(new Date()) && <section className="record-section">
            <div className="section-heading"><h3>Registrar ponto agora</h3><span>Horário atual</span></div>
            {isRecordsLoading ? <p className="loading-note">Carregando marcações...</p> : (
              <div className="clock-actions">
                {allowedClockTypes.map((type) => <button type="button" key={type} className="primary-button" disabled={isClockLoading} onClick={() => void registerClock(type)}>{eventLabels[type]}</button>)}
                {!allowedClockTypes.length && <p className="empty-note">A jornada de hoje foi encerrada.</p>}
              </div>
            )}
          </section>}
          <section className="record-section">
            <div className="section-heading"><h3>Marcações da diária</h3><span>{timeEntries.length} registros · {recordDate}</span></div>
            {timeEntries.length ? <ol className="event-list record-list">
              {timeEntries.map((entry) => (
                <li key={entry.id}>
                  <time>{new Intl.DateTimeFormat('pt-BR', { timeZone: form.timezone, hour: '2-digit', minute: '2-digit', hourCycle: form.timeFormat === 'H24' ? 'h23' : 'h12' }).format(new Date(entry.timestamp))}</time>
                  {editingEntry?.id === entry.id ? (
                    <form className="entry-edit-form" onSubmit={saveEntryEdit}>
                      <select value={editingEntry.type} onChange={(event) => setEditingEntry((current) => current ? { ...current, type: event.target.value } : current)}>{Object.entries(eventLabels).filter(([type]) => type !== 'MANUAL').map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select>
                      <input type="datetime-local" required value={editingEntry.timestamp} onChange={(event) => setEditingEntry((current) => current ? { ...current, timestamp: event.target.value } : current)} />
                      <input required minLength={3} maxLength={500} placeholder="Motivo da correção" value={editingEntry.reason} onChange={(event) => setEditingEntry((current) => current ? { ...current, reason: event.target.value } : current)} />
                      <label className="image-upload-field">Adicionar imagens (opcional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { const files = readImageFiles(event.target.files); if (files) setEditingEntry((current) => current ? { ...current, images: files } : current); }} /></label>
                      {editingEntry.images.length > 0 && <small>{editingEntry.images.map((image) => image.name).join(', ')}</small>}
                      <button className="text-button" disabled={isClockLoading}>Salvar correção</button><button type="button" className="text-button" onClick={() => setEditingEntry(null)}>Cancelar</button>
                    </form>
                  ) : <><span>{eventLabels[entry.type] ?? entry.type}{entry.isManual ? ' · Manual' : ''}</span><div className="record-actions"><button type="button" className="text-button" onClick={() => setEditingEntry({ id: entry.id, type: entry.type, timestamp: toLocalDateTimeInput(entry.timestamp), reason: '', images: [] })}>Editar</button><button type="button" className="text-button danger-link" onClick={() => setDeletingEntry({ id: entry.id, reason: '' })}>Excluir</button></div>{entry.notes && <small>{entry.notes}</small>}{entry.images?.length ? <div className="image-attachments">{entry.images.map((image) => imageUrls[image.id] && <a key={image.id} href={imageUrls[image.id]} target="_blank" rel="noreferrer"><img src={imageUrls[image.id]} alt={image.fileName} /><span>{image.fileName}</span></a>)}</div> : null}</>}
                  {deletingEntry?.id === entry.id && <form className="entry-edit-form delete-entry-form" onSubmit={deleteEntry}><input required minLength={3} maxLength={500} placeholder="Justificativa da exclusão" value={deletingEntry.reason} onChange={(event) => setDeletingEntry((current) => current ? { ...current, reason: event.target.value } : current)} /><button className="text-button danger-link" disabled={isClockLoading}>Confirmar exclusão</button><button type="button" className="text-button" onClick={() => setDeletingEntry(null)}>Cancelar</button></form>}
                </li>
              ))}
            </ol> : <p className="empty-note">Nenhuma marcação registrada hoje.</p>}
          </section>
          <section className="record-section">
            <h3>Adicionar marcação manual</h3>
            <form className="manual-entry-form" onSubmit={submitManualEntry}>
              <label>Tipo<select value={manualEntry.type} onChange={(event) => setManualEntry((current) => ({ ...current, type: event.target.value }))}>{Object.entries(eventLabels).filter(([type]) => type !== 'MANUAL').map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
              <label>Data e hora<input type="datetime-local" required value={manualEntry.timestamp} onChange={(event) => setManualEntry((current) => ({ ...current, timestamp: event.target.value }))} /></label>
              <label>Justificativa<input required minLength={3} maxLength={500} value={manualEntry.reason} onChange={(event) => setManualEntry((current) => ({ ...current, reason: event.target.value }))} /></label>
              <label className="image-upload-field">Imagens (opcional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { const files = readImageFiles(event.target.files); if (files) setManualImages(files); }} /><small>{manualImages.length ? manualImages.map((image) => image.name).join(', ') : 'JPEG, PNG ou WebP · até 3 imagens de 5 MB'}</small></label>
              <button type="submit" className="secondary-button" disabled={isClockLoading}>Adicionar registro</button>
            </form>
          </section>
          <section className="record-section">
            <h3>Histórico de alterações</h3>
            {timeEntryAudit.length ? <ol className="audit-list">{timeEntryAudit.map((audit) => <li key={audit.id}><span>{audit.action === 'CREATED' ? 'Criação manual' : audit.action === 'UPDATED' ? 'Correção' : 'Exclusão'}</span><time>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(audit.createdAt))}</time><small>{audit.reason}</small></li>)}</ol> : <p className="empty-note">Nenhuma alteração manual.</p>}
          </section>
          <section className="record-section">
            <h3>Atividade de segurança</h3>
            {securityEvents.length ? <ol className="audit-list">{securityEvents.map((item) => <li key={item.id}><span>{item.type.replaceAll('_', ' ')}</span><time>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.createdAt))}</time><small>{item.ipAddress ?? 'IP não disponível'}</small></li>)}</ol> : <p className="empty-note">Nenhum evento de segurança registrado.</p>}
          </section>
        </div>
      </div>
    );
  }

  if (view === 'occurrences') {
    return (
      <div className="page-shell">
        <div className="dashboard-card workspace-card">
          <div className="topbar"><div><span className="eyebrow">Atividades do dia</span><h2>Ocorrências</h2></div><button type="button" className="secondary-button" onClick={logout}>Sair</button></div>
          {navigation}
          {error && <p className="alert error">{error}</p>}
          {message && <p className="alert success">{message}</p>}
          <section className="record-section">
            <h3>Registrar atividade</h3>
            <form className="manual-entry-form" onSubmit={submitOccurrence}>
              <label>Tipo<select value={occurrenceForm.type} onChange={(event) => setOccurrenceForm((current) => ({ ...current, type: event.target.value as Occurrence['type'], endAt: '' }))}><option value="PERSONAL_WITH_RETURN">Pessoal com retorno</option><option value="PERSONAL_WITHOUT_RETURN">Pessoal sem retorno</option><option value="COMPANY_ACTIVITY">Atividade da empresa</option></select></label>
              <label>Início<input type="datetime-local" required value={occurrenceForm.startAt} onChange={(event) => setOccurrenceForm((current) => ({ ...current, startAt: event.target.value }))} /></label>
              {occurrenceForm.type !== 'PERSONAL_WITHOUT_RETURN' && <label>{occurrenceForm.type === 'COMPANY_ACTIVITY' ? 'Término' : 'Retorno'}<input type="datetime-local" required value={occurrenceForm.endAt} onChange={(event) => setOccurrenceForm((current) => ({ ...current, endAt: event.target.value }))} /></label>}
              <label>Descrição<input required minLength={3} maxLength={500} value={occurrenceForm.notes} onChange={(event) => setOccurrenceForm((current) => ({ ...current, notes: event.target.value }))} /></label>
              <label className="image-upload-field">Imagens (opcional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { const files = readImageFiles(event.target.files); if (files) setOccurrenceImages(files); }} /><small>{occurrenceImages.length ? occurrenceImages.map((image) => image.name).join(', ') : 'JPEG, PNG ou WebP · até 3 imagens de 5 MB'}</small></label>
              <button type="submit" className="primary-button" disabled={isLoading}>{isLoading ? 'Salvando...' : 'Registrar ocorrência'}</button>
            </form>
          </section>
          <section className="record-section">
            <div className="section-heading"><h3>Ocorrências de hoje</h3><span>{occurrences.length}</span></div>
            {isOccurrenceLoading ? <p className="loading-note">Carregando ocorrências...</p> : occurrences.length ? <ol className="event-list occurrence-list">{occurrences.map((occurrence) => <li key={occurrence.id}><time>{new Intl.DateTimeFormat('pt-BR', { timeZone: form.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(occurrence.startAt))}</time><span>{occurrenceLabels[occurrence.type]}</span><small>{occurrence.notes}{occurrence.endAt ? ` · até ${new Intl.DateTimeFormat('pt-BR', { timeZone: form.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(occurrence.endAt))}` : ' · sem retorno'}</small>{occurrence.images?.length ? <div className="image-attachments">{occurrence.images.map((image) => imageUrls[image.id] && <a key={image.id} href={imageUrls[image.id]} target="_blank" rel="noreferrer"><img src={imageUrls[image.id]} alt={image.fileName} /><span>{image.fileName}</span></a>)}</div> : null}<button type="button" className="text-button danger-link" onClick={() => void removeOccurrence(occurrence.id)}>Excluir</button></li>)}</ol> : <p className="empty-note">Nenhuma ocorrência registrada hoje.</p>}
          </section>
        </div>
      </div>
    );
  }

  const formattedDate = dashboardData?.date.split('-').reverse().join('/');

  return (
    <div className="page-shell">
      <div className={`dashboard-card workspace-card ${welcomeAnimation ? 'welcome-animation' : ''}`}>
        <div className="topbar">
          <div className="dashboard-heading"><span className="eyebrow">Controle de ponto</span><h1 className={welcomeAnimation ? 'welcome-title' : ''}>Início</h1><p>{dashboardData ? `${dashboardData.weekday}, ${formattedDate}` : 'Resumo do seu dia'}</p></div>
          <button type="button" className="secondary-button" onClick={logout}>Sair</button>
        </div>
        {navigation}
        {welcomeMessage && <p className={`welcome-note ${welcomeAnimation ? 'welcome-note-enter' : ''}`}>{welcomeMessage}</p>}
        {message && <p className="alert success">{message}</p>}
        {error && <p className="alert error">{error}</p>}
        {dashboardData?.notifications?.some((item) => item.status !== 'READ') && (
          <section className="notification-list" aria-label="Alertas do dia">
            {dashboardData.notifications.filter((item) => item.status !== 'READ').map((item) => (
              <article className="notification-item" key={item.id}>
                <p>{item.message}</p>
                <button type="button" className="text-button" onClick={() => void markNotificationRead(item.id)}>Marcar como lido</button>
              </article>
            ))}
          </section>
        )}

        {isDashboardLoading && !dashboardData ? <p className="loading-note">Carregando seu dia...</p> : dashboardData && (
          <>
            <section className={`today-banner status-${dashboardData.status.toLowerCase()}`}>
              <div><span>Resumo de hoje</span><h2>{dashboardData.statusMessage}</h2></div>
              <button type="button" className="text-button" onClick={() => setDashboardRefresh((count) => count + 1)}>Atualizar</button>
            </section>
            <div className="dashboard-metrics">
              <div><span>Jornada prevista</span><strong>{formatDuration(dashboardData.plannedMinutes)}</strong></div>
              <div><span>Tempo registrado</span><strong>{formatDuration(dashboardData.workedMinutes)}</strong></div>
              <div><span>Eventos hoje</span><strong>{dashboardData.entries.length + (dashboardData.occurrences?.length ?? 0)}</strong></div>
            </div>
            <div className="today-columns">
              <section className="today-section">
                <div className="section-heading"><h3>Previsto para hoje</h3><button type="button" className="text-button" onClick={() => setView('schedule')}>Configurar</button></div>
                {dashboardData.schedule.isWorkday ? (
                  <dl className="schedule-summary">
                    <div><dt>Expediente</dt><dd>{dashboardData.schedule.periods?.map((period) => `${period.startTime}–${period.endTime}`).join(' · ') || `${dashboardData.schedule.startTime}–${dashboardData.schedule.endTime}`}</dd></div>
                    {dashboardData.schedule.breakStart && dashboardData.schedule.breakEnd && <div><dt>Intervalo</dt><dd>{dashboardData.schedule.breakStart} – {dashboardData.schedule.breakEnd}</dd></div>}
                    <div><dt>Tolerância de entrada</dt><dd>{dashboardData.schedule.entryToleranceMinutes} min</dd></div>
                  </dl>
                ) : <p className="empty-note">{dashboardData.exception?.note || (dashboardData.exception?.type === 'HOLIDAY' ? 'Feriado. Não há jornada prevista hoje.' : 'Sua jornada está configurada como folga hoje.')}</p>}
              </section>
              <section className="today-section">
                <div className="section-heading"><h3>Ocorrências e marcações</h3><span>{dashboardData.entries.length} hoje</span></div>
                {dashboardData.entries.length ? (
                  <ol className="event-list">
                    {dashboardData.entries.map((entry) => <li key={entry.id}><time>{entry.time}</time><span>{eventLabels[entry.type] ?? entry.type}</span>{entry.notes && <small>{entry.notes}</small>}</li>)}
                  </ol>
                ) : <p className="empty-note">{dashboardData.schedule.isWorkday ? dashboardData.statusMessage : 'Nenhuma ocorrência ou marcação prevista para hoje.'}</p>}
              </section>
              <section className="today-section">
                <div className="section-heading"><h3>Atividades de hoje</h3><button type="button" className="text-button" onClick={() => setView('occurrences')}>Registrar</button></div>
                {dashboardData.occurrences?.length ? <ol className="event-list occurrence-list">{dashboardData.occurrences.map((occurrence) => <li key={occurrence.id}><time>{new Intl.DateTimeFormat('pt-BR', { timeZone: form.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(occurrence.startAt))}</time><span>{occurrenceLabels[occurrence.type]}</span><small>{occurrence.notes}</small></li>)}</ol> : <p className="empty-note">Nenhuma atividade registrada para hoje.</p>}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
