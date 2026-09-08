const STORAGE_KEYS = { documents: 'cz_documents', templates: 'cz_templates', counters: 'cz_counters', categories: 'cz_categories', parties: 'cz_parties', partyFields: 'cz_party_fields', companies: 'cz_companies', parliaments: 'cz_parliaments', parliamentSettings: 'cz_parliament_settings', governments: 'cz_governments', governmentSettings: 'cz_government_settings', courtCompositions: 'cz_court_compositions', compositionSettings: 'cz_composition_settings', interpretations: 'cz_interpretations', interpretationSettings: 'cz_interpretation_settings', session: 'cz_session' };
const defaultCounters = { Sentenze: 1, Ordinanze: 1, Decreti: 1, 'Documenti generali': 1 };
const defaultParliamentSettings = { roles: [{ id: 'titolare', name: 'Parlamentare', limit: 10 }, { id: 'sostituto', name: 'Sostituto', limit: 5 }], fields: [] };
const API_URL = 'api.php';
const LOCAL_AUTH_KEYS = { users: 'cz_local_users', registrations: 'cz_local_registration_requests', resets: 'cz_local_password_reset_requests', roles: 'cz_local_roles' };
const PERMISSION_CATALOG = [
  { key: 'documents', label: 'Documenti', group: 'Archivio' }, { key: 'templates', label: 'Template', group: 'Archivio' }, { key: 'odg', label: 'ODG', group: 'Archivio' },
  { key: 'documents_pdf', label: 'Scarica PDF', group: 'Documenti' },
  { key: 'parties', label: 'Partiti', group: 'Archivi istituzionali' }, { key: 'companies', label: 'Aziende', group: 'Archivi istituzionali' }, { key: 'parliament', label: 'Parlamento', group: 'Archivi istituzionali' },
  { key: 'government', label: 'Governo', group: 'Archivi istituzionali' }, { key: 'composition', label: 'Composizione della Corte', group: 'Archivi istituzionali' }, { key: 'interpretations', label: 'Interpretazioni', group: 'Archivi istituzionali' },
  { key: 'settings', label: 'Impostazioni', group: 'Configurazione' }, { key: 'users', label: 'Utenti e permessi', group: 'Amministrazione' }
];
const PERMISSION_ACTIONS = [['view', 'Vedere'], ['create', 'Creare'], ['edit', 'Modificare'], ['delete', 'Eliminare'], ['approve', 'Approvare'], ['download', 'Scaricare']];
let editingDocumentId = null;
let editingTemplateId = null;
let editingPartyId = null;
let editingCompanyId = null;
let editingParliamentId = null;
let editingMemberId = null;
let savedEditorRange = null;
let remoteMode = false;
let remoteSaveTimer = null;
let currentUser = null;
let csrfToken = '';

function normalizeParliamentSettings(settings = {}) {
  const safeSettings = settings && typeof settings === 'object' ? settings : {};
  const legacyRoles = [
    { id: 'titolare', name: safeSettings?.roleNames?.titolare || 'Parlamentare', limit: Number.isFinite(Number(safeSettings.titolari)) ? Math.max(0, Number(safeSettings.titolari)) : 10 },
    { id: 'sostituto', name: safeSettings?.roleNames?.sostituto || 'Sostituto', limit: Number.isFinite(Number(safeSettings.sostituti)) ? Math.max(0, Number(safeSettings.sostituti)) : 5 }
  ];
  const roles = Array.isArray(safeSettings.roles) && safeSettings.roles.length ? safeSettings.roles : legacyRoles;
  return {
    roles: roles.map((role, index) => ({ id: role.id || crypto.randomUUID(), name: String(role.name || `Ruolo ${index + 1}`).trim(), limit: Math.max(0, Number.parseInt(role.limit, 10) || 0) })),
    fields: Array.isArray(safeSettings.fields) ? safeSettings.fields : [],
  };
}

const state = {
  documents: readStorage(STORAGE_KEYS.documents, []),
  templates: readStorage(STORAGE_KEYS.templates, []),
  counters: readStorage(STORAGE_KEYS.counters, defaultCounters),
  categories: readStorage(STORAGE_KEYS.categories, Object.keys(defaultCounters).map(name => ({ name }))),
  parties: readStorage(STORAGE_KEYS.parties, []),
  partyFields: readStorage(STORAGE_KEYS.partyFields, []),
  companies: readStorage(STORAGE_KEYS.companies, []),
  parliaments: readStorage(STORAGE_KEYS.parliaments, []),
  parliamentSettings: normalizeParliamentSettings(readStorage(STORAGE_KEYS.parliamentSettings, defaultParliamentSettings)),
  governments: readStorage(STORAGE_KEYS.governments, []),
  governmentSettings: normalizeInstitutionSettings(readStorage(STORAGE_KEYS.governmentSettings, null), [{ id: 'presidente', name: 'Presidente del Consiglio', limit: 1 }, { id: 'ministro', name: 'Ministro', limit: 10 }]),
  courtCompositions: readStorage(STORAGE_KEYS.courtCompositions, []),
  compositionSettings: normalizeInstitutionSettings(readStorage(STORAGE_KEYS.compositionSettings, null), [{ id: 'presidente', name: 'Presidente della Corte', limit: 1 }, { id: 'giudice', name: 'Giudice costituzionale', limit: 15 }]),
  interpretations: readStorage(STORAGE_KEYS.interpretations, []),
  interpretationSettings: { fields: Array.isArray(readStorage(STORAGE_KEYS.interpretationSettings, {}).fields) ? readStorage(STORAGE_KEYS.interpretationSettings, {}).fields : [] }
};
const localAuth = {
  users: readStorage(LOCAL_AUTH_KEYS.users, [{ id: 'local-admin', username: 'admin@localhost', displayName: 'Amministratore locale', role: 'admin', isPrimaryAdmin: true, mustChangeCredentials: true, password: 'zero2026' }]),
  registrations: readStorage(LOCAL_AUTH_KEYS.registrations, []),
  resets: readStorage(LOCAL_AUTH_KEYS.resets, []),
  roles: readStorage(LOCAL_AUTH_KEYS.roles, [{ id: 'local-admin-role', name: 'Amministratore', roleKey: 'admin', isSystem: true, permissions: { '*': { view: true, create: true, edit: true, delete: true, approve: true, download: true } } }, { id: 'local-guest-role', name: 'Ospite', roleKey: 'guest', isSystem: true, permissions: { documents: { view: true } } }]),
  logs: readStorage('cz_local_security_logs', [])
};
if (localAuth.users.length === 1 && localAuth.users[0].username === 'admin@localhost' && localAuth.users[0].mustChangeCredentials === undefined) {
  localAuth.users[0].mustChangeCredentials = true;
  localStorage.setItem(LOCAL_AUTH_KEYS.users, JSON.stringify(localAuth.users));
}

function ensureOdgCategory() {
  if (!state.categories.some(category => category.name === 'ODG')) state.categories.push({ name: 'ODG' });
  if (!Object.prototype.hasOwnProperty.call(state.counters, 'ODG')) state.counters.ODG = 1;
  writeStorage(STORAGE_KEYS.categories, state.categories);
  writeStorage(STORAGE_KEYS.counters, state.counters);
}

function ensureDemoOdg() {
  if (state.documents.some(document => document.category === 'ODG')) return;
  state.documents.unshift({ id: crypto.randomUUID(), title: 'ODG di esempio - Seduta della Corte', category: 'ODG', number: nextNumber('ODG'), year: String(new Date().getFullYear()), date: today(), body: '<h2>Ordine del giorno</h2><p>Esame delle questioni iscritte alla seduta della Corte Costituzionale.</p><ol><li>Approvazione del verbale precedente.</li><li>Esame dei fascicoli iscritti.</li><li>Comunicazioni della Presidenza.</li></ol>', image: '', templateName: '', status: 'da valutare', createdAt: new Date().toISOString() });
  advanceCounter('ODG', state.documents[0].number);
  writeStorage(STORAGE_KEYS.documents, state.documents);
  writeStorage(STORAGE_KEYS.counters, state.counters);
}

const institutionConfigs = {
  government: { key: 'governments', settingsKey: 'governmentSettings', view: 'government', label: 'Governo', itemLabel: 'Governo', personLabel: 'componente' },
  composition: { key: 'courtCompositions', settingsKey: 'compositionSettings', view: 'composition', label: 'Composizione della Corte', itemLabel: 'Composizione', newLabel: 'Nuova composizione', personLabel: 'componente' }
};

function normalizeInstitutionSettings(settings, defaults) {
  const roles = Array.isArray(settings?.roles) && settings.roles.length ? settings.roles : defaults;
  return { roles: roles.map((role, index) => ({ id: role.id || crypto.randomUUID(), name: String(role.name || `Ruolo ${index + 1}`).trim(), limit: Math.max(0, Number.parseInt(role.limit, 10) || 0) })) };
}

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if (remoteMode) queueRemoteSave(permissionForStorageKey(key));
}
async function apiRequest(action, options = {}) {
  let response;
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (csrfToken && options.method === 'POST') headers['X-CSRF-Token'] = csrfToken;
    response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
      credentials: 'same-origin',
      headers,
      ...options,
    });
  } catch {
    throw new Error('BACKEND_UNAVAILABLE');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('BACKEND_UNAVAILABLE');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || (response.status >= 500 ? 'BACKEND_UNAVAILABLE' : 'Errore di comunicazione con il server.'));
  return payload;
}
function remoteStatePayload(permission = 'documents') {
  return { permission, state: JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'session'))) };
}
function applyRemoteState(remoteState) {
  if (!remoteState) return;
  Object.keys(state).forEach(key => { if (Object.prototype.hasOwnProperty.call(remoteState, key)) state[key] = remoteState[key]; });
  state.parliamentSettings = normalizeParliamentSettings(state.parliamentSettings, defaultParliamentSettings);
  state.governmentSettings = normalizeInstitutionSettings(state.governmentSettings, [{ id: 'presidente', name: 'Presidente del Consiglio', limit: 1 }, { id: 'ministro', name: 'Ministro', limit: 10 }]);
  state.compositionSettings = normalizeInstitutionSettings(state.compositionSettings, [{ id: 'presidente', name: 'Presidente della Corte', limit: 1 }, { id: 'giudice', name: 'Giudice costituzionale', limit: 15 }]);
  state.interpretationSettings = { fields: Array.isArray(state.interpretationSettings?.fields) ? state.interpretationSettings.fields : [] };
}
async function saveRemoteState(permission = 'documents') {
  await apiRequest('save_state', { method: 'POST', body: JSON.stringify(remoteStatePayload(permission)) });
}
function queueRemoteSave(permission = 'documents') {
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    saveRemoteState(permission).catch(error => console.error(error));
  }, 250);
}
async function loadRemoteState() {
  try {
    const payload = await apiRequest('state');
    remoteMode = true;
    currentUser = payload.user || null;
    csrfToken = currentUser?.csrfToken || '';
    applyRemoteState(payload.state);
    return true;
  } catch {
    return false;
  }
}
async function loginRemote(username, password) {
  const payload = await apiRequest('login', { method: 'POST', body: JSON.stringify({ username, password }) });
  remoteMode = true;
  currentUser = payload.user || null;
  csrfToken = currentUser?.csrfToken || '';
  ensureUserManagementCard();
  applyRemoteState(payload.state);
  ensureOdgCategory();
  ensureDemoOdg();
  return payload;
}
function saveLocalAuth() {
  writeStorage(LOCAL_AUTH_KEYS.users, localAuth.users);
  writeStorage(LOCAL_AUTH_KEYS.registrations, localAuth.registrations);
  writeStorage(LOCAL_AUTH_KEYS.resets, localAuth.resets);
  writeStorage(LOCAL_AUTH_KEYS.roles, localAuth.roles);
  writeStorage('cz_local_security_logs', localAuth.logs);
}
function localSecurityLog(eventType, severity = 'info', details = {}) {
  localAuth.logs.unshift({ id: crypto.randomUUID(), event_type: eventType, severity, details: JSON.stringify(details), created_at: new Date().toISOString(), username: currentUser?.username || 'locale' });
  localAuth.logs = localAuth.logs.slice(0, 200);
  saveLocalAuth();
}
function localAdminData() {
  return { users: localAuth.users.filter(user => !user.deletedAt), roles: localAuth.roles, permissions: PERMISSION_CATALOG.map((permission, index) => ({ id: index + 1, permission_key: permission.key, label: permission.label, permission_group: permission.group })), rolePermissions: [], registrations: localAuth.registrations.filter(request => request.status === 'pending'), resets: localAuth.resets.filter(request => request.status === 'pending'), logs: localAuth.logs };
}
function localUserPayload(user) {
  const role = localAuth.roles.find(item => item.id === user.roleId || item.roleKey === user.role) || localAuth.roles[0];
  return { id: user.id, username: user.username, displayName: user.displayName, role: role.name, roleId: role.id, isPrimaryAdmin: Boolean(user.isPrimaryAdmin), mustChangeCredentials: Boolean(user.mustChangeCredentials), permissions: role.permissions };
}
function can(permission, action = 'view') {
  if (currentUser?.isPrimaryAdmin) return true;
  const permissions = currentUser?.permissions || {};
  return Boolean(permissions['*']?.[action] || permissions[permission]?.[action]);
}
function permissionForStorageKey(key) {
  return { documents: 'documents', templates: 'templates', counters: 'settings', categories: 'settings', parties: 'parties', partyFields: 'parties', companies: 'companies', parliaments: 'parliament', parliamentSettings: 'parliament', governments: 'government', governmentSettings: 'government', courtCompositions: 'composition', compositionSettings: 'composition', interpretations: 'interpretations', interpretationSettings: 'interpretations' }[key] || 'documents';
}
function applyPermissions() {
  const views = { dashboard: 'documents', templates: 'templates', parties: 'parties', companies: 'companies', parliament: 'parliament', government: 'government', composition: 'composition', interpretations: 'interpretations', odg: 'odg', settings: 'settings', access: 'users' };
  Object.entries(views).forEach(([view, permission]) => document.querySelectorAll(`[data-view-link="${view}"]`).forEach(link => { const navItem = link.closest('.nav-item'); if (navItem) navItem.classList.toggle('d-none', !can(permission)); }));
  const controls = { '#newDocumentButton': ['documents', 'create'], '#templatesView [data-bs-target="#templateModal"]': ['templates', 'create'], '#newPartyButton': ['parties', 'create'], '#newCompanyButton': ['companies', 'create'], '#newParliamentButton': ['parliament', 'create'], '#newOdgButton': ['odg', 'create'], '#newInterpretationButton': ['interpretations', 'create'] };
  Object.entries(controls).forEach(([selector, [permission, action]]) => document.querySelectorAll(selector).forEach(control => { control.classList.toggle('d-none', !can(permission, action)); }));
  document.querySelectorAll('[data-new-institution]').forEach(button => button.classList.toggle('d-none', !can(button.dataset.newInstitution, 'create')));
}

function ensureGuideView() {
  const nav = document.querySelector('#mainNav .navbar-nav');
  const settingsLink = nav?.querySelector('[data-view-link="settings"]')?.closest('.nav-item');
  if (nav && settingsLink && !nav.querySelector('[data-view-link="guide"]')) {
    const item = document.createElement('li');
    item.className = 'nav-item';
    item.innerHTML = '<a class="nav-link" href="#guide" data-view-link="guide">Guida</a>';
    nav.insertBefore(item, settingsLink);
    item.querySelector('a').addEventListener('click', event => { event.preventDefault(); setView('guide'); });
  }
  const appContainer = document.querySelector('#appView > .container-fluid');
  if (!document.getElementById('guideView')) appContainer.insertAdjacentHTML('beforeend', '<section id="guideView" class="app-view d-none"><div class="mb-4"><p class="eyebrow text-secondary mb-2">Uso personale</p><h1 class="display-6 fw-bold mb-2">Guida</h1><p class="text-secondary mb-0">Qui trovi solo le operazioni disponibili per il tuo profilo.</p></div><div id="guideContent" class="row g-4"></div></section>');
}

function renderGuide() {
  const areas = [
    ['documents', 'Documenti', 'Cerca gli atti per titolo, categoria o numero. Apri una riga per modificare un documento. Puoi creare nuovi atti solo se hai il permesso di creazione.', ['create', 'edit']],
    ['documents_pdf', 'PDF', 'Da ogni documento puoi usare PDF / stampa oppure scaricare direttamente un file PDF, se il permesso Scarica PDF è attivo.', ['download']],
    ['templates', 'Template', 'Usa un template per iniziare un documento precompilato. Puoi creare, modificare o eliminare template solo con i rispettivi permessi.', ['create', 'edit', 'delete']],
    ['odg', 'ODG', 'Consulta gli ordini del giorno e il loro stato. Crea un ODG dalla relativa scheda se hai il permesso di creazione.', ['view', 'create']],
    ['parties', 'Partiti', 'Consulta le schede dei partiti, modifica i dati e gestisci gli Statuti secondo i permessi assegnati.', ['view', 'edit']],
    ['companies', 'Aziende', 'Consulta le aziende e i loro Regolamenti. Le modifiche dipendono dai permessi del ruolo.', ['view', 'edit']],
    ['parliament', 'Parlamento', 'Consulta mandati e nomine parlamentari. Crea o modifica i dati solo se il ruolo lo consente.', ['view', 'create', 'edit']],
    ['government', 'Governo', 'Consulta periodi, ruoli e componenti del Governo. Le azioni disponibili sono filtrate dal tuo ruolo.', ['view', 'create', 'edit']],
    ['composition', 'Composizione della Corte', 'Consulta e gestisci i periodi e i componenti della Corte nei limiti dei permessi.', ['view', 'create', 'edit']],
    ['interpretations', 'Interpretazioni', 'Leggi e gestisci le interpretazioni archiviate secondo le autorizzazioni disponibili.', ['view', 'create', 'edit']],
    ['settings', 'Impostazioni', 'Gestisci configurazioni dell’archivio solo se hai accesso alle impostazioni.', ['view', 'edit']],
    ['users', 'Utenti e permessi', 'Questa scheda è riservata all’amministratore principale: gestisce utenti, ruoli, permessi, richieste e log di sicurezza.', ['view', 'approve', 'edit']]
  ];
  const available = areas.filter(([permission]) => can(permission, 'view') || ['create', 'edit', 'delete', 'download', 'approve'].some(action => can(permission, action)));
  document.getElementById('guideContent').innerHTML = available.map(([permission, title, description, actions]) => `<article class="col-12 col-md-6"><div class="card border-0 shadow-sm h-100"><div class="card-body p-4"><p class="eyebrow text-secondary mb-2">${escapeHtml(title)}</p><h2 class="h5">Come usarlo</h2><p class="text-secondary">${escapeHtml(description)}</p><div class="d-flex flex-wrap gap-2">${actions.filter(action => can(permission, action)).map(action => `<span class="badge text-bg-light">${escapeHtml({ view: 'Vedere', create: 'Creare', edit: 'Modificare', delete: 'Eliminare', download: 'Scaricare PDF', approve: 'Approvare' }[action])}</span>`).join('')}</div></div></div></article>`).join('') || '<div class="col-12"><div class="empty-state"><h2 class="h5">Nessuna funzione disponibile</h2><p class="text-secondary mb-0">Contatta l’amministratore principale per richiedere un’autorizzazione.</p></div></div>';
}
function localRequestRegistration(displayName, email, password) {
  if (localAuth.users.some(user => user.username === email && !user.deletedAt) || localAuth.registrations.some(request => request.email === email && request.status === 'pending')) throw new Error('Esiste già una richiesta o un utente con questa mail.');
  localAuth.registrations.push({ id: crypto.randomUUID(), email, displayName, password, status: 'pending', createdAt: new Date().toISOString() });
  saveLocalAuth();
  return { message: 'Richiesta locale inviata. Approvala dalla Gestione utenti.' };
}
function localRequestReset(email) {
  const user = localAuth.users.find(item => item.username === email && !item.deletedAt);
  if (user && !localAuth.resets.some(request => request.email === email && request.status === 'pending')) localAuth.resets.push({ id: crypto.randomUUID(), userId: user.id, email, status: 'pending', createdAt: new Date().toISOString() });
  saveLocalAuth();
  return { message: 'Se la mail è registrata, la richiesta locale è stata inoltrata all’amministratore.' };
}
function formatDate(value) { return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
function today() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value = '') { return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function sanitizeRichHtml(value = '') { if (window.DOMPurify) return window.DOMPurify.sanitize(value, { USE_PROFILES: { html: true }, ALLOW_DATA_ATTR: false }); const container = document.createElement('div'); container.innerHTML = value; container.querySelectorAll('script,style,iframe,object,embed,form').forEach(element => element.remove()); container.querySelectorAll('*').forEach(element => [...element.attributes].forEach(attribute => { if (/^on/i.test(attribute.name) || (['href', 'src'].includes(attribute.name) && !/^(https?:|mailto:|data:image\/)/i.test(attribute.value))) element.removeAttribute(attribute.name); })); return container.innerHTML; }
function plainText(value = '') { const container = document.createElement('div'); container.innerHTML = value; return container.textContent || ''; }
function nextNumber(category) { const value = String(state.counters[category] ?? '1'); return /^\d+$/.test(value) && Number(value) > 0 ? value : '1'; }
function numericValue(value) { const parsed = Number.parseInt(String(value), 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : 1; }
function advanceCounter(category, usedNumber) { const current = nextNumber(category); const nextValue = Math.max(numericValue(current), numericValue(usedNumber) + 1); const width = Math.max(current.length, String(nextValue).length); state.counters[category] = String(nextValue).padStart(width, '0'); }
function documentCode(document) { return `${document.category} ${String(document.number)}/${document.year}`; }
function statusLabel(status) { return { attivo: 'Attivo', eliminato: 'Eliminato', confluito: 'Confluito', cancellato: 'Cancellato' }[status] || 'Attivo'; }
function statusClass(status) { return { attivo: 'text-bg-success', eliminato: 'text-bg-danger', confluito: 'text-bg-warning', cancellato: 'text-bg-secondary' }[status] || 'text-bg-success'; }
function mandateStatusLabel(status) { return status === 'in corso' ? 'In corso' : 'Concluso'; }
function parliamentRoleLabel(role, plural = false) {
  const configuredRole = state.parliamentSettings.roles.find(item => item.id === role);
  const label = configuredRole?.name || role;
  return plural ? `${label}s` : label;
}
function parliamentRoles() { return state.parliamentSettings.roles; }
function parliamentRole(role) { return parliamentRoles().find(item => item.id === role); }
function showToast(message) { document.querySelector('#appToast .toast-body').textContent = message; bootstrap.Toast.getOrCreateInstance(document.getElementById('appToast')).show(); }
function readFileAsDataUrl(file) { return new Promise((resolve, reject) => { if (!file) return resolve(''); const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
function categoryNames() { return [...new Set([...state.categories.map(category => category.name), ...Object.keys(state.counters), ...state.documents.map(document => document.category), ...state.templates.map(template => template.category)])].filter(Boolean).sort(); }
function syncEditorValue(editorId, inputId) { document.getElementById(inputId).value = sanitizeRichHtml(document.getElementById(editorId).innerHTML.trim()); }
function editorFromControl(control) { return control.closest('.modal-content')?.querySelector('.rich-editor'); }
function saveEditorSelection(editor) {
  const selection = window.getSelection();
  if (!selection.rangeCount || !editor?.contains(selection.anchorNode)) return;
  savedEditorRange = selection.getRangeAt(0).cloneRange();
}
function restoreEditorSelection(editor) {
  if (!editor) return;
  editor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  if (savedEditorRange && !savedEditorRange.collapsed && editor.contains(savedEditorRange.commonAncestorContainer)) selection.addRange(savedEditorRange);
  else {
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.addRange(range);
  }
}
function executeEditorCommand(control, value = null) {
  const editor = editorFromControl(control);
  restoreEditorSelection(editor);
  document.execCommand(control.dataset.editorCommand, false, value ?? control.value ?? null);
  saveEditorSelection(editor);
}
function applyPixelFontSize(control) {
  const editor = editorFromControl(control);
  restoreEditorSelection(editor);
  document.execCommand('fontSize', false, '7');
  editor.querySelectorAll('font[size="7"]').forEach(font => { font.removeAttribute('size'); font.style.fontSize = `${control.value}px`; });
  saveEditorSelection(editor);
}
function insertTable(editor) {
  const rows = Math.max(1, Number.parseInt(prompt('Numero di righe', '2'), 10) || 2);
  const columns = Math.max(1, Number.parseInt(prompt('Numero di colonne', '2'), 10) || 2);
  const table = document.createElement('table');
  table.className = 'document-table';
  table.innerHTML = `<tbody>${Array.from({ length: rows }, () => `<tr>${Array.from({ length: columns }, () => '<td>Scrivi qui</td>').join('')}</tr>`).join('')}</tbody>`;
  restoreEditorSelection(editor);
  document.execCommand('insertHTML', false, table.outerHTML);
}
function insertImage(editor) {
  const imageUrl = prompt('Incolla l’indirizzo dell’immagine');
  if (!imageUrl || !/^(https?:|data:image\/)/i.test(imageUrl.trim())) { if (imageUrl) showToast('Indirizzo immagine non consentito.'); return; }
  restoreEditorSelection(editor);
  document.execCommand('insertImage', false, imageUrl);
}
function addToolbarControl(toolbar, type, label, command, value = '') {
  const control = document.createElement(type === 'select' ? 'select' : 'button');
  control.className = type === 'select' ? 'form-select form-select-sm editor-select' : 'btn btn-sm btn-outline-secondary';
  control.dataset.editorCommand = command;
  control.setAttribute('type', 'button');
  control.setAttribute('aria-label', label);
  control.title = label;
  if (type === 'select') control.innerHTML = value;
  else control.innerHTML = label;
  toolbar.appendChild(control);
  return control;
}
function enhanceEditorToolbars() {
  document.querySelectorAll('.editor-toolbar').forEach(toolbar => {
    [['foreColor', 'Colore testo', 'bi-fonts', '#17202a'], ['hiliteColor', 'Evidenziatore', 'bi-highlighter', '#fff2a8']].forEach(([command, label, icon, value]) => {
      const colorLabel = document.createElement('label');
      colorLabel.className = 'editor-color-control';
      colorLabel.title = label;
      colorLabel.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
      const color = document.createElement('input');
      color.className = 'editor-color';
      color.type = 'color';
      color.value = value;
      color.defaultValue = value;
      color.setAttribute('aria-label', label);
      color.title = label;
      color.dataset.editorCommand = command;
      colorLabel.appendChild(color);
      toolbar.appendChild(colorLabel);
    });
    addToolbarControl(toolbar, 'button', 'Elenco numerato', 'insertOrderedList');
    addToolbarControl(toolbar, 'button', 'Allinea a destra', 'justifyRight');
    addToolbarControl(toolbar, 'button', 'Testo giustificato', 'justifyFull');
    addToolbarControl(toolbar, 'button', 'Riduci rientro', 'outdent');
    addToolbarControl(toolbar, 'button', 'Aumenta rientro', 'indent');
    addToolbarControl(toolbar, 'button', 'Tabella', 'insertTable');
    addToolbarControl(toolbar, 'button', 'Immagine', 'insertImage');
    addToolbarControl(toolbar, 'button', 'Linea', 'insertHorizontalRule');
    addToolbarControl(toolbar, 'button', 'Collegamento', 'createLink');
    addToolbarControl(toolbar, 'button', 'Pulisci formato', 'removeFormat');
    const fontSize = toolbar.querySelector('select[data-editor-command="fontSize"]');
    if (fontSize) {
      const sizeInput = document.createElement('input');
      sizeInput.className = 'form-control form-control-sm editor-size';
      sizeInput.type = 'number';
      sizeInput.min = '8';
      sizeInput.max = '96';
      sizeInput.step = '1';
      sizeInput.value = '12';
      sizeInput.title = 'Grandezza testo in pixel';
      sizeInput.setAttribute('aria-label', 'Grandezza testo in pixel');
      sizeInput.dataset.editorCommand = 'fontSizePx';
      fontSize.replaceWith(sizeInput);
    }
  });
  const icons = { bold: 'bi-type-bold', italic: 'bi-type-italic', underline: 'bi-type-underline', justifyLeft: 'bi-text-left', justifyCenter: 'bi-text-center', justifyRight: 'bi-text-right', justifyFull: 'bi-justify', insertUnorderedList: 'bi-list-ul', insertOrderedList: 'bi-list-ol', outdent: 'bi-text-indent-left', indent: 'bi-text-indent-right', insertTable: 'bi-table', insertImage: 'bi-image', insertHorizontalRule: 'bi-dash-lg', createLink: 'bi-link-45deg', removeFormat: 'bi-eraser' };
  const labels = { bold: 'Grassetto', italic: 'Corsivo', underline: 'Sottolineato', justifyLeft: 'Allinea a sinistra', justifyCenter: 'Allinea al centro', insertUnorderedList: 'Elenco puntato', insertOrderedList: 'Elenco numerato', fontName: 'Tipo di carattere', fontSizePx: 'Grandezza testo in pixel' };
  document.querySelectorAll('.editor-toolbar [data-editor-command]').forEach(control => {
    const icon = icons[control.dataset.editorCommand];
    if (labels[control.dataset.editorCommand]) control.title = labels[control.dataset.editorCommand];
    if (icon && control.tagName === 'BUTTON') control.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
  });
}
function organizeDocumentEditor() {
  const row = document.querySelector('#documentModal .modal-body > .row');
  if (!row || row.querySelector('.document-sidebar')) return;
  const sidebar = document.createElement('aside');
  const canvas = document.createElement('section');
  sidebar.className = 'document-sidebar';
  canvas.className = 'document-canvas';
  [...row.children].forEach(element => {
    const belongsToCanvas = element.querySelector('#documentBodyEditor');
    (belongsToCanvas ? canvas : sidebar).appendChild(element);
  });
  row.replaceChildren(sidebar, canvas);
}
function organizeTemplateEditor() {
  const row = document.querySelector('#templateModal .modal-body > .row');
  if (!row || row.querySelector('.template-sidebar')) return;
  const sidebar = document.createElement('aside');
  const canvas = document.createElement('section');
  sidebar.className = 'template-sidebar';
  canvas.className = 'template-canvas';
  [...row.children].forEach((element, index) => (index === 2 ? canvas : sidebar).appendChild(element));
  row.replaceChildren(sidebar, canvas);
}

function populateFontMenus() {
  const fonts = [
    ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Arial', 'Arial'],
    ['Helvetica', 'Helvetica'], ['Verdana', 'Verdana'], ['Tahoma', 'Tahoma'],
    ['Trebuchet MS', 'Trebuchet MS'], ['Courier New', 'Courier New'],
    ['Lucida Console', 'Lucida Console'], ['Garamond', 'Garamond'],
    ['Palatino Linotype', 'Palatino Linotype'], ['Book Antiqua', 'Book Antiqua'],
    ['Impact', 'Impact'], ['Comic Sans MS', 'Comic Sans MS']
  ];
  document.querySelectorAll('select[data-editor-command="fontName"]').forEach(select => {
    select.innerHTML = fonts.map(([value, label]) => `<option value="${value}" style="font-family: '${value}', serif">${label}</option>`).join('');
    select.value = 'Georgia';
  });
}

function ensureAuthModals() {
  if (document.getElementById('registrationRequestModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal fade" id="registrationRequestModal" tabindex="-1" aria-hidden="true"><div class="modal-dialog"><div class="modal-content"><form id="registrationRequestForm"><div class="modal-header"><h2 class="modal-title h5">Richiedi registrazione</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button></div><div class="modal-body"><p class="text-secondary small">La richiesta sarà esaminata dall'amministratore principale.</p><div id="registrationRequestAlert" class="alert d-none" role="alert"></div><div class="mb-3"><label for="registrationDisplayName" class="form-label">Nome e cognome</label><input id="registrationDisplayName" class="form-control" required maxlength="160"></div><div class="mb-3"><label for="registrationEmail" class="form-label">Indirizzo e-mail</label><input id="registrationEmail" class="form-control" type="email" required maxlength="190"></div><div><label for="registrationPassword" class="form-label">Password</label><input id="registrationPassword" class="form-control" type="password" minlength="8" required><div class="form-text">Almeno 8 caratteri.</div></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Annulla</button><button class="btn btn-primary" type="submit">Invia richiesta</button></div></form></div></div></div><div class="modal fade" id="recoveryRequestModal" tabindex="-1" aria-hidden="true"><div class="modal-dialog"><div class="modal-content"><form id="recoveryRequestForm"><div class="modal-header"><h2 class="modal-title h5">Recupera password</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button></div><div class="modal-body"><p class="text-secondary small">La richiesta viene inoltrata all'amministratore principale, che autorizzerà una nuova password.</p><div id="recoveryRequestAlert" class="alert d-none" role="alert"></div><label for="recoveryEmail" class="form-label">Indirizzo e-mail</label><input id="recoveryEmail" class="form-control" type="email" required maxlength="190"></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Annulla</button><button class="btn btn-primary" type="submit">Invia richiesta</button></div></form></div></div></div>`);
}

function ensureCredentialModal() {
  if (document.getElementById('credentialChangeModal')) return;
  document.body.insertAdjacentHTML('beforeend', '<div class="modal fade" id="credentialChangeModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1" aria-hidden="true"><div class="modal-dialog"><div class="modal-content"><form id="credentialChangeForm"><div class="modal-header"><h2 class="modal-title h5">Configura le tue credenziali</h2></div><div class="modal-body"><p class="text-secondary small">È il primo accesso. Sostituisci le credenziali provvisorie con una mail e una password personali.</p><div id="credentialChangeAlert" class="alert d-none" role="alert"></div><div class="mb-3"><label for="newCredentialEmail" class="form-label">La tua e-mail</label><input id="newCredentialEmail" class="form-control" type="email" maxlength="190" required></div><div class="mb-3"><label for="newCredentialPassword" class="form-label">Nuova password</label><input id="newCredentialPassword" class="form-control" type="password" minlength="8" autocomplete="new-password" required></div><div><label for="newCredentialPasswordConfirmation" class="form-label">Conferma nuova password</label><input id="newCredentialPasswordConfirmation" class="form-control" type="password" minlength="8" autocomplete="new-password" required></div></div><div class="modal-footer"><button class="btn btn-primary" type="submit">Salva credenziali</button></div></form></div></div></div>');
}

let firstAccessResolver = null;
function requireFirstAccessCredentials(localUser = null) {
  if (!currentUser?.mustChangeCredentials) return Promise.resolve(true);
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('credentialChangeModal'));
  document.getElementById('newCredentialEmail').value = currentUser.username || '';
  firstAccessResolver = { localUser, resolve: null };
  const result = new Promise(resolve => { firstAccessResolver.resolve = resolve; });
  modal.show();
  return result;
}

async function saveFirstAccessCredentials(event) {
  event.preventDefault();
  const email = document.getElementById('newCredentialEmail').value.trim().toLowerCase();
  const password = document.getElementById('newCredentialPassword').value;
  const confirmation = document.getElementById('newCredentialPasswordConfirmation').value;
  const alert = document.getElementById('credentialChangeAlert');
  alert.classList.add('d-none');
  if (password !== confirmation) { alert.textContent = 'Le password non coincidono.'; alert.className = 'alert alert-danger'; return; }
  try {
    if (remoteMode) {
      const payload = await apiRequest('change_credentials', { method: 'POST', body: JSON.stringify({ email, password }) });
      currentUser = payload.user;
      csrfToken = currentUser?.csrfToken || csrfToken;
      applyRemoteState(payload.state);
    } else {
      const localUser = firstAccessResolver?.localUser;
      if (!localUser || (localAuth.users.some(user => user.username === email && user.id !== localUser.id && !user.deletedAt))) throw new Error('Questa mail è già associata a un altro utente.');
      localUser.username = email;
      localUser.password = password;
      localUser.mustChangeCredentials = false;
      currentUser = localUserPayload(localUser);
      saveLocalAuth();
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('credentialChangeModal')).hide();
    firstAccessResolver?.resolve(true);
    firstAccessResolver = null;
    showToast('Credenziali personali salvate.');
  } catch (error) { alert.textContent = error.message; alert.className = 'alert alert-danger'; }
}

function showRequestFeedback(id, message, type = 'success') {
  const alert = document.getElementById(id);
  alert.textContent = message;
  alert.className = `alert alert-${type}`;
}

async function submitRegistrationRequest(event) {
  event.preventDefault();
  try {
    const displayName = document.getElementById('registrationDisplayName').value.trim();
    const email = document.getElementById('registrationEmail').value.trim().toLowerCase();
    const password = document.getElementById('registrationPassword').value;
    const payload = await apiRequest('request_registration', { method: 'POST', body: JSON.stringify({ displayName, email, password }) }).catch(error => { if (error.message !== 'BACKEND_UNAVAILABLE') throw error; return localRequestRegistration(displayName, email, password); });
    showRequestFeedback('registrationRequestAlert', payload.message || 'Richiesta inviata.');
    event.target.reset();
  } catch (error) { localSecurityLog('registration_request_failed', 'warning', { message: error.message }); showRequestFeedback('registrationRequestAlert', error.message, 'danger'); }
}

async function submitRecoveryRequest(event) {
  event.preventDefault();
  try {
    const email = document.getElementById('recoveryEmail').value.trim().toLowerCase();
    const payload = await apiRequest('request_password_reset', { method: 'POST', body: JSON.stringify({ email }) }).catch(error => { if (error.message !== 'BACKEND_UNAVAILABLE') throw error; return localRequestReset(email); });
    showRequestFeedback('recoveryRequestAlert', payload.message || 'Richiesta inviata.');
  } catch (error) { localSecurityLog('password_reset_request_failed', 'warning', { message: error.message }); showRequestFeedback('recoveryRequestAlert', error.message, 'danger'); }
}

function ensureUserManagementCard() {
  if (!currentUser?.isPrimaryAdmin || document.getElementById('userManagementCard')) return;
  const nav = document.querySelector('#mainNav .navbar-nav');
  const settingsLink = nav?.querySelector('[data-view-link="settings"]')?.closest('.nav-item');
  if (nav && settingsLink && !nav.querySelector('[data-view-link="access"]')) { const item = document.createElement('li'); item.className = 'nav-item'; item.innerHTML = '<a class="nav-link" href="#access" data-view-link="access">Utenti e permessi</a>'; nav.insertBefore(item, settingsLink); item.querySelector('a').addEventListener('click', event => { event.preventDefault(); setView('access'); }); }
  const appContainer = document.querySelector('#appView > .container-fluid');
  if (!document.getElementById('accessView')) appContainer.insertAdjacentHTML('beforeend', '<section id="accessView" class="app-view d-none"><div class="mb-4"><p class="eyebrow text-secondary mb-2">Amministrazione</p><h1 class="display-6 fw-bold mb-2">Utenti e permessi</h1><p class="text-secondary mb-0">Crea ruoli, assegna capacità e gestisci gli accessi.</p></div><div id="accessManagementContainer"></div></section>');
  const accessContainer = document.getElementById('accessManagementContainer');
  if (accessContainer) accessContainer.insertAdjacentHTML('beforeend', '<div class="card border-0 shadow-sm" id="userManagementCard"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-center gap-3 mb-3"><div><h2 class="h5 mb-1">Gestione accessi</h2><p class="text-secondary small mb-0">Approva registrazioni, autorizza recuperi e gestisci gli accessi.</p></div><button type="button" class="btn btn-outline-primary btn-sm" id="refreshUsersButton">Aggiorna</button></div><div id="userManagementContent"></div></div></div>');
}

function renderUserManagement(data) {
  ensureUserManagementCard();
  const content = document.getElementById('userManagementContent');
  if (!content) return;
  const users = data.users.map(user => `<tr><td>${escapeHtml(user.displayName)}</td><td>${escapeHtml(user.username)}</td><td><select class="form-select form-select-sm user-role-select" data-user-id="${user.id}" ${user.isPrimaryAdmin ? 'disabled' : ''}><option value="reader" ${user.role === 'reader' ? 'selected' : ''}>Lettore</option><option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Redattore</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Amministratore</option></select></td><td>${user.isPrimaryAdmin ? '<span class="badge text-bg-primary">Principale</span>' : `<button type="button" class="btn btn-sm btn-outline-danger delete-user-button" data-user-id="${user.id}">Elimina</button>`}</td></tr>`).join('');
  const registrations = data.registrations.length ? data.registrations.map(item => `<div class="border-bottom py-2 d-flex flex-wrap align-items-center justify-content-between gap-2"><span><strong>${escapeHtml(item.display_name)}</strong><small class="d-block text-secondary">${escapeHtml(item.email)}</small></span><span class="d-flex gap-2"><select class="form-select form-select-sm registration-role" data-request-id="${item.id}" aria-label="Ruolo richiesto"><option value="reader">Lettore</option><option value="editor">Redattore</option></select><button type="button" class="btn btn-sm btn-primary approve-registration-button" data-request-id="${item.id}">Approva</button><button type="button" class="btn btn-sm btn-outline-danger reject-registration-button" data-request-id="${item.id}">Rifiuta</button></span></div>`).join('') : '<p class="text-secondary small mb-0">Nessuna richiesta di registrazione.</p>';
  const resets = data.resets.length ? data.resets.map(item => `<div class="border-bottom py-2 d-flex flex-wrap align-items-center justify-content-between gap-2"><span><strong>${escapeHtml(item.email)}</strong><small class="d-block text-secondary">Richiesta di recupero</small></span><span class="d-flex gap-2"><input class="form-control form-control-sm reset-password" data-request-id="${item.id}" type="password" minlength="8" placeholder="Nuova password" aria-label="Nuova password"><button type="button" class="btn btn-sm btn-primary approve-reset-button" data-request-id="${item.id}">Autorizza</button></span></div>`).join('') : '<p class="text-secondary small mb-0">Nessuna richiesta di recupero.</p>';
  content.innerHTML = `<h3 class="h6">Utenti attivi</h3><div class="table-responsive mb-4"><table class="table align-middle"><thead><tr><th>Nome</th><th>E-mail</th><th>Ruolo</th><th>Azioni</th></tr></thead><tbody>${users}</tbody></table></div><div class="row g-4"><div class="col-12 col-xl-6"><h3 class="h6">Richieste di registrazione</h3>${registrations}</div><div class="col-12 col-xl-6"><h3 class="h6">Recuperi password</h3>${resets}</div></div>`;
  content.querySelectorAll('.user-role-select').forEach(select => { const user = data.users.find(item => String(item.id) === select.dataset.userId); select.innerHTML = data.roles.map(role => `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join(''); select.value = user?.roleId || ''; });
  content.querySelectorAll('.registration-role').forEach(select => { select.innerHTML = data.roles.filter(role => !role.isPrimaryAdmin && !role.is_primary_admin).map(role => `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join(''); });
  const permissionGroups = [...new Set(data.permissions.map(permission => permission.permission_group))];
  const roleCards = data.roles.map(role => { const permissions = {}; data.rolePermissions.filter(item => String(item.role_id) === String(role.id)).forEach(item => { const permission = data.permissions.find(candidate => candidate.id === item.permission_id); if (permission) permissions[permission.permission_key] = item; }); const localPermissions = role.permissions || {}; return `<div class="border rounded p-3 mb-3"><div class="d-flex justify-content-between align-items-center mb-3"><div><strong>${escapeHtml(role.name)}</strong>${role.isSystem ? '<small class="d-block text-secondary">Ruolo di sistema</small>' : ''}</div><button type="button" class="btn btn-sm btn-primary save-role-permissions" data-role-id="${role.id}" ${role.role_key === 'admin' || role.roleKey === 'admin' ? 'disabled' : ''}>Salva permessi</button></div>${permissionGroups.map(group => `<div class="mb-3"><h4 class="small fw-bold">${escapeHtml(group)}</h4><div class="table-responsive"><table class="table table-sm align-middle mb-0"><tbody>${data.permissions.filter(permission => permission.permission_group === group).map(permission => { const saved = permissions[permission.permission_key]; const local = localPermissions[permission.permission_key] || {}; return `<tr><td>${escapeHtml(permission.label)}</td>${PERMISSION_ACTIONS.map(([action, label]) => `<td><label class="small"><input type="checkbox" class="role-permission" data-role-id="${role.id}" data-permission="${permission.permission_key}" data-action="${action}" ${saved ? saved[`can_${action}`] ? 'checked' : '' : local[action] ? 'checked' : ''}> ${label}</label></td>`).join('')}</tr>`; }).join('')}</tbody></table></div></div>`).join('')}</div>`; }).join('');
  const logs = (data.logs || []).map(log => `<tr><td class="small">${escapeHtml(new Date(log.created_at).toLocaleString('it-IT'))}</td><td><span class="badge ${log.severity === 'critical' ? 'text-bg-danger' : log.severity === 'warning' ? 'text-bg-warning' : 'text-bg-secondary'}">${escapeHtml(log.severity)}</span></td><td>${escapeHtml(log.event_type)}</td><td>${escapeHtml(log.username || 'Sistema')}</td><td class="small">${escapeHtml(typeof log.details === 'string' ? log.details : JSON.stringify(log.details || {}))}</td></tr>`).join('');
  content.insertAdjacentHTML('beforeend', `<hr class="my-4"><div class="d-flex justify-content-between align-items-center mb-3"><div><h3 class="h6 mb-1">Ruoli e permessi</h3><p class="text-secondary small mb-0">Ogni permesso può consentire visualizzazione, creazione, modifica, eliminazione o approvazione.</p></div><div class="input-group" style="max-width: 24rem"><input id="newRoleName" class="form-control" placeholder="Nome nuovo ruolo"><button type="button" class="btn btn-outline-primary" id="createRoleButton">Crea ruolo</button></div></div>${roleCards}<hr class="my-4"><h3 class="h6 mb-3">Log di sicurezza</h3><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Data</th><th>Gravità</th><th>Evento</th><th>Utente</th><th>Dettagli</th></tr></thead><tbody>${logs || '<tr><td colspan="5" class="text-secondary">Nessun evento registrato.</td></tr>'}</tbody></table></div>`);
}

async function refreshUserManagement() {
  if (!currentUser?.isPrimaryAdmin) return;
  ensureUserManagementCard();
  try { renderUserManagement(remoteMode ? await apiRequest('admin_data') : localAdminData()); } catch (error) { document.getElementById('userManagementContent').innerHTML = `<p class="text-danger small">${escapeHtml(error.message)}</p>`; }
}

async function userManagementAction(action, body, successMessage) {
  try {
    if (remoteMode) await apiRequest(action, { method: 'POST', body: JSON.stringify(body) });
    else {
      if (action === 'create_role') { const name = body.name.trim(); if (!name || localAuth.roles.some(role => role.name.toLowerCase() === name.toLowerCase())) throw new Error('Il nome ruolo è vuoto o già esistente.'); localAuth.roles.push({ id: crypto.randomUUID(), name, roleKey: `custom_${Date.now()}`, isSystem: false, permissions: {} }); }
      if (action === 'save_role_permissions') { const role = localAuth.roles.find(item => item.id === body.roleId); if (!role || role.roleKey === 'admin') throw new Error('Ruolo non modificabile.'); role.permissions = body.permissions; }
      if (action === 'approve_registration') { const request = localAuth.registrations.find(item => item.id === body.requestId); const role = localAuth.roles.find(item => item.id === body.roleId) || localAuth.roles.find(item => item.roleKey === 'guest'); if (!request || !role) throw new Error('Richiesta o ruolo non trovati.'); localAuth.users.push({ id: crypto.randomUUID(), username: request.email, displayName: request.displayName, roleId: role.id, isPrimaryAdmin: false, password: request.password }); request.status = 'approved'; }
      if (action === 'reject_registration') { const request = localAuth.registrations.find(item => item.id === body.requestId); if (request) request.status = 'rejected'; }
      if (action === 'approve_password_reset') { const request = localAuth.resets.find(item => item.id === body.requestId); const user = localAuth.users.find(item => item.id === request?.userId); if (!request || !user || body.newPassword.length < 8) throw new Error('Inserisci una nuova password di almeno 8 caratteri.'); user.password = body.newPassword; request.status = 'approved'; }
      if (action === 'change_user_role') { const user = localAuth.users.find(item => item.id === body.userId); const role = localAuth.roles.find(item => item.id === body.roleId); if (!user || !role || user.isPrimaryAdmin) throw new Error('Utente non modificabile.'); user.roleId = role.id; }
      if (action === 'delete_user') { const user = localAuth.users.find(item => item.id === body.userId); if (!user || user.isPrimaryAdmin) throw new Error('Utente non eliminabile.'); user.deletedAt = new Date().toISOString(); }
      saveLocalAuth();
    }
    if (!remoteMode) localSecurityLog(action, action.includes('delete') ? 'warning' : 'info', body);
    await refreshUserManagement(); showToast(successMessage);
  } catch (error) { showToast(error.message); }
}

function setView(view) {
  if (currentUser?.isPrimaryAdmin) ensureUserManagementCard();
  ensureGuideView();
  if (view !== 'dashboard' && !can({ dashboard: 'documents', templates: 'templates', parties: 'parties', companies: 'companies', parliament: 'parliament', government: 'government', composition: 'composition', interpretations: 'interpretations', odg: 'odg', settings: 'settings', access: 'users' }[view] || 'documents')) view = 'dashboard';
  document.querySelectorAll('.editor-page').forEach(element => element.classList.add('d-none'));
  document.querySelectorAll('.app-view').forEach(element => element.classList.toggle('d-none', element.id !== `${view}View`));
  document.querySelectorAll('[data-view-link]').forEach(link => link.classList.toggle('active', link.dataset.viewLink === view));
  if (view === 'dashboard') renderDocuments();
  if (view === 'parties') renderParties();
  if (view === 'companies') renderCompanies();
  if (view === 'parliament') renderParliaments();
  if (view === 'government') renderInstitution('government');
  if (view === 'composition') renderInstitution('composition');
  if (view === 'odg') renderOdg();
  if (view === 'interpretations') renderInterpretations();
  if (view === 'templates') renderTemplates();
  if (view === 'settings') { renderSettings(); renderInstitutionSettings('government'); renderInstitutionSettings('composition'); renderInterpretationSettings(); }
  if (view === 'access') { ensureUserManagementCard(); refreshUserManagement(); }
  if (view === 'guide') renderGuide();
  applyPermissions();
}

function showEditorScreen(screenId) {
  document.querySelectorAll('.app-view, .editor-page').forEach(element => element.classList.add('d-none'));
  document.getElementById(screenId).classList.remove('d-none');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeEditorScreen() {
  document.querySelectorAll('.editor-page').forEach(element => element.classList.add('d-none'));
  setView('dashboard');
}

function renderDocuments() {
  const query = document.getElementById('documentSearch').value.trim().toLowerCase();
  const documents = state.documents.filter(document => [document.title, document.category, document.number].join(' ').toLowerCase().includes(query)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const body = document.getElementById('documentTableBody');
  body.innerHTML = documents.map(document => `<tr class="document-row" data-open-document="${document.id}" tabindex="0" role="button"><td class="ps-4 fw-semibold">${escapeHtml(documentCode(document))}</td><td><strong>${escapeHtml(document.title)}</strong><small class="d-block text-secondary">${document.templateName ? `Template: ${escapeHtml(document.templateName)}` : 'Documento libero'}</small></td><td><span class="badge text-bg-light">${escapeHtml(document.category)}</span>${document.category === 'ODG' ? ` <span class="badge ${document.status === 'valutato' ? 'text-bg-success' : 'text-bg-warning'}">${document.status === 'valutato' ? 'Valutato' : 'Da valutare'}</span>` : ''}</td><td>${formatDate(document.date)}</td><td class="text-end pe-4"><div class="d-flex justify-content-end gap-2"><button class="btn btn-sm btn-outline-secondary" data-print-document="${document.id}">PDF / stampa</button>${can('documents_pdf', 'download') ? `<button class="btn btn-sm btn-primary" data-download-pdf="${document.id}">Scarica PDF</button>` : ''}</div></td></tr>`).join('');
  document.getElementById('emptyDocuments').classList.toggle('d-none', documents.length > 0);
  document.getElementById('documentCount').textContent = state.documents.length;
  document.getElementById('templateCount').textContent = state.templates.length;
  document.getElementById('lastUpdate').textContent = state.documents.length ? formatDate(state.documents[0].date) : '--';
}

function ensureOdgView() {
  const nav = document.querySelector('#mainNav .navbar-nav');
  const templateLink = nav?.querySelector('[data-view-link="templates"]')?.closest('.nav-item');
  if (nav && templateLink && !nav.querySelector('[data-view-link="odg"]')) {
    const item = document.createElement('li');
    item.className = 'nav-item';
    item.innerHTML = '<a class="nav-link" href="#odg" data-view-link="odg">ODG</a>';
    nav.insertBefore(item, templateLink);
  }
  const appContainer = document.querySelector('#appView > .container-fluid');
  if (!document.getElementById('odgView')) appContainer.insertAdjacentHTML('beforeend', '<section id="odgView" class="app-view d-none"><div class="d-flex flex-column flex-md-row justify-content-between align-items-md-end gap-3 mb-4"><div><p class="eyebrow text-secondary mb-2">Archivio istituzionale</p><h1 class="display-6 fw-bold mb-2">ODG</h1><p class="text-secondary mb-0">Ordini del giorno archiviati come documenti con stato di valutazione.</p></div><button class="btn btn-primary" type="button" id="newOdgButton">+ Nuovo ODG</button></div><div class="row g-3 mb-4"><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">ODG archiviati</span><strong id="odgCount">0</strong></div></div><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">Da valutare</span><strong id="odgToEvaluateCount">0</strong></div></div><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">Valutati</span><strong id="odgEvaluatedCount">0</strong></div></div></div><div id="odgGrid" class="row g-4"></div><div id="emptyOdg" class="empty-state d-none"><div class="display-6">□</div><h3 class="h5 mt-3">Nessun ODG archiviato</h3><p class="text-secondary mb-0">Crea il primo ordine del giorno.</p></div></section>');
  const categoryControl = document.getElementById('documentCategory');
  if (categoryControl && !document.getElementById('odgStatusField')) categoryControl.closest('.col-md-6').insertAdjacentHTML('afterend', '<div class="col-md-6 d-none" id="odgStatusField"><label for="odgStatus" class="form-label">Stato ODG</label><select id="odgStatus" class="form-select"><option value="da valutare">Da valutare</option><option value="valutato">Valutato</option></select></div>');
}

function syncOdgStatusField() {
  const isOdg = document.getElementById('documentCategory').value === 'ODG';
  document.getElementById('odgStatusField').classList.toggle('d-none', !isOdg);
  if (isOdg && !document.getElementById('odgStatus').value) document.getElementById('odgStatus').value = 'da valutare';
}

function renderOdg() {
  const odgs = state.documents.filter(document => document.category === 'ODG').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  document.getElementById('odgGrid').innerHTML = odgs.map(odg => `<div class="col-12 col-md-6 col-xl-4"><article class="party-card odg-card card border-0 shadow-sm" data-open-document="${odg.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-2 mb-3"><h2 class="h5 mb-0">${escapeHtml(odg.title)}</h2><span class="badge ${odg.status === 'valutato' ? 'text-bg-success' : 'text-bg-warning'}">${odg.status === 'valutato' ? 'Valutato' : 'Da valutare'}</span></div><p class="text-secondary small mb-3">Creato il ${formatDate(odg.date)}</p><p class="card-text text-secondary odg-preview">${escapeHtml(plainText(odg.body))}</p></div><div class="card-footer bg-white border-0 px-4 pb-4"><span class="small text-secondary">${escapeHtml(documentCode(odg))}</span><button type="button" class="btn btn-sm btn-outline-secondary float-end" data-open-document="${odg.id}">Apri ODG</button></div></article></div>`).join('');
  document.getElementById('emptyOdg').classList.toggle('d-none', odgs.length > 0);
  document.getElementById('odgCount').textContent = odgs.length;
  document.getElementById('odgToEvaluateCount').textContent = odgs.filter(odg => odg.status !== 'valutato').length;
  document.getElementById('odgEvaluatedCount').textContent = odgs.filter(odg => odg.status === 'valutato').length;
}

function renderTemplates() {
  const grid = document.getElementById('templateGrid');
  grid.innerHTML = state.templates.map(template => `<div class="col-12 col-md-6 col-xl-4"><article class="template-card card border-0 shadow-sm"><div class="card-body p-4">${template.image ? `<img src="${template.image}" alt="" class="img-fluid mb-3" style="max-height: 110px; width: 100%; object-fit: cover;">` : ''}<p class="eyebrow text-secondary mb-2">${escapeHtml(template.category)}</p><h2 class="h5">${escapeHtml(template.name)}</h2><p class="card-text text-secondary small mb-0">${escapeHtml(plainText(template.body))}</p></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-end gap-2">${can('templates', 'edit') ? `<button class="btn btn-sm btn-outline-secondary" data-edit-template="${template.id}">Modifica</button>` : ''}${can('templates', 'delete') ? `<button class="btn btn-sm btn-outline-danger" data-delete-template="${template.id}">Elimina</button>` : ''}<button class="btn btn-sm btn-outline-secondary" data-use-template="${template.id}">Usa template</button></div></article></div>`).join('');
  document.getElementById('emptyTemplates').classList.toggle('d-none', state.templates.length > 0);
}

function deleteTemplate(templateId) {
  if (!can('templates', 'delete')) { showToast('Non hai il permesso di eliminare i template.'); return; }
  const template = state.templates.find(item => item.id === templateId);
  if (!template || !confirm(`Eliminare il template "${template.name}"? I documenti già creati non verranno modificati.`)) return;
  state.templates = state.templates.filter(item => item.id !== templateId);
  writeStorage(STORAGE_KEYS.templates, state.templates);
  refreshCategoryOptions();
  refreshDocumentTemplateOptions();
  renderTemplates();
  renderDocuments();
  showToast('Template eliminato.');
}

function renderParties() {
  const grid = document.getElementById('partyGrid');
  const parties = [...state.parties].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  grid.innerHTML = parties.map(party => `<div class="col-12 col-md-6 col-xl-4"><article class="party-card card border-0 shadow-sm" data-open-party="${party.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-2 mb-3"><h2 class="h5 mb-0">${escapeHtml(party.name)}</h2><span class="badge ${statusClass(party.status)}">${statusLabel(party.status)}</span></div><p class="text-secondary small mb-3">${party.statute ? `Statuto aggiornato il ${formatDate(party.updatedAt.slice(0, 10))}` : 'Statuto da redigere'}</p><dl class="party-facts mb-0">${state.partyFields.slice(0, 3).map(field => `<div><dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(party.fields?.[field.id] || '—')}</dd></div>`).join('')}</dl></div><div class="card-footer bg-white border-0 px-4 pb-4"><span class="small text-secondary">${party.history?.length || 0} modifiche registrate</span><button type="button" class="btn btn-sm btn-outline-secondary float-end" data-open-party-statute="${party.id}">${party.statute ? 'Modifica Statuto' : 'Scrivi Statuto'}</button></div></article></div>`).join('');
  document.getElementById('emptyParties').classList.toggle('d-none', parties.length > 0);
  document.getElementById('partyCount').textContent = parties.length;
  document.getElementById('activePartyCount').textContent = parties.filter(party => party.status === 'attivo').length;
  document.getElementById('partyFieldCount').textContent = state.partyFields.length;
}

function renderCompanies() {
  const grid = document.getElementById('companyGrid');
  const companies = [...state.companies].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  grid.innerHTML = companies.map(company => `<div class="col-12 col-md-6 col-xl-4"><article class="party-card company-card card border-0 shadow-sm" data-open-company="${company.id}" tabindex="0" role="button"><div class="card-body p-4"><h2 class="h5 mb-3">${escapeHtml(company.name)}</h2><p class="text-secondary small mb-0">${company.regulation ? `Regolamento aggiornato il ${formatDate(company.updatedAt.slice(0, 10))}` : 'Regolamento da redigere'}</p></div><div class="card-footer bg-white border-0 px-4 pb-4"><span class="small text-secondary">${company.history?.length || 0} modifiche registrate</span><button type="button" class="btn btn-sm btn-outline-secondary float-end" data-open-company-regulation="${company.id}">${company.regulation ? 'Modifica Regolamento' : 'Scrivi Regolamento'}</button></div></article></div>`).join('');
  document.getElementById('emptyCompanies').classList.toggle('d-none', companies.length > 0);
  document.getElementById('companyCount').textContent = companies.length;
  document.getElementById('companyRegulationCount').textContent = companies.filter(company => company.regulation).length;
}

function institutionSettings(type) { return state[institutionConfigs[type].settingsKey]; }
function institutionRecords(type) { return state[institutionConfigs[type].key]; }
function institutionRole(type, roleId) { return institutionSettings(type).roles.find(role => role.id === roleId); }
function institutionActive(record) { return !record.endDate; }

function ensureInstitutionViews() {
  const nav = document.querySelector('#mainNav .navbar-nav');
  const parliamentLink = nav?.querySelector('[data-view-link="parliament"]')?.closest('.nav-item');
  if (nav && parliamentLink && !nav.querySelector('[data-view-link="government"]')) ['government', 'composition'].forEach(type => { const item = document.createElement('li'); item.className = 'nav-item'; item.innerHTML = `<a class="nav-link" href="#${institutionConfigs[type].view}" data-view-link="${institutionConfigs[type].view}">${institutionConfigs[type].label}</a>`; nav.insertBefore(item, parliamentLink.nextSibling); });
  const appContainer = document.querySelector('#appView > .container-fluid');
  Object.entries(institutionConfigs).forEach(([type, config]) => {
    if (!document.getElementById(`${config.view}View`)) appContainer.insertAdjacentHTML('beforeend', `<section id="${config.view}View" class="app-view d-none"><div class="d-flex flex-column flex-md-row justify-content-between align-items-md-end gap-3 mb-4"><div><p class="eyebrow text-secondary mb-2">Archivio istituzionale</p><h1 class="display-6 fw-bold mb-2">${config.label}</h1><p class="text-secondary mb-0">Gestisci periodi, ruoli, nomine e storico.</p></div><button class="btn btn-primary" type="button" data-new-institution="${type}">+ ${config.newLabel || `Nuovo ${config.itemLabel.toLowerCase()}`}</button></div><div class="row g-3 mb-4"><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">Schede archiviate</span><strong id="${config.view}Count">0</strong></div></div><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">Periodi in corso</span><strong id="${config.view}CurrentCount">0</strong></div></div><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">Componenti registrati</span><strong id="${config.view}MemberCount">0</strong></div></div></div><div id="${config.view}Grid" class="row g-4"></div><div id="${config.view}Empty" class="empty-state d-none"><div class="display-6">□</div><h3 class="h5 mt-3">Nessuna scheda archiviata</h3><p class="text-secondary mb-0">Crea la prima scheda per iniziare.</p></div></section>`);
    if (!document.getElementById(`${type}Editor`)) document.body.insertAdjacentHTML('beforeend', `<div class="editor-page d-none" id="${type}Editor"><div class="modal-dialog"><div class="modal-content"><form id="${type}Form"><div class="modal-header"><div><p class="eyebrow text-secondary mb-1">Archivio istituzionale</p><h2 class="modal-title h4">${config.itemLabel}</h2></div><button type="button" class="btn-close" data-close-institution="${type}" aria-label="Chiudi"></button></div><div class="modal-body"><div class="row g-3"><div class="col-md-6"><label for="${type}Period" class="form-label">Periodo o denominazione</label><input id="${type}Period" class="form-control" required placeholder="Es. XVIII legislatura"></div><div class="col-md-3"><label for="${type}Start" class="form-label">Data inizio</label><input id="${type}Start" type="date" class="form-control" required></div><div class="col-md-3"><label for="${type}End" class="form-label">Data fine</label><input id="${type}End" type="date" class="form-control" required></div><div class="col-12"><label for="${type}Status" class="form-label">Stato</label><select id="${type}Status" class="form-select"><option value="in corso">In corso</option><option value="concluso">Concluso</option></select></div><div class="col-12"><hr><div class="d-flex justify-content-between align-items-center"><div><h3 class="h6 mb-1">Nomine e componenti</h3><p class="text-secondary small mb-0">Le cessazioni restano nello storico e non occupano il limite del ruolo.</p></div><button type="button" class="btn btn-sm btn-primary" data-add-institution-member="${type}">+ Nuova nomina</button></div></div><div class="col-12" id="${type}RoleLists"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-close-institution="${type}">Annulla</button><button class="btn btn-primary" type="submit">Salva ${config.itemLabel.toLowerCase()}</button></div></form></div></div></div>`);
    if (!document.getElementById(`${type}PersonModal`)) document.body.insertAdjacentHTML('beforeend', `<div class="modal fade" id="${type}PersonModal" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-lg"><div class="modal-content"><form id="${type}PersonForm"><div class="modal-header"><h2 class="modal-title h5">Nuova nomina</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button></div><div class="modal-body"><div class="row g-3"><div class="col-md-7"><label for="${type}PersonName" class="form-label">Nome e cognome</label><input id="${type}PersonName" class="form-control" required></div><div class="col-md-5"><label for="${type}PersonRole" class="form-label">Ruolo</label><select id="${type}PersonRole" class="form-select" required></select></div><div class="col-md-6"><label for="${type}PersonStart" class="form-label">Data nomina</label><input id="${type}PersonStart" type="date" class="form-control" required></div><div class="col-md-6"><label for="${type}PersonEnd" class="form-label">Data cessazione</label><input id="${type}PersonEnd" type="date" class="form-control"></div><div class="col-12"><label for="${type}PersonNotes" class="form-label">Annotazioni</label><textarea id="${type}PersonNotes" class="form-control" rows="3"></textarea></div></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Annulla</button><button class="btn btn-primary" type="submit">Salva nomina</button></div></form></div></div></div>`);
    const settingsView = document.getElementById('settingsView');
    if (!document.getElementById(`${type}SettingsCard`)) settingsView.querySelector('.row').insertAdjacentHTML('beforeend', `<div class="col-12 col-xl-6"><div class="card border-0 shadow-sm h-100" id="${type}SettingsCard"><div class="card-body p-4"><h2 class="h5 mb-1">Configurazione ${config.label}</h2><p class="text-secondary small">Crea i ruoli e imposta il numero massimo di componenti per ciascun ruolo.</p><form id="${type}SettingsForm" class="vstack gap-2"></form></div></div></div>`);
  });
}

function ensureInterpretationView() {
  const nav = document.querySelector('#mainNav .navbar-nav');
  const templateLink = nav?.querySelector('[data-view-link="templates"]')?.closest('.nav-item');
  if (nav && templateLink && !nav.querySelector('[data-view-link="interpretations"]')) {
    const item = document.createElement('li');
    item.className = 'nav-item';
    item.innerHTML = '<a class="nav-link" href="#interpretations" data-view-link="interpretations">Interpretazioni</a>';
    nav.insertBefore(item, templateLink);
  }
  const appContainer = document.querySelector('#appView > .container-fluid');
  if (!document.getElementById('interpretationsView')) appContainer.insertAdjacentHTML('beforeend', '<section id="interpretationsView" class="app-view d-none"><div class="d-flex flex-column flex-md-row justify-content-between align-items-md-end gap-3 mb-4"><div><p class="eyebrow text-secondary mb-2">Archivio interpretativo</p><h1 class="display-6 fw-bold mb-2">Interpretazioni</h1><p class="text-secondary mb-0">Conserva orientamenti e letture della Corte in forma testuale.</p></div><button class="btn btn-primary" type="button" id="newInterpretationButton">+ Nuova interpretazione</button></div><div class="row g-3 mb-4"><div class="col-12 col-md-6"><div class="stat-card"><span class="text-secondary small">Interpretazioni archiviate</span><strong id="interpretationCount">0</strong></div></div><div class="col-12 col-md-6"><div class="stat-card"><span class="text-secondary small">Ultima creazione</span><strong id="interpretationLastDate">--</strong></div></div></div><div id="interpretationGrid" class="row g-4"></div><div id="emptyInterpretations" class="empty-state d-none"><div class="display-6">□</div><h3 class="h5 mt-3">Nessuna interpretazione archiviata</h3><p class="text-secondary mb-0">Crea la prima interpretazione per iniziare.</p></div></section>');
  if (!document.getElementById('interpretationEditor')) document.body.insertAdjacentHTML('beforeend', '<div class="editor-page d-none" id="interpretationEditor"><div class="modal-dialog"><div class="modal-content"><form id="interpretationForm"><div class="modal-header"><div><p class="eyebrow text-secondary mb-1">Archivio interpretativo</p><h2 class="modal-title h4">Nuova interpretazione</h2></div><button type="button" class="btn-close" id="closeInterpretationEditor" aria-label="Chiudi"></button></div><div class="modal-body"><div class="row g-3"><div class="col-md-8"><label for="interpretationName" class="form-label">Nome interpretazione</label><input id="interpretationName" class="form-control" required placeholder="Es. Interpretazione dell’articolo 12"></div><div class="col-md-4"><label for="interpretationDate" class="form-label">Data di creazione</label><input id="interpretationDate" type="date" class="form-control" required></div><div id="interpretationBaseFields" class="row g-3"></div><div class="col-12"><label for="interpretationText" class="form-label">Testo dell’interpretazione</label><textarea id="interpretationText" class="form-control interpretation-text" rows="18" required placeholder="Scrivi qui l’interpretazione..."></textarea><div class="form-text">Questo contenuto è un testo interpretativo e non viene archiviato come documento.</div></div></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" id="cancelInterpretationEditor">Annulla</button><button class="btn btn-primary" type="submit">Salva interpretazione</button></div></form></div></div></div>');
  const settingsView = document.getElementById('settingsView');
  if (!document.getElementById('interpretationSettingsCard')) settingsView.querySelector('.row').insertAdjacentHTML('beforeend', '<div class="col-12 col-xl-6"><div class="card border-0 shadow-sm h-100" id="interpretationSettingsCard"><div class="card-body p-4"><h2 class="h5 mb-1">Valori base delle interpretazioni</h2><p class="text-secondary small">Questi campi saranno disponibili in ogni nuova interpretazione.</p><form id="interpretationFieldForm" class="row g-2 mb-3"><div class="col"><label for="interpretationFieldName" class="visually-hidden">Nome valore base</label><input id="interpretationFieldName" class="form-control" required placeholder="Es. Fonte normativa"></div><div class="col-auto"><button class="btn btn-primary" type="submit">Aggiungi campo</button></div></form><div id="interpretationFieldList" class="vstack gap-2"></div></div></div></div>');
}

function renderInterpretationFields(interpretation = null) {
  document.getElementById('interpretationBaseFields').innerHTML = state.interpretationSettings.fields.map(field => `<div class="col-12 col-md-6"><label class="form-label" for="interpretation-field-${field.id}">${escapeHtml(field.name)}</label><input id="interpretation-field-${field.id}" class="form-control interpretation-field-input" data-field-id="${field.id}" value="${escapeHtml(interpretation?.fields?.[field.id] || '')}"></div>`).join('');
}

function renderInterpretations() {
  const interpretations = [...state.interpretations].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  document.getElementById('interpretationGrid').innerHTML = interpretations.map(item => `<div class="col-12 col-md-6 col-xl-4"><article class="party-card interpretation-card card border-0 shadow-sm" data-open-interpretation="${item.id}" tabindex="0" role="button"><div class="card-body p-4"><p class="eyebrow text-secondary mb-2">Creata il ${formatDate(item.date)}</p><h2 class="h5 mb-3">${escapeHtml(item.name)}</h2><p class="card-text text-secondary interpretation-preview">${escapeHtml(item.text)}</p><dl class="party-facts mb-0">${state.interpretationSettings.fields.slice(0, 3).map(field => `<div><dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(item.fields?.[field.id] || '—')}</dd></div>`).join('')}</dl></div><div class="card-footer bg-white border-0 px-4 pb-4"><span class="small text-secondary">Testo interpretativo</span><button type="button" class="btn btn-sm btn-outline-secondary float-end" data-open-interpretation="${item.id}">Apri scheda</button></div></article></div>`).join('');
  document.getElementById('emptyInterpretations').classList.toggle('d-none', interpretations.length > 0);
  document.getElementById('interpretationCount').textContent = interpretations.length;
  document.getElementById('interpretationLastDate').textContent = interpretations.length ? formatDate(interpretations[0].date) : '--';
}

function renderInterpretationSettings() {
  document.getElementById('interpretationFieldList').innerHTML = state.interpretationSettings.fields.length ? state.interpretationSettings.fields.map(field => `<div class="d-flex justify-content-between align-items-center border-bottom pb-2"><span>${escapeHtml(field.name)}<small class="d-block text-secondary">Disponibile in ogni interpretazione</small></span><button type="button" class="btn btn-sm btn-outline-danger" data-remove-interpretation-field="${field.id}">Rimuovi</button></div>`).join('') : '<p class="text-secondary small mb-0">Nessun valore base configurato.</p>';
}

function openInterpretationEditor(id = '') {
  const interpretation = state.interpretations.find(item => item.id === id);
  window.editingInterpretationId = interpretation?.id || null;
  document.getElementById('interpretationForm').reset();
  document.getElementById('interpretationName').value = interpretation?.name || '';
  document.getElementById('interpretationDate').value = interpretation?.date || today();
  document.getElementById('interpretationText').value = interpretation?.text || '';
  renderInterpretationFields(interpretation);
  document.querySelector('#interpretationEditor .modal-title').textContent = interpretation ? 'Modifica interpretazione' : 'Nuova interpretazione';
  showEditorScreen('interpretationEditor');
}

function saveInterpretation(event) {
  event.preventDefault();
  const existing = state.interpretations.find(item => item.id === window.editingInterpretationId);
  const text = document.getElementById('interpretationText').value.trim();
  const fields = Object.fromEntries([...document.querySelectorAll('.interpretation-field-input')].map(input => [input.dataset.fieldId, input.value.trim()]));
  if (!document.getElementById('interpretationName').value.trim() || !text) { showToast('Inserisci nome e testo dell’interpretazione.'); return; }
  const record = { id: window.editingInterpretationId || crypto.randomUUID(), name: document.getElementById('interpretationName').value.trim(), date: document.getElementById('interpretationDate').value, fields, text, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (existing) state.interpretations[state.interpretations.indexOf(existing)] = record; else state.interpretations.unshift(record);
  writeStorage(STORAGE_KEYS.interpretations, state.interpretations);
  document.getElementById('interpretationEditor').classList.add('d-none');
  setView('interpretations');
  showToast(existing ? 'Interpretazione aggiornata.' : 'Interpretazione salvata.');
}

function renderInstitutionSettings(type) {
  const form = document.getElementById(`${type}SettingsForm`);
  const roles = institutionSettings(type).roles;
  form.innerHTML = `<div class="vstack gap-2">${roles.map(role => `<div class="row g-2 align-items-end institution-role-setting" data-role-id="${role.id}"><div class="col"><label class="form-label">Nome ruolo</label><input class="form-control institution-role-name" value="${escapeHtml(role.name)}" required></div><div class="col-auto"><label class="form-label">Numero</label><input class="form-control institution-role-limit" type="number" min="0" value="${role.limit}" required></div><div class="col-auto"><button type="button" class="btn btn-outline-danger" data-remove-institution-role="${type}" data-role-id="${role.id}" ${roles.length <= 1 ? 'disabled' : ''}>Rimuovi</button></div></div>`).join('')}</div><div class="d-flex gap-2 mt-2"><button type="button" class="btn btn-outline-primary" data-add-institution-role="${type}">+ Nuovo ruolo</button><button type="submit" class="btn btn-primary">Salva configurazione</button></div>`;
}

function renderInstitution(type) {
  const config = institutionConfigs[type];
  const records = [...institutionRecords(type)].sort((a, b) => b.startDate.localeCompare(a.startDate));
  document.getElementById(`${config.view}Grid`).innerHTML = records.map(record => { const active = record.members.filter(institutionActive).length; return `<div class="col-12 col-xl-6"><article class="parliament-card card border-0 shadow-sm" data-open-institution="${type}" data-record-id="${record.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-3"><div><p class="eyebrow text-secondary mb-2">${escapeHtml(record.period)}</p><h2 class="h4 mb-2">${config.itemLabel}</h2></div><span class="badge ${record.status === 'in corso' ? 'text-bg-success' : 'text-bg-secondary'}">${mandateStatusLabel(record.status)}</span></div><p class="text-secondary mb-3">${formatDate(record.startDate)} → ${formatDate(record.endDate)}</p><div class="d-flex flex-wrap gap-3 small">${institutionSettings(type).roles.map(role => `<span>${record.members.filter(member => member.role === role.id && institutionActive(member)).length} ${escapeHtml(role.name.toLowerCase())}</span>`).join('')}<span>${active} in carica</span></div></div><div class="card-footer bg-white border-0 px-4 pb-4"><span class="small text-secondary">${record.members.length} nomine nello storico</span><button type="button" class="btn btn-sm btn-outline-secondary float-end" data-open-institution="${type}" data-record-id="${record.id}">Gestisci</button></div></article></div>`; }).join('');
  document.getElementById(`${config.view}Empty`).classList.toggle('d-none', records.length > 0);
  document.getElementById(`${config.view}Count`).textContent = records.length;
  document.getElementById(`${config.view}CurrentCount`).textContent = records.filter(record => record.status === 'in corso').length;
  document.getElementById(`${config.view}MemberCount`).textContent = records.reduce((total, record) => total + record.members.length, 0);
}

function renderInstitutionMembers(type, record) {
  const container = document.getElementById(`${type}RoleLists`);
  container.innerHTML = institutionSettings(type).roles.map(role => { const members = record.members.filter(member => member.role === role.id); const active = members.filter(institutionActive).length; return `<section class="mb-4"><h4 class="h6">${escapeHtml(role.name)}</h4><div class="parliament-member-list">${members.length ? members.map(member => `<div class="parliament-member ${member.endDate ? 'is-resigned' : ''}"><div><strong>${escapeHtml(member.name)}</strong><span class="d-block small text-secondary">${member.endDate ? `Cessato il ${formatDate(member.endDate)}` : `Nominato il ${formatDate(member.startDate)}`}${member.annotations ? ` · Annotazioni: ${escapeHtml(member.annotations)}` : ''}</span></div><div class="d-flex gap-2"><button type="button" class="btn btn-sm btn-outline-secondary" data-edit-institution-member="${type}" data-member-id="${member.id}">Modifica</button>${!member.endDate ? `<button type="button" class="btn btn-sm btn-outline-danger" data-end-institution-member="${type}" data-member-id="${member.id}">Cessa</button>` : ''}</div></div>`).join('') : `<p class="small text-secondary mb-2">Nessun componente.</p>`}${active < role.limit ? `<button type="button" class="btn btn-sm btn-outline-primary" data-add-institution-member="${type}" data-role-id="${role.id}">+ Aggiungi ${escapeHtml(role.name)}</button>` : ''}</div></section>`; }).join('');
}

function openInstitutionEditor(type, recordId = '') { const config = institutionConfigs[type]; const record = institutionRecords(type).find(item => item.id === recordId); window[`editing${type}Id`] = record?.id || null; document.getElementById(`${type}Period`).value = record?.period || ''; document.getElementById(`${type}Start`).value = record?.startDate || today(); document.getElementById(`${type}End`).value = record?.endDate || ''; document.getElementById(`${type}Status`).value = record?.status || 'in corso'; document.querySelector(`#${type}Editor .modal-title`).textContent = record ? `${config.itemLabel} ${record.period}` : `Nuovo ${config.itemLabel.toLowerCase()}`; if (record) renderInstitutionMembers(type, record); else document.getElementById(`${type}RoleLists`).innerHTML = '<p class="small text-secondary">Salva la scheda per inserire le nomine.</p>'; showEditorScreen(`${type}Editor`); }

function saveInstitution(type, event) { event.preventDefault(); const existingId = window[`editing${type}Id`]; const existing = institutionRecords(type).find(item => item.id === existingId); const period = document.getElementById(`${type}Period`).value.trim(); const startDate = document.getElementById(`${type}Start`).value; const endDate = document.getElementById(`${type}End`).value; if (!period || !startDate || !endDate || endDate < startDate) { showToast('Inserisci dati validi per la scheda.'); return; } const record = { id: existingId || crypto.randomUUID(), period, startDate, endDate, status: document.getElementById(`${type}Status`).value, members: existing?.members || [], createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }; const records = institutionRecords(type); if (existing) records[records.indexOf(existing)] = record; else records.unshift(record); writeStorage(STORAGE_KEYS[institutionConfigs[type].key], records); renderInstitution(type); openInstitutionEditor(type, record.id); }

function openInstitutionMember(type, memberId = '', roleId = '') { const record = institutionRecords(type).find(item => item.id === window[`editing${type}Id`]); const member = record?.members.find(item => item.id === memberId); if (!record) return; window[`editing${type}MemberId`] = member?.id || null; document.getElementById(`${type}PersonRole`).innerHTML = institutionSettings(type).roles.map(role => `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join(''); document.getElementById(`${type}PersonForm`).reset(); document.getElementById(`${type}PersonRole`).value = member?.role || roleId || institutionSettings(type).roles[0].id; document.getElementById(`${type}PersonName`).value = member?.name || ''; document.getElementById(`${type}PersonStart`).value = member?.startDate || today(); document.getElementById(`${type}PersonEnd`).value = member?.endDate || ''; document.getElementById(`${type}PersonNotes`).value = member?.annotations || ''; bootstrap.Modal.getOrCreateInstance(document.getElementById(`${type}PersonModal`)).show(); }

function saveInstitutionMember(type, event) { event.preventDefault(); const record = institutionRecords(type).find(item => item.id === window[`editing${type}Id`]); if (!record) return; const memberId = window[`editing${type}MemberId`]; const role = document.getElementById(`${type}PersonRole`).value; const roleConfig = institutionRole(type, role); const activeCount = record.members.filter(member => member.role === role && institutionActive(member) && member.id !== memberId).length; if (!memberId && activeCount >= roleConfig.limit) { showToast(`Hai raggiunto il numero massimo per il ruolo ${roleConfig.name}.`); return; } const existing = record.members.find(member => member.id === memberId); const person = { id: memberId || crypto.randomUUID(), role, name: document.getElementById(`${type}PersonName`).value.trim(), startDate: document.getElementById(`${type}PersonStart`).value, endDate: document.getElementById(`${type}PersonEnd`).value, annotations: document.getElementById(`${type}PersonNotes`).value.trim(), createdAt: existing?.createdAt || new Date().toISOString() }; if (!person.name || !person.startDate) { showToast('Inserisci nome e data di nomina.'); return; } if (existing) record.members[record.members.indexOf(existing)] = person; else record.members.push(person); record.updatedAt = new Date().toISOString(); writeStorage(STORAGE_KEYS[institutionConfigs[type].key], institutionRecords(type)); bootstrap.Modal.getOrCreateInstance(document.getElementById(`${type}PersonModal`)).hide(); renderInstitutionMembers(type, record); renderInstitution(type); }

function endInstitutionMember(type, memberId) { const record = institutionRecords(type).find(item => item.id === window[`editing${type}Id`]); const member = record?.members.find(item => item.id === memberId); if (!record || !member || member.endDate || !confirm(`Registrare la cessazione di ${member.name}?`)) return; member.endDate = today(); record.updatedAt = new Date().toISOString(); writeStorage(STORAGE_KEYS[institutionConfigs[type].key], institutionRecords(type)); renderInstitutionMembers(type, record); renderInstitution(type); }

function bindInstitutionEvents() { Object.keys(institutionConfigs).forEach(type => { document.getElementById(`${type}Form`).addEventListener('submit', event => saveInstitution(type, event)); document.getElementById(`${type}PersonForm`).addEventListener('submit', event => saveInstitutionMember(type, event)); document.getElementById(`${type}SettingsForm`).addEventListener('submit', event => { event.preventDefault(); const roles = [...document.querySelectorAll(`#${type}SettingsForm .institution-role-setting`)].map(row => ({ id: row.dataset.roleId, name: row.querySelector('.institution-role-name').value.trim(), limit: Math.max(0, Number.parseInt(row.querySelector('.institution-role-limit').value, 10) || 0) })).filter(role => role.name); if (!roles.length || new Set(roles.map(role => role.name.toLowerCase())).size !== roles.length) { showToast('Inserisci nomi di ruolo univoci.'); return; } state[institutionConfigs[type].settingsKey].roles = roles; writeStorage(STORAGE_KEYS[institutionConfigs[type].settingsKey], state[institutionConfigs[type].settingsKey]); renderInstitutionSettings(type); renderInstitution(type); showToast('Configurazione salvata.'); }); document.getElementById(`${type}SettingsForm`).addEventListener('click', event => { const add = event.target.closest('[data-add-institution-role]'); if (add) { const row = document.createElement('div'); row.className = 'row g-2 align-items-end institution-role-setting'; row.dataset.roleId = crypto.randomUUID(); row.innerHTML = '<div class="col"><label class="form-label">Nome ruolo</label><input class="form-control institution-role-name" placeholder="Es. Sottosegretario" required></div><div class="col-auto"><label class="form-label">Numero</label><input class="form-control institution-role-limit" type="number" min="0" value="1" required></div><div class="col-auto"><button type="button" class="btn btn-outline-danger" data-remove-institution-role="'+type+'">Rimuovi</button></div>'; document.querySelector(`#${type}SettingsForm > .vstack`).appendChild(row); row.querySelector('input').focus(); return; } const remove = event.target.closest('[data-remove-institution-role]'); if (remove) remove.closest('.institution-role-setting').remove(); }); }); document.addEventListener('click', event => { const newInstitution = event.target.closest('[data-new-institution]'); if (newInstitution) openInstitutionEditor(newInstitution.dataset.newInstitution); const openInstitution = event.target.closest('[data-open-institution]'); if (openInstitution) openInstitutionEditor(openInstitution.dataset.openInstitution, openInstitution.dataset.recordId); const closeInstitution = event.target.closest('[data-close-institution]'); if (closeInstitution) { document.getElementById(`${closeInstitution.dataset.closeInstitution}Editor`).classList.add('d-none'); setView(institutionConfigs[closeInstitution.dataset.closeInstitution].view); } const addMember = event.target.closest('[data-add-institution-member]'); if (addMember) openInstitutionMember(addMember.dataset.addInstitutionMember, '', addMember.dataset.roleId || ''); const editMember = event.target.closest('[data-edit-institution-member]'); if (editMember) openInstitutionMember(editMember.dataset.editInstitutionMember, editMember.dataset.memberId); const endMember = event.target.closest('[data-end-institution-member]'); if (endMember) endInstitutionMember(endMember.dataset.endInstitutionMember, endMember.dataset.memberId); }); }

function renderParliaments() {
  const grid = document.getElementById('parliamentGrid');
  const mandates = [...state.parliaments].sort((a, b) => b.startDate.localeCompare(a.startDate));
  grid.innerHTML = mandates.map(mandate => { const active = mandate.members.filter(member => !member.resignationDate).length; const roleSummary = parliamentRoles().map(role => `<span>${mandate.members.filter(member => member.role === role.id && !member.resignationDate).length} ${escapeHtml(parliamentRoleLabel(role.id, true).toLowerCase())} attivi</span>`).join(''); return `<div class="col-12 col-xl-6"><article class="parliament-card card border-0 shadow-sm" data-open-parliament="${mandate.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-3"><div><p class="eyebrow text-secondary mb-2">Legislazione ${escapeHtml(mandate.legislation)}</p><h2 class="h4 mb-2">Mandato parlamentare</h2></div><span class="badge ${mandate.status === 'in corso' ? 'text-bg-success' : 'text-bg-secondary'}">${mandateStatusLabel(mandate.status)}</span></div><p class="text-secondary mb-3">${formatDate(mandate.startDate)} → ${formatDate(mandate.endDate)}</p><div class="d-flex flex-wrap gap-3 small">${roleSummary}<span>${active} in carica</span></div></div><div class="card-footer bg-white border-0 px-4 pb-4"><span class="small text-secondary">${mandate.members.length} nomine nello storico</span><button type="button" class="btn btn-sm btn-outline-secondary float-end" data-open-parliament-action="${mandate.id}">Gestisci mandato</button></div></article></div>`; }).join('');
  document.getElementById('emptyParliaments').classList.toggle('d-none', mandates.length > 0);
  document.getElementById('parliamentCount').textContent = mandates.length;
  document.getElementById('currentParliamentCount').textContent = mandates.filter(mandate => mandate.status === 'in corso').length;
  document.getElementById('memberCount').textContent = mandates.reduce((total, mandate) => total + mandate.members.length, 0);
}

function renderMemberList(mandate, role) {
  const members = mandate.members.filter(member => member.role === role);
  const list = document.querySelector(`[data-role-list="${role}"]`);
  const limit = parliamentRole(role)?.limit ?? 0;
  const roleLabel = parliamentRoleLabel(role);
  if (!list) return;
  list.innerHTML = members.length ? members.map(member => `<div class="parliament-member ${member.resignationDate ? 'is-resigned' : ''}"><div><strong>${escapeHtml(member.name)}</strong><span class="d-block small text-secondary">${member.resignationDate ? `Dimesso il ${formatDate(member.resignationDate)}` : `Giurato il ${formatDate(member.oathDate)}`}${member.memberParty ? ` · ${escapeHtml(member.memberParty)}` : ''}${member.annotations ? ` · Annotazioni: ${escapeHtml(member.annotations)}` : ''}</span></div><div class="d-flex gap-2"><button type="button" class="btn btn-sm btn-outline-secondary" data-edit-member="${member.id}">Modifica</button>${!member.resignationDate ? `<button type="button" class="btn btn-sm btn-outline-danger" data-resign-member="${member.id}">Dimetti</button>` : `<button type="button" class="btn btn-sm btn-outline-primary" data-new-nomination="${role}">Nuova nomina</button>`}</div></div>`).join('') : `<p class="small text-secondary mb-2">Nessun ${roleLabel.toLowerCase()} inserito.</p>`;
  if (members.filter(member => !member.resignationDate).length < limit) list.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn-sm btn-outline-primary" data-new-nomination="${role}">+ Aggiungi ${roleLabel}</button>`);
}

function renderParliamentMembers(mandate) {
  let container = document.getElementById('parliamentRoleLists');
  if (!container) {
    container = document.createElement('div');
    container.id = 'parliamentRoleLists';
    const firstRoleBlock = document.getElementById('titularList')?.closest('.col-12');
    firstRoleBlock?.parentElement.insertBefore(container, firstRoleBlock);
    document.getElementById('titularList')?.closest('.col-12')?.classList.add('d-none');
    document.getElementById('substituteList')?.closest('.col-12')?.classList.add('d-none');
  }
  container.innerHTML = parliamentRoles().map(role => `<section class="mb-4"><h4 class="h6">${escapeHtml(role.name)}</h4><div class="parliament-member-list" data-role-list="${role.id}"></div></section>`).join('');
  parliamentRoles().forEach(role => renderMemberList(mandate, role.id));
}

function renderMemberExtraFields(member = null) {
  document.getElementById('memberExtraFields').innerHTML = state.parliamentSettings.fields.map(field => `<div class="col-12 col-md-6"><label class="form-label" for="member-field-${field.id}">${escapeHtml(field.name)}</label><input id="member-field-${field.id}" class="form-control member-extra-field" data-field-id="${field.id}" required value="${escapeHtml(member?.extra?.[field.id] || '')}"></div>`).join('');
}

function closeParliamentEditor() {
  editingParliamentId = null;
  editingMemberId = null;
  document.getElementById('parliamentForm').reset();
  document.getElementById('memberForm').reset();
  setView('parliament');
}

function openParliamentEditor(parliamentId = '') {
  const mandate = state.parliaments.find(item => item.id === parliamentId);
  if (!mandate) return;
  editingParliamentId = mandate.id;
  document.getElementById('legislationNumber').value = mandate.legislation;
  document.getElementById('mandateStart').value = mandate.startDate;
  document.getElementById('mandateEnd').value = mandate.endDate;
  document.getElementById('mandateStatus').value = mandate.status;
  document.querySelector('#parliamentModal .modal-title').textContent = `Mandato ${mandate.legislation}`;
  renderParliamentMembers(mandate);
  showEditorScreen('parliamentModal');
}

function openNewParliament() {
  editingParliamentId = null;
  document.getElementById('parliamentForm').reset();
  document.getElementById('mandateStart').value = today();
  document.getElementById('mandateStatus').value = 'in corso';
  let roleLists = document.getElementById('parliamentRoleLists');
  if (!roleLists) {
    roleLists = document.createElement('div');
    roleLists.id = 'parliamentRoleLists';
    const firstRoleBlock = document.getElementById('titularList')?.closest('.col-12');
    firstRoleBlock?.parentElement.insertBefore(roleLists, firstRoleBlock);
    document.getElementById('titularList')?.closest('.col-12')?.classList.add('d-none');
    document.getElementById('substituteList')?.closest('.col-12')?.classList.add('d-none');
  }
  roleLists.innerHTML = '<p class="small text-secondary mb-0">Salva il mandato per inserire le nomine.</p>';
  document.querySelector('#parliamentModal .modal-title').textContent = 'Nuovo mandato';
  showEditorScreen('parliamentModal');
}

function saveParliament(event) {
  event.preventDefault();
  const legislation = document.getElementById('legislationNumber').value.trim();
  const startDate = document.getElementById('mandateStart').value;
  const endDate = document.getElementById('mandateEnd').value;
  if (!legislation || !startDate || !endDate || endDate < startDate) { showToast('Inserisci dati validi per il mandato.'); return; }
  const existing = state.parliaments.find(item => item.id === editingParliamentId);
  const record = { id: editingParliamentId || crypto.randomUUID(), legislation, startDate, endDate, status: document.getElementById('mandateStatus').value, members: existing?.members || [], createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (existing) state.parliaments[state.parliaments.indexOf(existing)] = record; else state.parliaments.unshift(record);
  writeStorage(STORAGE_KEYS.parliaments, state.parliaments);
  renderParliaments();
  showToast(existing ? 'Mandato aggiornato.' : 'Mandato salvato. Ora puoi inserire le nomine.');
  openParliamentEditor(record.id);
}

function openMemberEditor(memberId = '', role = 'titolare') {
  const mandate = state.parliaments.find(item => item.id === editingParliamentId);
  const member = mandate?.members.find(item => item.id === memberId);
  if (!mandate) return;
  editingMemberId = member?.id || null;
  document.getElementById('memberForm').reset();
  document.getElementById('memberRole').innerHTML = parliamentRoles().map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  document.getElementById('memberName').value = member?.name || '';
  document.getElementById('memberRole').value = member?.role || role;
  document.getElementById('oathDate').value = member?.oathDate || today();
  document.getElementById('resignationDate').value = member?.resignationDate || '';
  document.getElementById('memberParty').value = member?.memberParty || '';
  document.getElementById('memberCoalition').value = member?.memberCoalition || '';
  document.getElementById('memberAnnotations').value = member?.annotations || '';
  renderMemberExtraFields(member);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('memberModal')).show();
}

function saveMember(event) {
  event.preventDefault();
  const mandate = state.parliaments.find(item => item.id === editingParliamentId);
  if (!mandate) return;
  const role = document.getElementById('memberRole').value;
  const activeCount = mandate.members.filter(member => member.role === role && !member.resignationDate && member.id !== editingMemberId).length;
  const limit = parliamentRole(role)?.limit ?? 0;
  if (!editingMemberId && activeCount >= limit) { showToast(`Hai raggiunto il numero massimo di ${parliamentRoleLabel(role).toLowerCase()}.`); return; }
  const extra = Object.fromEntries([...document.querySelectorAll('.member-extra-field')].map(input => [input.dataset.fieldId, input.value.trim()]));
  if (Object.values(extra).some(value => !value)) { showToast('Compila tutte le informazioni configurate.'); return; }
  const existing = mandate.members.find(member => member.id === editingMemberId);
  const record = { id: editingMemberId || crypto.randomUUID(), name: document.getElementById('memberName').value.trim(), role, oathDate: document.getElementById('oathDate').value, resignationDate: document.getElementById('resignationDate').value, memberParty: document.getElementById('memberParty').value.trim(), memberCoalition: document.getElementById('memberCoalition').value.trim(), annotations: document.getElementById('memberAnnotations').value.trim(), extra, createdAt: existing?.createdAt || new Date().toISOString() };
  if (!record.name || !record.oathDate) { showToast('Inserisci nome e data di giuramento.'); return; }
  if (existing) mandate.members[mandate.members.indexOf(existing)] = record; else mandate.members.push(record);
  mandate.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parliaments, state.parliaments);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('memberModal')).hide();
  editingMemberId = null;
  renderParliamentMembers(mandate); renderParliaments();
}

function resignMember(memberId) {
  const mandate = state.parliaments.find(item => item.id === editingParliamentId);
  const member = mandate?.members.find(item => item.id === memberId);
  if (!mandate || !member || member.resignationDate || !confirm(`Registrare le dimissioni di ${member.name}?`)) return;
  member.resignationDate = today();
  mandate.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parliaments, state.parliaments);
  renderParliamentMembers(mandate); renderParliaments(); showToast('Dimissioni registrate nello storico.');
}

function refreshCategoryOptions() {
  const options = categoryNames().map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  document.getElementById('documentCategory').innerHTML = options;
  document.getElementById('templateCategory').innerHTML = options;
}

function refreshDocumentTemplateOptions(category = '') {
  const templates = state.templates.filter(template => !category || template.category === category);
  document.getElementById('documentTemplate').innerHTML = '<option value="">Documento libero</option>' + templates.map(template => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join('');
}

function renderSettings() {
  const categories = categoryNames();
  document.getElementById('numberingForm').innerHTML = categories.map(category => `<div class="row align-items-center g-2 mb-3"><div class="col"><label class="form-label mb-0" for="counter-${encodeURIComponent(category)}">${escapeHtml(category)}</label><div class="form-text">Formato: ${escapeHtml(category)} numero/anno</div></div><div class="col-auto"><input class="form-control counter-input" id="counter-${encodeURIComponent(category)}" data-category="${escapeHtml(category)}" type="text" inputmode="numeric" pattern="[0-9]+" value="${nextNumber(category)}"></div></div>`).join('') + '<button class="btn btn-primary mt-2" type="submit">Salva numerazione</button>';
  document.getElementById('categoryList').innerHTML = categories.map(category => `<span class="d-flex justify-content-between border-bottom pb-2"><span>${escapeHtml(category)}<small class="d-block text-secondary">${state.templates.filter(template => template.category === category).length} template</small></span><strong>${nextNumber(category)}</strong></span>`).join('');
  document.getElementById('partyFieldList').innerHTML = state.partyFields.length ? state.partyFields.map(field => `<div class="d-flex justify-content-between align-items-center border-bottom pb-2"><span>${escapeHtml(field.name)}<small class="d-block text-secondary">Obbligatorio nei nuovi partiti</small></span><button type="button" class="btn btn-sm btn-outline-danger" data-remove-party-field="${field.id}" title="Rimuovi campo">Rimuovi</button></div>`).join('') : '<p class="text-secondary small mb-0">Nessun campo configurato. Il nome, lo status e lo Statuto sono sempre disponibili.</p>';
  const parliamentSettingsForm = document.getElementById('parliamentSettingsForm');
  parliamentSettingsForm.innerHTML = `<div id="parliamentRoleSettings" class="col-12 vstack gap-2">${parliamentRoles().map(role => `<div class="row g-2 align-items-end parliament-role-setting" data-role-id="${role.id}"><div class="col"><label class="form-label">Nome ruolo</label><input class="form-control parliament-role-name" value="${escapeHtml(role.name)}" required></div><div class="col-auto"><label class="form-label">Numero</label><input class="form-control parliament-role-limit" type="number" min="0" value="${role.limit}" required></div><div class="col-auto"><button type="button" class="btn btn-outline-danger remove-parliament-role" data-role-id="${role.id}" ${parliamentRoles().length <= 1 ? 'disabled' : ''}>Rimuovi</button></div></div>`).join('')}</div><div class="col-12 d-flex gap-2"><button type="button" class="btn btn-outline-primary" id="addParliamentRole">+ Nuovo ruolo</button><button class="btn btn-primary" type="submit">Salva configurazione</button></div>`;
  document.getElementById('parliamentFieldList').innerHTML = state.parliamentSettings.fields.length ? state.parliamentSettings.fields.map(field => `<div class="d-flex justify-content-between align-items-center border-bottom pb-2"><span>${escapeHtml(field.name)}<small class="d-block text-secondary">Disponibile per ogni parlamentare</small></span><button type="button" class="btn btn-sm btn-outline-danger" data-remove-parliament-field="${field.id}">Rimuovi</button></div>`).join('') : '<p class="text-secondary small mb-0">Nessuna informazione aggiuntiva configurata.</p>';
}

function renderPartyFields(party = null) {
  const fields = document.getElementById('partyFields');
  fields.innerHTML = state.partyFields.map(field => `<div class="col-12 col-md-6"><label class="form-label" for="party-field-${field.id}">${escapeHtml(field.name)}</label><input id="party-field-${field.id}" class="form-control party-field-input" data-field-id="${field.id}" required value="${escapeHtml(party?.fields?.[field.id] || '')}"></div>`).join('');
}

function renderPartyHistory(party = null) {
  const panel = document.getElementById('partyHistoryPanel');
  const history = party?.history || [];
  panel.classList.toggle('d-none', !party || history.length === 0);
  document.getElementById('partyHistory').innerHTML = history.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => entry.label === 'Statuto' ? `<button type="button" class="history-entry history-version" data-open-statute-history="${party.id}" data-history-index="${index}"><strong>${escapeHtml(entry.label)}</strong><span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${formatDate(entry.at.slice(0, 10))}</span><span class="d-block small text-primary mt-1">Apri confronto versioni</span></button>` : `<div class="history-entry"><strong>${escapeHtml(entry.label)}</strong><span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${formatDate(entry.at.slice(0, 10))}</span></div>`).join('');
}

function renderCompanyHistory(company = null) {
  const panel = document.getElementById('companyHistoryPanel');
  const history = company?.history || [];
  panel.classList.toggle('d-none', !company || history.length === 0);
  document.getElementById('companyHistory').innerHTML = history.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => entry.label === 'Regolamento' ? `<button type="button" class="history-entry history-version" data-open-company-history="${company.id}" data-history-index="${index}"><strong>${escapeHtml(entry.label)}</strong><span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${formatDate(entry.at.slice(0, 10))}</span><span class="d-block small text-primary mt-1">Apri confronto versioni</span></button>` : `<div class="history-entry"><strong>${escapeHtml(entry.label)}</strong><span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${formatDate(entry.at.slice(0, 10))}</span></div>`).join('');
}

function diffStatuteText(previousText, nextText) {
  const previousTokens = (previousText || '').split(/(\s+)/).filter(Boolean);
  const nextTokens = (nextText || '').split(/(\s+)/).filter(Boolean);
  const matrix = Array.from({ length: previousTokens.length + 1 }, () => Array(nextTokens.length + 1).fill(0));
  for (let row = previousTokens.length - 1; row >= 0; row -= 1) for (let column = nextTokens.length - 1; column >= 0; column -= 1) matrix[row][column] = previousTokens[row] === nextTokens[column] ? matrix[row + 1][column + 1] + 1 : Math.max(matrix[row + 1][column], matrix[row][column + 1]);
  const previousOutput = [];
  const nextOutput = [];
  let row = 0;
  let column = 0;
  while (row < previousTokens.length && column < nextTokens.length) {
    if (previousTokens[row] === nextTokens[column]) { previousOutput.push(escapeHtml(previousTokens[row])); nextOutput.push(escapeHtml(nextTokens[column])); row += 1; column += 1; }
    else if (matrix[row + 1][column] >= matrix[row][column + 1]) { previousOutput.push(`<mark class="diff-removed">${escapeHtml(previousTokens[row])}</mark>`); row += 1; }
    else { nextOutput.push(`<mark class="diff-added">${escapeHtml(nextTokens[column])}</mark>`); column += 1; }
  }
  while (row < previousTokens.length) { previousOutput.push(`<mark class="diff-removed">${escapeHtml(previousTokens[row])}</mark>`); row += 1; }
  while (column < nextTokens.length) { nextOutput.push(`<mark class="diff-added">${escapeHtml(nextTokens[column])}</mark>`); column += 1; }
  return { previous: previousOutput.join('') || '<span class="text-secondary">Nessun contenuto</span>', next: nextOutput.join('') || '<span class="text-secondary">Nessun contenuto</span>' };
}

function openStatuteHistory(partyId, historyIndex) {
  const party = state.parties.find(item => item.id === partyId);
  const entry = party?.history?.[Number(historyIndex)];
  if (!party || !entry) return;
  const hasStoredVersions = entry.previousStatute !== undefined && entry.nextStatute !== undefined;
  const diff = hasStoredVersions ? diffStatuteText(plainText(entry.previousStatute), plainText(entry.nextStatute)) : { previous: '<span class="text-secondary">Versione precedente non disponibile: questa modifica è stata registrata prima dell’archiviazione delle versioni.</span>', next: escapeHtml(plainText(party.statute || '')) || '<span class="text-secondary">Nessun contenuto</span>' };
  document.getElementById('statuteHistoryTitle').textContent = `${party.name} · Statuto`;
  document.getElementById('statuteHistoryDate').textContent = `Versione salvata il ${formatDate(entry.at.slice(0, 10))}`;
  document.getElementById('statutePreviousVersion').innerHTML = diff.previous;
  document.getElementById('statuteNextVersion').innerHTML = diff.next;
  const showComparison = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('statuteHistoryModal')).show();
  const partyModal = document.getElementById('partyModal');
  if (partyModal.classList.contains('show')) {
    partyModal.addEventListener('hidden.bs.modal', showComparison, { once: true });
    bootstrap.Modal.getOrCreateInstance(partyModal).hide();
  } else showComparison();
}

function openPartyEditor(partyId = '') {
  const party = state.parties.find(item => item.id === partyId);
  editingPartyId = party?.id || null;
  document.getElementById('partyForm').reset();
  document.getElementById('partyName').value = party?.name || '';
  document.getElementById('partyStatus').value = party?.status || 'attivo';
  renderPartyFields(party);
  renderPartyHistory(party);
  document.querySelector('#partyModal .modal-title').textContent = party ? 'Modifica partito' : 'Nuovo partito';
  document.querySelector('#partyModal button[type="submit"]').textContent = party ? 'Salva modifiche' : 'Salva partito';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('partyModal')).show();
}

function openPartyStatuteEditor(partyId) {
  const party = state.parties.find(item => item.id === partyId);
  if (!party) return;
  editingPartyId = party.id;
  document.getElementById('partyStatuteEditorContent').innerHTML = party.statute || '';
  document.getElementById('partyStatutePartyName').textContent = party.name;
  document.getElementById('partyStatuteSubtitle').textContent = `${statusLabel(party.status)} · documento unico del partito`;
  const status = document.getElementById('partyStatuteStatus');
  status.textContent = statusLabel(party.status);
  status.className = `badge ${statusClass(party.status)}`;
  showEditorScreen('partyStatuteEditor');
}

function openCompanyEditor(companyId = '') {
  const company = state.companies.find(item => item.id === companyId);
  editingCompanyId = company?.id || null;
  document.getElementById('companyForm').reset();
  document.getElementById('companyName').value = company?.name || '';
  renderCompanyHistory(company);
  document.querySelector('#companyModal .modal-title').textContent = company ? 'Modifica azienda' : 'Nuova azienda';
  document.querySelector('#companyModal button[type="submit"]').textContent = company ? 'Salva modifiche' : 'Salva azienda';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('companyModal')).show();
}

function openCompanyRegulationEditor(companyId) {
  const company = state.companies.find(item => item.id === companyId);
  if (!company) return;
  editingCompanyId = company.id;
  document.getElementById('companyRegulationEditorContent').innerHTML = company.regulation || '';
  document.getElementById('companyRegulationCompanyName').textContent = company.name;
  document.getElementById('companyRegulationSubtitle').textContent = 'Documento unico dell’azienda';
  showEditorScreen('companyRegulationEditor');
}

function closeCompanyRegulationEditor() {
  editingCompanyId = null;
  document.getElementById('companyRegulationEditorContent').innerHTML = '';
  setView('companies');
}

function saveCompanyRegulation(event) {
  event.preventDefault();
  const company = state.companies.find(item => item.id === editingCompanyId);
  if (!company) return;
  syncEditorValue('companyRegulationEditorContent', 'companyRegulationValue');
  const regulation = document.getElementById('companyRegulationValue').value.trim();
  if (!plainText(regulation).trim()) { showToast('Inserisci il contenuto del Regolamento.'); return; }
  if (company.regulation !== regulation) company.history.push({ label: 'Regolamento', from: company.regulation ? 'Versione precedente' : 'Non presente', to: 'Versione aggiornata', at: new Date().toISOString(), previousStatute: company.regulation || '', nextStatute: regulation });
  company.regulation = regulation;
  company.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.companies, state.companies);
  closeCompanyRegulationEditor();
  renderCompanies();
  showToast('Regolamento salvato.');
}

function openCompanyHistory(companyId, historyIndex) {
  const company = state.companies.find(item => item.id === companyId);
  const entry = company?.history?.[Number(historyIndex)];
  if (!company || !entry) return;
  const hasStoredVersions = entry.previousStatute !== undefined && entry.nextStatute !== undefined;
  const diff = hasStoredVersions ? diffStatuteText(plainText(entry.previousStatute), plainText(entry.nextStatute)) : { previous: '<span class="text-secondary">Versione precedente non disponibile.</span>', next: escapeHtml(plainText(company.regulation || '')) || '<span class="text-secondary">Nessun contenuto</span>' };
  document.getElementById('statuteHistoryTitle').textContent = `${company.name} · Regolamento`;
  document.getElementById('statuteHistoryDate').textContent = `Versione salvata il ${formatDate(entry.at.slice(0, 10))}`;
  document.getElementById('statutePreviousVersion').innerHTML = diff.previous;
  document.getElementById('statuteNextVersion').innerHTML = diff.next;
  const showComparison = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('statuteHistoryModal')).show();
  const companyModal = document.getElementById('companyModal');
  if (companyModal.classList.contains('show')) {
    companyModal.addEventListener('hidden.bs.modal', showComparison, { once: true });
    bootstrap.Modal.getOrCreateInstance(companyModal).hide();
  } else showComparison();
}

function saveCompany(event) {
  event.preventDefault();
  const name = document.getElementById('companyName').value.trim();
  if (!name) { showToast('Inserisci il nome dell’azienda.'); return; }
  const existingCompany = state.companies.find(item => item.id === editingCompanyId);
  const history = existingCompany?.history ? [...existingCompany.history] : [];
  if (existingCompany && existingCompany.name !== name) history.push({ label: 'Nome', from: existingCompany.name, to: name, at: new Date().toISOString() });
  const record = { id: editingCompanyId || crypto.randomUUID(), name, regulation: existingCompany?.regulation || '', history, createdAt: existingCompany?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (existingCompany) state.companies[state.companies.indexOf(existingCompany)] = record;
  else state.companies.unshift(record);
  writeStorage(STORAGE_KEYS.companies, state.companies);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('companyModal')).hide();
  editingCompanyId = null;
  renderCompanies();
  if (!existingCompany) openCompanyRegulationEditor(record.id);
  else showToast('Azienda aggiornata.');
}

function closePartyStatuteEditor() {
  editingPartyId = null;
  document.getElementById('partyStatuteEditorContent').innerHTML = '';
  setView('parties');
}

function savePartyStatute(event) {
  event.preventDefault();
  const party = state.parties.find(item => item.id === editingPartyId);
  if (!party) return;
  syncEditorValue('partyStatuteEditorContent', 'partyStatuteValue');
  const statute = document.getElementById('partyStatuteValue').value.trim();
  if (!plainText(statute).trim()) { showToast('Inserisci il contenuto dello Statuto.'); return; }
  if (party.statute !== statute) party.history.push({ label: 'Statuto', from: party.statute ? 'Versione precedente' : 'Non presente', to: 'Versione aggiornata', at: new Date().toISOString(), previousStatute: party.statute || '', nextStatute: statute });
  party.statute = statute;
  party.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parties, state.parties);
  closePartyStatuteEditor();
  renderParties();
  showToast('Statuto salvato.');
}

function saveParty(event) {
  event.preventDefault();
  const name = document.getElementById('partyName').value.trim();
  if (!name) { showToast('Inserisci il nome del partito.'); return; }
  const fields = Object.fromEntries([...document.querySelectorAll('.party-field-input')].map(input => [input.dataset.fieldId, input.value.trim()]));
  if (Object.values(fields).some(value => !value)) { showToast('Compila tutte le informazioni minime configurate.'); return; }
  const status = document.getElementById('partyStatus').value;
  const existingParty = state.parties.find(item => item.id === editingPartyId);
  const history = existingParty?.history ? [...existingParty.history] : [];
  if (existingParty) {
    state.partyFields.forEach(field => { const from = existingParty.fields?.[field.id] || ''; const to = fields[field.id] || ''; if (from !== to) history.push({ label: field.name, from, to, at: new Date().toISOString() }); });
    if (existingParty.status !== status) history.push({ label: 'Status', from: statusLabel(existingParty.status), to: statusLabel(status), at: new Date().toISOString() });
  }
  const record = { id: editingPartyId || crypto.randomUUID(), name, status, fields, statute: existingParty?.statute || '', history, createdAt: existingParty?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (existingParty) state.parties[state.parties.indexOf(existingParty)] = record;
  else state.parties.unshift(record);
  writeStorage(STORAGE_KEYS.parties, state.parties);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('partyModal')).hide();
  editingPartyId = null;
  renderParties();
  if (!existingParty) openPartyStatuteEditor(record.id);
  else showToast('Partito aggiornato.');
}

function openDocumentModal(templateId = '', forcedCategory = '') {
  editingDocumentId = null;
  const template = state.templates.find(item => item.id === templateId);
  document.getElementById('documentForm').reset();
  refreshCategoryOptions();
  document.getElementById('documentCategory').value = forcedCategory || template?.category || categoryNames()[0];
  refreshDocumentTemplateOptions(document.getElementById('documentCategory').value);
  document.getElementById('documentDate').value = today();
  document.getElementById('documentTemplate').value = templateId;
  document.getElementById('documentNumber').value = nextNumber(template?.category || document.getElementById('documentCategory').value);
  document.getElementById('odgStatus').value = 'da valutare';
  syncOdgStatusField();
  document.getElementById('documentBodyEditor').innerHTML = sanitizeRichHtml(template?.body || '');
  syncEditorValue('documentBodyEditor', 'documentBody');
  document.querySelector('#documentModal .modal-title').textContent = 'Nuovo documento';
  document.querySelector('#documentModal button[type="submit"]').textContent = 'Salva documento';
  showEditorScreen('documentModal');
}

function openDocumentEditor(documentId) {
  const documentRecord = state.documents.find(item => item.id === documentId);
  if (!documentRecord) return;
  editingDocumentId = documentId;
  document.getElementById('documentForm').reset();
  refreshCategoryOptions();
  document.getElementById('documentCategory').value = documentRecord.category;
  refreshDocumentTemplateOptions(documentRecord.category);
  document.getElementById('documentTemplate').value = state.templates.find(template => template.name === documentRecord.templateName && template.category === documentRecord.category)?.id || '';
  document.getElementById('documentTitle').value = documentRecord.title;
  document.getElementById('documentDate').value = documentRecord.date;
  document.getElementById('documentNumber').value = documentRecord.number;
  document.getElementById('odgStatus').value = documentRecord.status || 'da valutare';
  syncOdgStatusField();
  document.getElementById('documentBodyEditor').innerHTML = sanitizeRichHtml(documentRecord.body);
  syncEditorValue('documentBodyEditor', 'documentBody');
  document.querySelector('#documentModal .modal-title').textContent = 'Modifica documento';
  document.querySelector('#documentModal button[type="submit"]').textContent = 'Salva modifiche';
  showEditorScreen('documentModal');
}

async function saveDocument(event) {
  event.preventDefault();
  syncEditorValue('documentBodyEditor', 'documentBody');
  if (!plainText(document.getElementById('documentBody').value).trim()) { showToast('Inserisci il contenuto del documento.'); return; }
  const category = document.getElementById('documentCategory').value.trim();
  const template = state.templates.find(item => item.id === document.getElementById('documentTemplate').value);
  const uploadedImage = await readFileAsDataUrl(document.getElementById('documentImage').files[0]);
  const date = document.getElementById('documentDate').value;
  const number = document.getElementById('documentNumber').value.trim();
  if (!/^\d+$/.test(number) || numericValue(number) < 1) { showToast('Il numero deve contenere solo cifre.'); return; }
  const existingDocument = state.documents.find(item => item.id === editingDocumentId);
  const documentRecord = { id: editingDocumentId || crypto.randomUUID(), title: document.getElementById('documentTitle').value.trim(), category, number, year: date.slice(0, 4), date, body: document.getElementById('documentBody').value.trim(), image: uploadedImage || template?.image || existingDocument?.image || '', templateName: template?.name || '', status: category === 'ODG' ? document.getElementById('odgStatus').value : '', createdAt: existingDocument?.createdAt || new Date().toISOString() };
  if (existingDocument) state.documents[state.documents.indexOf(existingDocument)] = documentRecord;
  else state.documents.unshift(documentRecord);
  advanceCounter(category, number);
  writeStorage(STORAGE_KEYS.documents, state.documents); writeStorage(STORAGE_KEYS.counters, state.counters);
  editingDocumentId = null;
  closeEditorScreen();
  renderDocuments();
  if (category === 'ODG') renderOdg();
  showToast('Documento salvato nell’archivio.');
}

async function saveTemplate(event) {
  event.preventDefault();
  syncEditorValue('templateBodyEditor', 'templateBody');
  if (!plainText(document.getElementById('templateBody').value).trim()) { showToast('Inserisci la struttura del template.'); return; }
  const existingTemplate = state.templates.find(item => item.id === editingTemplateId);
  const uploadedImage = await readFileAsDataUrl(document.getElementById('templateImage').files[0]);
  const category = document.getElementById('templateCategory').value.trim();
  const template = { id: editingTemplateId || crypto.randomUUID(), name: document.getElementById('templateName').value.trim(), category, body: document.getElementById('templateBody').value.trim(), image: uploadedImage || existingTemplate?.image || '' };
  if (existingTemplate) state.templates[state.templates.indexOf(existingTemplate)] = template;
  else state.templates.push(template);
  writeStorage(STORAGE_KEYS.templates, state.templates);
  editingTemplateId = null;
  closeEditorScreen();
  document.getElementById('templateForm').reset(); refreshCategoryOptions(); refreshDocumentTemplateOptions(); renderTemplates(); renderDocuments(); showToast(existingTemplate ? 'Template aggiornato.' : 'Template salvato.');
}

function openTemplateEditor(templateId = '') {
  const template = state.templates.find(item => item.id === templateId);
  editingTemplateId = template?.id || null;
  document.getElementById('templateForm').reset();
  refreshCategoryOptions();
  document.getElementById('templateName').value = template?.name || '';
  document.getElementById('templateCategory').value = template?.category || categoryNames()[0];
  document.getElementById('templateBodyEditor').innerHTML = template?.body || '';
  document.querySelector('#templateModal .modal-title').textContent = template ? 'Modifica template' : 'Nuovo template';
  document.querySelector('#templateModal button[type="submit"]').textContent = template ? 'Salva modifiche' : 'Salva template';
  showEditorScreen('templateModal');
}

function printDocument(id) {
  const documentRecord = state.documents.find(item => item.id === id); if (!documentRecord) return;
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`<html lang="it"><head><title>${escapeHtml(documentRecord.title)}</title><style>body{font-family:Georgia,serif;max-width:760px;margin:60px auto;color:#17202a}h1{font-size:28px} .meta{font-family:Arial,sans-serif;color:#68727d;border-bottom:1px solid #ddd;padding-bottom:16px;margin-bottom:32px} .body{line-height:1.7} img{max-width:100%;max-height:220px;display:block;margin:20px 0}</style></head><body><div class="meta">Corte Costituzionale di Zero<br>${escapeHtml(documentCode(documentRecord))}</div><h1>${escapeHtml(documentRecord.title)}</h1>${documentRecord.image ? `<img src="${escapeHtml(documentRecord.image)}" alt="">` : ''}<div class="body">${sanitizeRichHtml(documentRecord.body)}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
  printWindow.document.close();
}

async function downloadDocumentPdf(id) {
  const documentRecord = state.documents.find(item => item.id === id);
  if (!documentRecord || !can('documents_pdf', 'download')) { showToast('Non hai il permesso di scaricare PDF.'); return; }
  if (typeof window.html2pdf !== 'function') { showToast('La libreria PDF non è disponibile. Usa PDF / stampa.'); return; }
  const container = document.createElement('article');
  container.style.cssText = 'width: 180mm; padding: 16mm; background: #fff; color: #17202a; font-family: Georgia, serif; line-height: 1.6;';
  container.innerHTML = `<div style="font-family: Arial, sans-serif; color: #68727d; border-bottom: 1px solid #ddd; padding-bottom: 12px; margin-bottom: 24px;">Corte Costituzionale di Zero<br>${escapeHtml(documentCode(documentRecord))}</div><h1>${escapeHtml(documentRecord.title)}</h1>${documentRecord.image ? `<img src="${escapeHtml(documentRecord.image)}" style="max-width: 100%; max-height: 220px; display: block; margin: 20px 0;" alt="">` : ''}<div>${sanitizeRichHtml(documentRecord.body)}</div>`;
  document.body.appendChild(container);
  try { await window.html2pdf().set({ margin: 0, filename: `${documentRecord.category}-${documentRecord.number}-${documentRecord.year}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(container).save(); showToast('PDF scaricato.'); } catch (error) { showToast('Impossibile generare il PDF.'); console.error(error); } finally { container.remove(); }
}

function seedTestMandate() {
  if (state.parliaments.length) return;
  const testMandate = {
    id: crypto.randomUUID(),
    legislation: 'XVIII',
    startDate: '2026-01-01',
    endDate: '2030-12-31',
    status: 'in corso',
    members: [
      { id: crypto.randomUUID(), name: 'Mario Rossi', role: 'titolare', oathDate: '2026-01-15', resignationDate: '', memberParty: 'Partito della Costituzione', memberCoalition: 'Centro-sinistra', annotations: 'Da monitorare per la commissione bilancio.', extra: {} },
      { id: crypto.randomUUID(), name: 'Giulia Bianchi', role: 'sostituto', oathDate: '2026-01-16', resignationDate: '', memberParty: 'Partito della Costituzione', memberCoalition: 'Centro-sinistra', annotations: 'Supporto alla delegazione europea.', extra: {} }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.parliaments.push(testMandate);
  writeStorage(STORAGE_KEYS.parliaments, state.parliaments);
}

async function initialize() {
  await loadRemoteState();
  ensureAuthModals();
  ensureCredentialModal();
  ensureOdgCategory();
  ensureDemoOdg();
  ensureInstitutionViews();
  ensureInterpretationView();
  ensureOdgView();
  bindInstitutionEvents();
  seedTestMandate();
  document.getElementById('loginForm').addEventListener('submit', async event => { event.preventDefault(); const username = document.getElementById('username').value.trim().toLowerCase(); const password = document.getElementById('password').value; const alert = document.getElementById('loginAlert'); alert.classList.add('d-none'); try { await loginRemote(username, password); await requireFirstAccessCredentials(); localStorage.setItem(STORAGE_KEYS.session, 'active'); document.getElementById('loginView').classList.add('d-none'); document.getElementById('appView').classList.remove('d-none'); setView('dashboard'); } catch (error) { const backendUnavailable = error.message === 'BACKEND_UNAVAILABLE'; const localUser = localAuth.users.find(user => user.username === username && user.password === password && !user.deletedAt); if (!backendUnavailable || !localUser) { alert.textContent = backendUnavailable ? 'Il server non è configurato oppure le credenziali locali non sono valide.' : (error.message || 'Credenziali non valide. Riprova.'); alert.classList.remove('d-none'); return; } currentUser = localUserPayload(localUser); ensureDemoOdg(); await requireFirstAccessCredentials(localUser); localStorage.setItem('cz_local_user', localUser.id); localStorage.setItem(STORAGE_KEYS.session, 'active'); document.getElementById('loginView').classList.add('d-none'); document.getElementById('appView').classList.remove('d-none'); setView('dashboard'); } });
  document.getElementById('logoutButton').addEventListener('click', async () => { if (remoteMode) { try { clearTimeout(remoteSaveTimer); await saveRemoteState(); await apiRequest('logout', { method: 'POST', body: '{}' }); } catch { /* fallback locale */ } } localStorage.removeItem(STORAGE_KEYS.session); localStorage.removeItem('cz_local_user'); location.reload(); });
  document.getElementById('requestRegistrationButton').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(document.getElementById('registrationRequestModal')).show());
  document.getElementById('requestRecoveryButton').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(document.getElementById('recoveryRequestModal')).show());
  document.getElementById('registrationRequestForm').addEventListener('submit', submitRegistrationRequest);
  document.getElementById('recoveryRequestForm').addEventListener('submit', submitRecoveryRequest);
  document.getElementById('credentialChangeForm').addEventListener('submit', saveFirstAccessCredentials);
  document.getElementById('refreshUsersButton')?.addEventListener('click', refreshUserManagement);
  document.addEventListener('change', event => { const roleSelect = event.target.closest('.user-role-select'); if (roleSelect) userManagementAction('change_user_role', { userId: roleSelect.dataset.userId, roleId: roleSelect.value }, 'Ruolo aggiornato.'); });
  document.addEventListener('click', event => { const createRoleButton = event.target.closest('#createRoleButton'); if (createRoleButton) userManagementAction('create_role', { name: document.getElementById('newRoleName').value }, 'Ruolo creato.'); const savePermissionsButton = event.target.closest('.save-role-permissions'); if (savePermissionsButton) { const permissions = {}; document.querySelectorAll(`.role-permission[data-role-id="${savePermissionsButton.dataset.roleId}"]`).forEach(input => { permissions[input.dataset.permission] ||= {}; permissions[input.dataset.permission][input.dataset.action] = input.checked; }); userManagementAction('save_role_permissions', { roleId: savePermissionsButton.dataset.roleId, permissions }, 'Permessi salvati.'); } });
  document.addEventListener('click', event => { const deleteButton = event.target.closest('.delete-user-button'); if (deleteButton && confirm('Eliminare definitivamente l’accesso di questo utente?')) userManagementAction('delete_user', { userId: deleteButton.dataset.userId }, 'Utente eliminato.'); const approveRegistration = event.target.closest('.approve-registration-button'); if (approveRegistration) { const roleId = document.querySelector(`.registration-role[data-request-id="${approveRegistration.dataset.requestId}"]`).value; userManagementAction('approve_registration', { requestId: approveRegistration.dataset.requestId, roleId }, 'Registrazione autorizzata.'); } const rejectRegistration = event.target.closest('.reject-registration-button'); if (rejectRegistration) userManagementAction('reject_registration', { requestId: rejectRegistration.dataset.requestId }, 'Richiesta rifiutata.'); const approveReset = event.target.closest('.approve-reset-button'); if (approveReset) { const passwordInput = document.querySelector(`.reset-password[data-request-id="${approveReset.dataset.requestId}"]`); userManagementAction('approve_password_reset', { requestId: approveReset.dataset.requestId, newPassword: passwordInput.value }, 'Password aggiornata.'); } });
  document.querySelectorAll('[data-view-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); setView(link.dataset.viewLink); }));
  document.getElementById('newOdgButton').addEventListener('click', () => openDocumentModal('', 'ODG'));
  document.getElementById('interpretationForm').addEventListener('submit', saveInterpretation);
  document.getElementById('newInterpretationButton').addEventListener('click', () => openInterpretationEditor());
  document.getElementById('closeInterpretationEditor').addEventListener('click', () => { document.getElementById('interpretationEditor').classList.add('d-none'); setView('interpretations'); });
  document.getElementById('cancelInterpretationEditor').addEventListener('click', () => { document.getElementById('interpretationEditor').classList.add('d-none'); setView('interpretations'); });
  document.getElementById('interpretationFieldForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('interpretationFieldName').value.trim(); if (!name) return; if (state.interpretationSettings.fields.some(field => field.name.toLowerCase() === name.toLowerCase())) { showToast('Questo valore base esiste già.'); return; } state.interpretationSettings.fields.push({ id: crypto.randomUUID(), name }); writeStorage(STORAGE_KEYS.interpretationSettings, state.interpretationSettings); document.getElementById('interpretationFieldForm').reset(); renderInterpretationSettings(); showToast('Valore base aggiunto.'); });
  document.getElementById('interpretationFieldList').addEventListener('click', event => { const button = event.target.closest('[data-remove-interpretation-field]'); if (!button) return; state.interpretationSettings.fields = state.interpretationSettings.fields.filter(field => field.id !== button.dataset.removeInterpretationField); writeStorage(STORAGE_KEYS.interpretationSettings, state.interpretationSettings); renderInterpretationSettings(); showToast('Valore base rimosso.'); });
  document.addEventListener('click', event => { const button = event.target.closest('[data-open-interpretation]'); if (button) { event.stopPropagation(); openInterpretationEditor(button.dataset.openInterpretation); } });
  document.getElementById('documentSearch').addEventListener('input', renderDocuments);
  document.getElementById('documentForm').addEventListener('submit', saveDocument);
  document.getElementById('templateForm').addEventListener('submit', saveTemplate);
  document.getElementById('partyForm').addEventListener('submit', saveParty);
  document.getElementById('companyForm').addEventListener('submit', saveCompany);
  document.getElementById('parliamentForm').addEventListener('submit', saveParliament);
  document.getElementById('memberForm').addEventListener('submit', saveMember);
  document.getElementById('partyStatuteForm').addEventListener('submit', savePartyStatute);
  document.getElementById('companyRegulationForm').addEventListener('submit', saveCompanyRegulation);
  document.getElementById('closePartyStatuteEditor').addEventListener('click', closePartyStatuteEditor);
  document.getElementById('cancelPartyStatuteEditor').addEventListener('click', closePartyStatuteEditor);
  document.getElementById('newPartyButton').addEventListener('click', () => openPartyEditor());
  document.getElementById('newCompanyButton').addEventListener('click', () => openCompanyEditor());
  document.getElementById('newParliamentButton').addEventListener('click', openNewParliament);
  document.getElementById('addMemberButton').addEventListener('click', () => openMemberEditor());
  document.getElementById('closeCompanyRegulationEditor').addEventListener('click', closeCompanyRegulationEditor);
  document.getElementById('cancelCompanyRegulationEditor').addEventListener('click', closeCompanyRegulationEditor);
  document.getElementById('categoryForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('categoryName').value.trim(); if (!name) return; if (categoryNames().some(category => category.toLowerCase() === name.toLowerCase())) { showToast('Questa categoria esiste già.'); return; } state.categories.push({ name }); state.counters[name] = 1; writeStorage(STORAGE_KEYS.categories, state.categories); writeStorage(STORAGE_KEYS.counters, state.counters); document.getElementById('categoryForm').reset(); refreshCategoryOptions(); renderSettings(); showToast('Categoria creata.'); });
  document.getElementById('numberingForm').addEventListener('submit', event => { event.preventDefault(); const inputs = [...document.querySelectorAll('.counter-input')]; if (inputs.some(input => !/^\d+$/.test(input.value.trim()) || numericValue(input.value) < 1)) { showToast('Inserisci solo numeri positivi, ad esempio 01 o 00001.'); return; } inputs.forEach(input => { state.counters[input.dataset.category] = input.value.trim(); }); writeStorage(STORAGE_KEYS.counters, state.counters); renderSettings(); showToast('Numerazione aggiornata.'); });
  document.getElementById('partyFieldForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('partyFieldName').value.trim(); if (!name) return; if (state.partyFields.some(field => field.name.toLowerCase() === name.toLowerCase())) { showToast('Questo campo esiste già.'); return; } state.partyFields.push({ id: crypto.randomUUID(), name }); writeStorage(STORAGE_KEYS.partyFields, state.partyFields); document.getElementById('partyFieldForm').reset(); renderSettings(); renderParties(); showToast('Informazione minima aggiunta.'); });
  document.getElementById('partyFieldList').addEventListener('click', event => { const button = event.target.closest('[data-remove-party-field]'); if (!button) return; const fieldId = button.dataset.removePartyField; state.partyFields = state.partyFields.filter(field => field.id !== fieldId); writeStorage(STORAGE_KEYS.partyFields, state.partyFields); renderSettings(); renderParties(); showToast('Informazione minima rimossa.'); });
  document.getElementById('parliamentSettingsForm').addEventListener('submit', event => { event.preventDefault(); const roles = [...document.querySelectorAll('.parliament-role-setting')].map(row => ({ id: row.dataset.roleId, name: row.querySelector('.parliament-role-name').value.trim(), limit: Math.max(0, Number.parseInt(row.querySelector('.parliament-role-limit').value, 10) || 0) })).filter(role => role.name); if (!roles.length || new Set(roles.map(role => role.name.toLowerCase())).size !== roles.length) { showToast('Inserisci nomi di ruolo univoci.'); return; } state.parliamentSettings.roles = roles; writeStorage(STORAGE_KEYS.parliamentSettings, state.parliamentSettings); renderSettings(); renderParliaments(); showToast('Configurazione Parlamento salvata.'); });
  document.getElementById('parliamentSettingsForm').addEventListener('click', event => { const addButton = event.target.closest('#addParliamentRole'); if (addButton) { const roleId = crypto.randomUUID(); document.getElementById('parliamentRoleSettings').insertAdjacentHTML('beforeend', `<div class="row g-2 align-items-end parliament-role-setting" data-role-id="${roleId}"><div class="col"><label class="form-label">Nome ruolo</label><input class="form-control parliament-role-name" value="" placeholder="Es. Presidente" required></div><div class="col-auto"><label class="form-label">Numero</label><input class="form-control parliament-role-limit" type="number" min="0" value="1" required></div><div class="col-auto"><button type="button" class="btn btn-outline-danger remove-parliament-role" data-role-id="${roleId}">Rimuovi</button></div></div>`); document.querySelector('#parliamentRoleSettings .parliament-role-setting:last-child .parliament-role-name')?.focus(); return; } const removeButton = event.target.closest('.remove-parliament-role'); if (!removeButton) return; const rows = document.querySelectorAll('.parliament-role-setting'); if (rows.length <= 1) return; const hasMembers = state.parliaments.some(mandate => mandate.members.some(member => member.role === removeButton.dataset.roleId)); if (hasMembers) { showToast('Non puoi rimuovere un ruolo già usato nello storico.'); return; } removeButton.closest('.parliament-role-setting').remove(); });
  document.getElementById('parliamentFieldForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('parliamentFieldName').value.trim(); if (!name) return; if (state.parliamentSettings.fields.some(field => field.name.toLowerCase() === name.toLowerCase())) { showToast('Questo campo esiste già.'); return; } state.parliamentSettings.fields.push({ id: crypto.randomUUID(), name }); writeStorage(STORAGE_KEYS.parliamentSettings, state.parliamentSettings); document.getElementById('parliamentFieldForm').reset(); renderSettings(); showToast('Informazione parlamentare aggiunta.'); });
  document.getElementById('parliamentFieldList').addEventListener('click', event => { const button = event.target.closest('[data-remove-parliament-field]'); if (!button) return; state.parliamentSettings.fields = state.parliamentSettings.fields.filter(field => field.id !== button.dataset.removeParliamentField); writeStorage(STORAGE_KEYS.parliamentSettings, state.parliamentSettings); renderSettings(); showToast('Informazione parlamentare rimossa.'); });
  const newTemplateButton = document.querySelector('[data-bs-target="#templateModal"], #newTemplateButton');
  document.querySelectorAll('[data-bs-target="#documentModal"], [data-bs-target="#templateModal"]').forEach(button => { button.removeAttribute('data-bs-toggle'); button.removeAttribute('data-bs-target'); });
  document.getElementById('newDocumentButton').addEventListener('click', () => openDocumentModal());
  newTemplateButton?.addEventListener('click', () => openTemplateEditor());
  document.getElementById('documentTemplate').addEventListener('change', event => openDocumentModal(event.target.value));
  document.getElementById('documentCategory').addEventListener('change', event => { refreshDocumentTemplateOptions(event.target.value); document.getElementById('documentNumber').value = nextNumber(event.target.value); syncOdgStatusField(); });
  document.querySelectorAll('#documentModal [data-bs-dismiss="modal"], #templateModal [data-bs-dismiss="modal"]').forEach(button => { button.removeAttribute('data-bs-dismiss'); button.addEventListener('click', closeEditorScreen); });
  enhanceEditorToolbars();
  document.querySelectorAll('.rich-editor').forEach(editor => { editor.addEventListener('keyup', () => saveEditorSelection(editor)); editor.addEventListener('mouseup', () => saveEditorSelection(editor)); editor.addEventListener('focus', () => saveEditorSelection(editor)); });
  document.querySelectorAll('[data-editor-command]').forEach(control => {
    control.addEventListener('mousedown', event => { if (control.tagName !== 'SELECT' && control.type !== 'color') event.preventDefault(); });
    const applyCommand = () => {
      const command = control.dataset.editorCommand;
      if (command === 'fontSizePx') return applyPixelFontSize(control);
      if (command === 'insertTable') return insertTable(editorFromControl(control));
      if (command === 'insertImage') return insertImage(editorFromControl(control));
      if (command === 'createLink') { const url = prompt('Incolla l’indirizzo del collegamento'); if (url) executeEditorCommand(control, url); return; }
      executeEditorCommand(control, control.type === 'color' ? control.value : control.value || null);
    };
    control.addEventListener(control.tagName === 'SELECT' || control.type === 'color' || control.dataset.editorCommand === 'fontSizePx' ? 'change' : 'click', applyCommand);
  });
  document.addEventListener('click', event => { const editTemplateButton = event.target.closest('[data-edit-template]'); if (editTemplateButton) { event.stopPropagation(); openTemplateEditor(editTemplateButton.dataset.editTemplate); return; } const deleteTemplateButton = event.target.closest('[data-delete-template]'); if (deleteTemplateButton) { event.stopPropagation(); deleteTemplate(deleteTemplateButton.dataset.deleteTemplate); return; } const downloadButton = event.target.closest('[data-download-pdf]'); if (downloadButton) { event.stopPropagation(); downloadDocumentPdf(downloadButton.dataset.downloadPdf); return; } const printButton = event.target.closest('[data-print-document]'); if (printButton) { event.stopPropagation(); printDocument(printButton.dataset.printDocument); return; } const useButton = event.target.closest('[data-use-template]'); if (useButton) { openDocumentModal(useButton.dataset.useTemplate); return; } const companyHistoryEntry = event.target.closest('[data-open-company-history]'); if (companyHistoryEntry) { event.stopPropagation(); openCompanyHistory(companyHistoryEntry.dataset.openCompanyHistory, companyHistoryEntry.dataset.historyIndex); return; } const historyEntry = event.target.closest('[data-open-statute-history]'); if (historyEntry) { event.stopPropagation(); openStatuteHistory(historyEntry.dataset.openStatuteHistory, historyEntry.dataset.historyIndex); return; } const companyRegulationButton = event.target.closest('[data-open-company-regulation]'); if (companyRegulationButton) { event.stopPropagation(); openCompanyRegulationEditor(companyRegulationButton.dataset.openCompanyRegulation); return; } const companyCard = event.target.closest('[data-open-company]'); if (companyCard) { openCompanyEditor(companyCard.dataset.openCompany); return; } const parliamentAction = event.target.closest('[data-open-parliament-action]'); if (parliamentAction) { event.stopPropagation(); openParliamentEditor(parliamentAction.dataset.openParliamentAction); return; } const parliamentCard = event.target.closest('[data-open-parliament]'); if (parliamentCard) { openParliamentEditor(parliamentCard.dataset.openParliament); return; } const resignButton = event.target.closest('[data-resign-member]'); if (resignButton) { event.stopPropagation(); resignMember(resignButton.dataset.resignMember); return; } const editMemberButton = event.target.closest('[data-edit-member]'); if (editMemberButton) { event.stopPropagation(); openMemberEditor(editMemberButton.dataset.editMember); return; } const nominationButton = event.target.closest('[data-new-nomination]'); if (nominationButton) { event.stopPropagation(); openMemberEditor('', nominationButton.dataset.newNomination); return; } const partyStatuteButton = event.target.closest('[data-open-party-statute]'); if (partyStatuteButton) { event.stopPropagation(); openPartyStatuteEditor(partyStatuteButton.dataset.openPartyStatute); return; } const partyCard = event.target.closest('[data-open-party]'); if (partyCard) { openPartyEditor(partyCard.dataset.openParty); return; } const row = event.target.closest('[data-open-document]'); if (row) openDocumentEditor(row.dataset.openDocument); });
  document.addEventListener('keydown', event => { const parliamentCard = event.target.closest('[data-open-parliament]'); if (parliamentCard && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openParliamentEditor(parliamentCard.dataset.openParliament); return; } const companyHistoryEntry = event.target.closest('[data-open-company-history]'); if (companyHistoryEntry && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openCompanyHistory(companyHistoryEntry.dataset.openCompanyHistory, companyHistoryEntry.dataset.historyIndex); return; } const historyEntry = event.target.closest('[data-open-statute-history]'); if (historyEntry && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openStatuteHistory(historyEntry.dataset.openStatuteHistory, historyEntry.dataset.historyIndex); return; } const companyCard = event.target.closest('[data-open-company]'); if (companyCard && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openCompanyEditor(companyCard.dataset.openCompany); return; } const partyCard = event.target.closest('[data-open-party]'); if (partyCard && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openPartyEditor(partyCard.dataset.openParty); return; } const row = event.target.closest('[data-open-document]'); if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDocumentEditor(row.dataset.openDocument); } });
  document.getElementById('documentDate').value = today();
  document.querySelectorAll('#documentModal, #templateModal, #parliamentModal').forEach(element => { element.classList.remove('modal', 'fade'); element.classList.add('editor-page', 'd-none'); });
  document.getElementById('parliamentModal').querySelector('[data-bs-dismiss="modal"]').removeAttribute('data-bs-dismiss');
  document.getElementById('parliamentModal').querySelector('[data-bs-dismiss="modal"]').addEventListener('click', closeParliamentEditor);
  organizeDocumentEditor();
  organizeTemplateEditor();
  refreshCategoryOptions();
  refreshDocumentTemplateOptions();
  populateFontMenus();
  if (localStorage.getItem(STORAGE_KEYS.session) === 'active') { if (!currentUser) { const localUser = localAuth.users.find(user => user.id === localStorage.getItem('cz_local_user')) || localAuth.users.find(user => user.isPrimaryAdmin); currentUser = localUser ? localUserPayload(localUser) : null; } document.getElementById('loginView').classList.add('d-none'); document.getElementById('appView').classList.remove('d-none'); setView('dashboard'); }
}

document.addEventListener('DOMContentLoaded', initialize);
