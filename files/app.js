const STORAGE_KEYS = { documents: 'cz_documents', templates: 'cz_templates', counters: 'cz_counters', categories: 'cz_categories', pageMargins: 'cz_page_margins', numberPadding: 'cz_number_padding', googleDriveFolders: 'cz_google_drive_folders', parties: 'cz_parties', partyFields: 'cz_party_fields', coalitions: 'cz_coalitions', coalitionFields: 'cz_coalition_fields', companies: 'cz_companies', parliaments: 'cz_parliaments', parliamentSettings: 'cz_parliament_settings', governments: 'cz_governments', governmentSettings: 'cz_government_settings', courtCompositions: 'cz_court_compositions', compositionSettings: 'cz_composition_settings', interpretations: 'cz_interpretations', interpretationSettings: 'cz_interpretation_settings', usefulLinks: 'cz_useful_links', trash: 'cz_trash', demoSeeded: 'cz_demo_seeded', testMandateSeeded: 'cz_test_mandate_seeded', session: 'cz_session' };
// Cifre dei progressivi: 5 produce 00001, 00002, ... ed è configurabile dalle impostazioni.
const DEFAULT_NUMBER_PADDING = 5;
const defaultCounters = { Sentenze: '00001', Ordinanze: '00001', Decreti: '00001', 'Documenti generali': '00001' };
const defaultPageMargins = { top: 25, right: 25, bottom: 25, left: 25 };
const defaultParliamentSettings = { roles: [{ id: 'titolare', name: 'Parlamentare', limit: 10 }, { id: 'sostituto', name: 'Sostituto', limit: 5 }], fields: [] };
const API_URL = 'api.php';

// Restituisce soltanto il nome della vista. Il callback OAuth può aggiungere
// parametri dopo l'hash (es. #settings?google=connected), che non fanno parte
// dell'id della sezione e non devono essere passati a setView().
function currentHashView() {
  return window.location.hash.replace(/^#/, '').split('?')[0] || 'dashboard';
}

const LOCAL_AUTH_KEYS = { users: 'cz_local_users', registrations: 'cz_local_registration_requests', resets: 'cz_local_password_reset_requests', roles: 'cz_local_roles' };
const PERMISSION_CATALOG = [
  { key: 'documents', label: 'Documenti', group: 'Archivio' }, { key: 'useful_links', label: 'Link utili', group: 'Archivio' }, { key: 'tools', label: 'Tools', group: 'Archivio' }, { key: 'templates', label: 'Template', group: 'Archivio' }, { key: 'odg', label: 'ODG', group: 'Archivio' },
  { key: 'documents_pdf', label: 'Scarica PDF', group: 'Documenti' },
  { key: 'logs', label: 'Log di sicurezza', group: 'Amministrazione' },
  { key: 'parties', label: 'Partiti', group: 'Archivi istituzionali' }, { key: 'companies', label: 'Aziende', group: 'Archivi istituzionali' }, { key: 'parliament', label: 'Parlamento', group: 'Archivi istituzionali' },
  { key: 'government', label: 'Governo', group: 'Archivi istituzionali' }, { key: 'composition', label: 'Composizione della Corte', group: 'Archivi istituzionali' }, { key: 'interpretations', label: 'Interpretazioni', group: 'Archivi istituzionali' },
  { key: 'settings', label: 'Impostazioni', group: 'Configurazione' }, { key: 'users', label: 'Utenti e permessi', group: 'Amministrazione' }
];
const PERMISSION_ACTIONS = [['view', 'Vedere'], ['create', 'Creare'], ['edit', 'Modificare'], ['delete', 'Spostare nel cestino'], ['restore', 'Ripristinare'], ['purge', 'Eliminare definitivamente'], ['approve', 'Approvare'], ['download', 'Scaricare']];
let editingDocumentId = null;
let editingUsefulLinkId = null;
let activeGoogleDocumentId = null;
let editingTemplateId = null;
let editingPartyId = null;
let editingCoalitionId = null;
let editingCompanyId = null;
let editingParliamentId = null;
let editingMemberId = null;
let savedEditorRange = null;
const editorHistories = new WeakMap();
let selectedEditorImage = null;
let remoteMode = false;
let remoteSaveTimer = null;
let currentUser = null;
let csrfToken = '';
let googleConnection = { connected: false, configured: false, email: null };
// Riallineamento periodico dei nomi con Google Drive.
const GOOGLE_NAME_REFRESH_MS = 60000;
const GOOGLE_NAME_MIN_INTERVAL_MS = 15000;
let googleNameWatcher = null;
let googleNameSyncInFlight = null;
let googleNameSyncedAt = 0;
let googleOpenListenerBound = false;
const SESSION_IDLE_LIFETIME_MS = 150 * 60 * 1000;
const SESSION_EXPIRY_WARNING_MS = 30 * 1000;
let sessionExpiryWarningTimer = null;

function scheduleSessionExpiryWarning() {
  clearTimeout(sessionExpiryWarningTimer);
  if (localStorage.getItem(STORAGE_KEYS.session) !== 'active') return;
  sessionExpiryWarningTimer = setTimeout(() => {
    window.alert('La sessione scadrà tra 30 secondi per inattività. Salva il lavoro o esegui un’azione per mantenerla attiva.');
  }, SESSION_IDLE_LIFETIME_MS - SESSION_EXPIRY_WARNING_MS);
}

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

function normalizePageMargins(margins = {}) {
  return Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, Math.min(60, Math.max(5, Number.parseInt(margins?.[side], 10) || defaultPageMargins[side]))]));
}

const state = {
  documents: readStorage(STORAGE_KEYS.documents, []),
  templates: readStorage(STORAGE_KEYS.templates, []),
  counters: readStorage(STORAGE_KEYS.counters, defaultCounters),
  categories: readStorage(STORAGE_KEYS.categories, Object.keys(defaultCounters).map(name => ({ name }))),
  pageMargins: normalizePageMargins(readStorage(STORAGE_KEYS.pageMargins, defaultPageMargins)),
  numberPadding: readStorage(STORAGE_KEYS.numberPadding, DEFAULT_NUMBER_PADDING),
  googleDriveFolders: readStorage(STORAGE_KEYS.googleDriveFolders, { documents: '' }),
  googleDriveFolders: readStorage(STORAGE_KEYS.googleDriveFolders, { documents: '' }),
  parties: readStorage(STORAGE_KEYS.parties, []),
  partyFields: readStorage(STORAGE_KEYS.partyFields, []),
  coalitions: readStorage(STORAGE_KEYS.coalitions, []),
  coalitionFields: readStorage(STORAGE_KEYS.coalitionFields, []),
  companies: readStorage(STORAGE_KEYS.companies, []),
  parliaments: readStorage(STORAGE_KEYS.parliaments, []),
  parliamentSettings: normalizeParliamentSettings(readStorage(STORAGE_KEYS.parliamentSettings, defaultParliamentSettings)),
  governments: readStorage(STORAGE_KEYS.governments, []),
  governmentSettings: normalizeInstitutionSettings(readStorage(STORAGE_KEYS.governmentSettings, null), [{ id: 'presidente', name: 'Presidente del Consiglio', limit: 1 }, { id: 'ministro', name: 'Ministro', limit: 10 }]),
  courtCompositions: readStorage(STORAGE_KEYS.courtCompositions, []),
  compositionSettings: normalizeInstitutionSettings(readStorage(STORAGE_KEYS.compositionSettings, null), [{ id: 'presidente', name: 'Presidente della Corte', limit: 1 }, { id: 'giudice', name: 'Giudice costituzionale', limit: 15 }]),
  interpretations: readStorage(STORAGE_KEYS.interpretations, []),
  usefulLinks: readStorage(STORAGE_KEYS.usefulLinks, []),
  interpretationSettings: { fields: Array.isArray(readStorage(STORAGE_KEYS.interpretationSettings, {}).fields) ? readStorage(STORAGE_KEYS.interpretationSettings, {}).fields : [] },
  trash: readStorage(STORAGE_KEYS.trash, []),
  demoSeeded: readStorage(STORAGE_KEYS.demoSeeded, false),
  testMandateSeeded: readStorage(STORAGE_KEYS.testMandateSeeded, false)
};
// I contatori devono essere un oggetto fin dall'avvio: il dato salvato può
// essere un array (vedi normalizeCounters).
normalizeCounters();
const localAuth = {
  users: readStorage(LOCAL_AUTH_KEYS.users, [{ id: 'local-admin', username: 'admin@localhost', displayName: 'Amministratore locale', role: 'admin', isPrimaryAdmin: true, mustChangeCredentials: true, password: 'zero2026' }]),
  registrations: readStorage(LOCAL_AUTH_KEYS.registrations, []),
  resets: readStorage(LOCAL_AUTH_KEYS.resets, []),
  roles: readStorage(LOCAL_AUTH_KEYS.roles, [{ id: 'local-admin-role', name: 'Amministratore', roleKey: 'admin', isSystem: true, permissions: { '*': { view: true, create: true, edit: true, delete: true, restore: true, purge: true, approve: true, download: true } } }]).filter(role => !['guest', 'reader', 'editor'].includes(role.roleKey || role.role_key)),
  logs: readStorage('cz_local_security_logs', [])
};
if (localAuth.users.length === 1 && localAuth.users[0].username === 'admin@localhost' && localAuth.users[0].mustChangeCredentials === undefined) {
  localAuth.users[0].mustChangeCredentials = true;
  localStorage.setItem(LOCAL_AUTH_KEYS.users, JSON.stringify(localAuth.users));
}
const localAdminRole = localAuth.roles.find(role => role.roleKey === 'admin');
if (localAdminRole?.permissions?.['*'] && (!localAdminRole.permissions['*'].restore || !localAdminRole.permissions['*'].purge)) {
  localAdminRole.permissions['*'].restore = true;
  localAdminRole.permissions['*'].purge = true;
  localStorage.setItem(LOCAL_AUTH_KEYS.roles, JSON.stringify(localAuth.roles));
}

function ensureOdgCategory() {
  if (!state.categories.some(category => category.name === 'ODG')) state.categories.push({ name: 'ODG' });
  if (!Object.prototype.hasOwnProperty.call(state.counters, 'ODG')) state.counters.ODG = padNumber('1');
  normalizeStoredNumbers();
  writeStorage(STORAGE_KEYS.categories, state.categories);
  writeStorage(STORAGE_KEYS.counters, state.counters);
}

function ensureDemoOdg() {
  if (state.demoSeeded) return;
  if (state.documents.some(document => document.category === 'ODG')) {
    state.demoSeeded = true;
    writeStorage(STORAGE_KEYS.demoSeeded, state.demoSeeded);
    return;
  }
  state.documents.unshift({ id: crypto.randomUUID(), title: 'ODG di esempio - Seduta della Corte', category: 'ODG', number: nextNumber('ODG'), year: String(new Date().getFullYear()), date: today(), body: '<h2>Ordine del giorno</h2><p>Esame delle questioni iscritte alla seduta della Corte Costituzionale.</p><ol><li>Approvazione del verbale precedente.</li><li>Esame dei fascicoli iscritti.</li><li>Comunicazioni della Presidenza.</li></ol>', image: '', templateName: '', status: 'da valutare', createdAt: new Date().toISOString() });
  advanceCounter('ODG', state.documents[0].number);
  state.demoSeeded = true;
  writeStorage(STORAGE_KEYS.documents, state.documents);
  writeStorage(STORAGE_KEYS.counters, state.counters);
  writeStorage(STORAGE_KEYS.demoSeeded, state.demoSeeded);
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
// Errore usato quando api.php non risponde o risponde senza JSON (PHP assente,
// errore fatale, database non configurato). Il messaggio è comprensibile anche
// all'utente finale, mentre il flag backendUnavailable permette al resto
// dell'applicazione di riconoscere il caso e attivare il fallback locale.
function backendUnavailableError() {
  const error = new Error('Il server non è raggiungibile o non è configurato correttamente: verifica che api.php venga eseguito da PHP e che private/config.php contenga i dati del database MySQL.');
  error.backendUnavailable = true;
  return error;
}
async function apiRequest(action, options = {}) {
  let response;
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (csrfToken && options.method === 'POST') headers['X-CSRF-Token'] = csrfToken;
    response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, { ...options, headers });
  } catch {
    throw backendUnavailableError();
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw backendUnavailableError();

  const payload = await response.json().catch(() => ({}));

  // Ogni risposta autenticata rinnova il timeout per inattività anche sul server.
  if (response.ok && localStorage.getItem(STORAGE_KEYS.session) === 'active') scheduleSessionExpiryWarning();

  if (response.status === 401) {
    if (localStorage.getItem(STORAGE_KEYS.session) === 'active') {
      localStorage.removeItem(STORAGE_KEYS.session);
      localStorage.removeItem('cz_local_user');
      location.reload();
    }
    throw new Error(payload.error || 'Sessione scaduta. Effettua nuovamente il login.');
  }

  if (!response.ok || payload.error) {
    // BACKEND_UNAVAILABLE è il codice con cui api.php segnala un guasto proprio
    // (database non configurato o non raggiungibile): lo si riporta in forma leggibile.
    if (payload.error === 'BACKEND_UNAVAILABLE' || (!payload.error && response.status >= 500)) throw backendUnavailableError();
    throw new Error(payload.error || 'Errore di comunicazione con il server.');
  }
  return payload;
}
async function refreshGoogleConnectionStatus() {
  if (!remoteMode) { googleConnection = { connected: false, configured: false, email: null }; return; }
  const wasConnected = googleConnection.connected;
  try { googleConnection = await apiRequest('google_status'); } catch { googleConnection = { connected: false, configured: false, email: null }; }
  renderGoogleConnectionSettings();
  applyPermissions();
  if (googleConnection.connected && !wasConnected) {
    // Primo collegamento: si allineano i nomi senza disturbare con notifiche.
    rehydrateGoogleLinks({ silent: true });
  }
}
function renderGoogleConnectionSettings() {
  // Il collegamento Google vive nella navbar (menu accanto a "Esci"), così è
  // raggiungibile da chiunque abbia la capacità dedicata, senza passare dalle
  // impostazioni. Ogni azione resta protetta dalla propria capacità
  // (google.account.connect / google.account.disconnect / google.sync_names).
  const navItem = document.getElementById('googleAccountNavItem');
  const navLabel = document.getElementById('googleAccountNavLabel');
  const status = document.getElementById('googleConnectionStatus');
  const connect = document.getElementById('connectGoogleButton');
  const disconnect = document.getElementById('disconnectGoogleButton');
  const syncBtn = document.getElementById('syncGoogleLinksButton');
  if (!status || !connect || !disconnect) return;
  const canConnect = capable('google.account.connect');
  const canDisconnect = capable('google.account.disconnect');
  const canSync = capable('google.sync_names');
  // Senza alcuna capacità Google il menu sparisce del tutto dalla navbar.
  if (navItem) navItem.classList.toggle('d-none', !(canConnect || canDisconnect || canSync));
  if (navLabel) navLabel.textContent = googleConnection.connected ? (googleConnection.email || 'Google collegato') : 'Google';

  // All'avvio lo stato Google è ancora sconosciuto e il primo render disabilita
  // prudenzialmente il link. Quando google_status conferma la configurazione è
  // indispensabile rimuovere di nuovo .disabled: Bootstrap applica
  // pointer-events:none ai link con questa classe e, prima di questa pulizia,
  // il pulsante rimaneva azzurro ma non cliccabile anche per il primary admin.
  connect.classList.toggle('disabled', !googleConnection.configured);
  connect.setAttribute('aria-disabled', googleConnection.configured ? 'false' : 'true');
  connect.tabIndex = googleConnection.configured ? 0 : -1;
  if (!googleConnection.configured) {
    status.textContent = 'Il collegamento Google deve essere configurato dal gestore del sito.';
    disconnect.classList.add('d-none');
    if (syncBtn) syncBtn.classList.add('d-none');
    return;
  }

  status.textContent = googleConnection.connected
    ? `Collegato: ${googleConnection.email}. L’accesso viene rinnovato automaticamente.`
    : googleConnection.reconnectRequired
      ? 'L’autorizzazione Google non è più valida. Collega nuovamente l’account.'
      : 'Nessun account Google collegato. I documenti non sono disponibili.';
  connect.classList.toggle('d-none', googleConnection.connected || !canConnect);
  disconnect.classList.toggle('d-none', !googleConnection.connected || !canDisconnect);
  if (syncBtn) syncBtn.classList.toggle('d-none', !googleConnection.connected || !canSync);
}
async function disconnectGoogleAccount() {
  try { await apiRequest('google_disconnect', { method: 'POST', body: '{}' }); await refreshGoogleConnectionStatus(); showToast('Account Google scollegato.'); } catch (error) { showToast(error.message); }
}
function googleLinkedDocumentCount() {
  const ids = new Set();
  const addId = id => { if (typeof id === 'string' && /^[a-zA-Z0-9_-]{5,}$/.test(id)) ids.add(id); };
  (state.documents || []).forEach(item => addId(item?.googleDocumentId));
  (state.templates || []).forEach(item => addId(item?.googleDocumentId));
  (state.parties || []).forEach(item => addId(item?.googleStatuteDocumentId));
  (state.companies || []).forEach(item => addId(item?.googleRegulationDocumentId));
  return ids.size;
}

/**
 * Riallinea i nomi con Google Drive. Il rename fatto dentro Google Documenti
 * diventa il nome mostrato dal sito, così non resta mai il titolo vecchio.
 * Il confronto lo esegue il backend, che è l'unico a poter parlare con Drive.
 */
async function rehydrateGoogleLinks({ silent = false } = {}) {
  if (!remoteMode) { if (!silent) showToast('La sincronizzazione Google richiede la modalità remota.'); return; }
  if (!googleConnection.connected) { if (!silent) showToast('Collega prima un account Google dalle impostazioni.'); return; }
  if (googleLinkedDocumentCount() === 0) { if (!silent) showToast('Nessun file Google collegato trovato nell’archivio.'); return; }
  // Una sola sincronizzazione alla volta; quelle automatiche rispettano anche
  // un intervallo minimo, mentre il pulsante manuale parte sempre.
  if (googleNameSyncInFlight) return googleNameSyncInFlight;
  if (silent && Date.now() - googleNameSyncedAt < GOOGLE_NAME_MIN_INTERVAL_MS) return;
  googleNameSyncedAt = Date.now();
  googleNameSyncInFlight = runGoogleNameSync(silent).finally(() => { googleNameSyncInFlight = null; googleNameSyncedAt = Date.now(); });
  return googleNameSyncInFlight;
}

async function runGoogleNameSync(silent) {
  const syncBtn = document.getElementById('syncGoogleLinksButton');
  const previousLabel = syncBtn?.innerHTML;
  if (syncBtn && !silent) { syncBtn.disabled = true; syncBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Sincronizzazione...'; }
  try {
    // Le modifiche locali in coda partono prima, altrimenti il salvataggio
    // ritardato sovrascriverebbe i nomi appena letti da Drive.
    clearTimeout(remoteSaveTimer);
    const payload = await apiRequest('google_sync_names', { method: 'POST', body: '{}' });
    applyRemoteState(payload.state);
    refreshCurrentView();
    if (silent) return;
    const renamed = Array.isArray(payload.renamed) ? payload.renamed.length : 0;
    const missing = Array.isArray(payload.missing) ? payload.missing.length : 0;
    const parts = [];
    if (renamed > 0) parts.push(`${renamed} ${renamed === 1 ? 'nome aggiornato' : 'nomi aggiornati'} da Google`);
    if (missing > 0) parts.push(`${missing} file non ${missing === 1 ? 'trovato' : 'trovati'} su Drive`);
    showToast(parts.length ? `Sincronizzazione completata: ${parts.join(' · ')}.` : `Sincronizzazione completata. Tutti i ${payload.checked || googleLinkedDocumentCount()} file Google sono già allineati.`);
  } catch (error) {
    if (!silent) showToast('Errore durante la sincronizzazione dei file Google: ' + error.message);
  } finally {
    if (syncBtn && !silent) { syncBtn.disabled = false; syncBtn.innerHTML = previousLabel || '<i class="bi bi-arrow-repeat me-1"></i>Sincronizza nomi'; }
  }
}

/**
 * Ridisegna la schermata aperta dopo un aggiornamento dei dati arrivato dal server.
 */
function refreshCurrentView() {
  const view = currentHashView();
  const renderers = {
    dashboard: renderDocuments,
    templates: renderTemplates,
    usefulLinks: renderUsefulLinks,
    tools: () => window.renderTools?.(),
    securityLogs: renderSecurityLogs,
    parties: renderParties,
    coalitions: renderCoalitions,
    companies: renderCompanies,
    odg: renderOdg,
    trash: renderTrash,
    settings: renderSettings,
  };
  try { (renderers[view] || renderDocuments)(); } catch (error) { console.error(error); }
}

/**
 * Propaga al file su Drive il titolo cambiato dal sito: senza questo passaggio
 * la sincronizzazione successiva riporterebbe indietro il nome precedente.
 */
async function renameGoogleDocument(documentId, title, permission = 'documents') {
  if (!remoteMode || !googleConnection.connected || !documentId || !title) return null;
  try {
    const payload = await apiRequest('google_document_rename', { method: 'POST', body: JSON.stringify({ documentId, title, permission }) });
    return payload?.name || null;
  } catch (error) {
    showToast('Il titolo è stato salvato nel sito, ma Google non ha accettato la rinomina: ' + error.message);
    return null;
  }
}

async function createGoogleDocument(title, permission = 'documents', sourceDocumentId = '') {
  if (!remoteMode || !googleConnection.connected) throw new Error('Collega un account Google dalle impostazioni prima di gestire documenti.');
  const payload = await apiRequest('google_document_create', { method: 'POST', body: JSON.stringify({ title, permission, sourceDocumentId }) });
  return payload;
}
function extractGoogleDocId(urlOrId) {
  if (!urlOrId) return '';
  const match = String(urlOrId).match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(String(urlOrId))) return String(urlOrId);
  return '';
}
function openGoogleDocument(documentIdOrUrl, capability = 'documents.open_google') {
  if (!capable(capability)) { showToast('Non hai il permesso di aprire questo documento.'); return; }
  if (!documentIdOrUrl) { showToast('Nessun documento o indirizzo collegato.'); return; }
  if (!capable(capability)) { showToast('Non hai il permesso di aprire questo documento.'); return; }
  if (!documentIdOrUrl) { showToast('Nessun documento o indirizzo collegato.'); return; }
  let url = String(documentIdOrUrl);
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://docs.google.com/document/d/${encodeURIComponent(documentIdOrUrl)}/edit`;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
// Il selettore "Template della categoria" non deve ricostruire la scheda del
// documento (sarebbe un reset di titolo, data e numero già inseriti): la scelta
// aggiorna solo l'esito mostrato nel pannello Google. Il template viene
// applicato alla salvataggio, copiando il Google Doc del template.
function updateTemplateSelectionHints() {
  const status = document.getElementById('googleDocumentEditorStatus');
  if (!status) return;
  const template = state.templates.find(item => item.id === (document.getElementById('documentTemplate')?.value || ''));
  const googleDocEsistente = Boolean(activeGoogleDocumentId || state.documents.find(item => item.id === editingDocumentId)?.googleDocumentId);
  if (!template) {
    status.textContent = googleDocEsistente ? 'Il contenuto è gestito esclusivamente da Google Documenti.' : 'Salva i dati del documento per creare il Google Doc nella cartella configurata.';
    return;
  }
  if (googleDocEsistente) {
    status.textContent = `Il template «${template.name}» non è più applicabile: il documento Google esiste già e resta così com'è.`;
    return;
  }
  if (!template.googleDocumentId) {
    status.textContent = `Attenzione: il template «${template.name}» non ha un documento Google associato (risale a prima del collegamento a Google Documenti). Il documento verrà creato vuoto; apri il template dalla sezione Template per scriverne il contenuto su Google.`;
    return;
  }
  status.textContent = `Alla salvataggio verrà creata una copia del template «${template.name}» nella cartella Google configurata.`;
}
function ensureGoogleOpenListener() {
  // Registrato una sola volta: aprire l'editor più volte non deve accumulare
  // copie del gestore click su "Apri Google Doc".
  if (googleOpenListenerBound) return;
  googleOpenListenerBound = true;
  document.addEventListener('click', event => { const googleButton = event.target.closest('[data-open-google]'); if (googleButton) { event.stopImmediatePropagation(); openGoogleDocument(googleButton.dataset.openGoogle, googleButton.dataset.openCapability || 'documents.open_google'); } });
}
function setGoogleDocumentEditorState(documentId = '', title = '') {
  const editorTitle = document.getElementById('googleDocumentEditorTitle');
  const editorStatus = document.getElementById('googleDocumentEditorStatus');
  const editorButton = document.getElementById('openGoogleDocumentEditorButton');
  if (!editorTitle || !editorStatus || !editorButton) return;
  editorTitle.textContent = documentId ? title || 'Documento Google collegato' : 'Documento Google non ancora creato';
  editorStatus.textContent = documentId ? 'Il contenuto è gestito esclusivamente da Google Documenti.' : 'Salva i dati del documento per creare il Google Doc nella cartella configurata.';
  editorButton.disabled = false;
  editorButton.textContent = documentId ? 'Apri editor Google' : 'Crea e apri editor Google';
  editorButton.onclick = async () => {
    const category = document.getElementById('documentCategory')?.value.trim();
    const scope = category === 'ODG' ? 'odg' : 'documents';
    const requiredCapability = documentId ? `${scope}.open_google` : `${scope}.create`;
    if (!capable(requiredCapability)) { showToast(`Non hai la capacità richiesta: ${requiredCapability}.`); return; }
    const popup = window.open('about:blank', '_blank');
    if (!popup) { showToast('Il browser ha bloccato la nuova scheda. Consenti i popup per questo sito.'); return; }
    try {
      const currentTitle = document.getElementById('documentTitle')?.value.trim();
      if (!documentId) {
        if (!currentTitle) { popup.close(); showToast('Inserisci prima il titolo del documento.'); return; }
        const selectedTemplate = state.templates.find(template => template.id === document.getElementById('documentTemplate')?.value);
        if (selectedTemplate && !selectedTemplate.googleDocumentId) showToast(`Il template «${selectedTemplate.name}» non ha un documento Google associato: il documento verrà creato vuoto.`);
        const created = await createGoogleDocument(currentTitle, scope, selectedTemplate?.googleDocumentId || '');
        activeGoogleDocumentId = created.id;
        persistCreatedGoogleDocument(created.id, currentTitle);
        setGoogleDocumentEditorState(created.id, currentTitle);
        documentId = created.id;
      }
      popup.location.href = `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`;
    } catch (error) { popup.close(); showToast(error.message); }
  };
}
function persistCreatedGoogleDocument(googleDocumentId, title) {
  const category = document.getElementById('documentCategory')?.value.trim() || categoryNames()[0];
  const date = document.getElementById('documentDate')?.value || today();
  const rawNumber = document.getElementById('documentNumber')?.value.trim() || nextNumber(category);
  const template = state.templates.find(item => item.id === document.getElementById('documentTemplate')?.value);
  const status = category === 'ODG' ? (document.getElementById('odgStatus')?.value || 'da valutare') : '';
  if (!/^\d+$/.test(rawNumber) || numericValue(rawNumber) < 1) { showToast('Il documento Google è stato creato, ma inserisci un numero progressivo valido per archiviarlo.'); return; }
  const number = padNumber(rawNumber);
  const record = { id: crypto.randomUUID(), title, category, number, year: date.slice(0, 4), date, templateName: template?.name || '', googleDocumentId, googleDocumentName: title, status, createdAt: new Date().toISOString() };
  state.documents.unshift(record);
  advanceCounter(category, number);
  writeStorage(STORAGE_KEYS.documents, state.documents);
  writeStorage(STORAGE_KEYS.counters, state.counters);
  editingDocumentId = record.id;
  showToast('Documento creato e salvato automaticamente nell’archivio.');
}
async function downloadGooglePdf(documentId, filename = 'documento-google.pdf', scope = 'documents') {
  if (!remoteMode || !googleConnection.connected) { showToast('Collega un account Google dalle impostazioni prima di esportare PDF.'); return; }
  const capability = `${scope}.download_pdf`;
  if (!capable(capability)) { showToast('Non hai il permesso di scaricare questo PDF.'); return; }
  try {
    const response = await fetch(`${API_URL}?action=google_document_pdf&id=${encodeURIComponent(documentId)}&scope=${encodeURIComponent(scope)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Esportazione Google non disponibile.');
    const blob = await response.blob();
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
    showToast('PDF esportato da Google Documenti.');
  } catch (error) { showToast(error.message); }
}
function remoteStatePayload(permission = 'documents') {
  return { permission, state: JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'session'))) };
}
function applyRemoteState(remoteState) {
  if (!remoteState) return;
  Object.keys(state).forEach(key => { if (Object.prototype.hasOwnProperty.call(remoteState, key)) state[key] = remoteState[key]; });
  state.trash = Array.isArray(remoteState.trash) ? remoteState.trash : [];
  state.pageMargins = normalizePageMargins(state.pageMargins);
  state.googleDriveFolders = { documents: '', ...(state.googleDriveFolders || {}) };
  state.googleDriveFolders = { documents: '', ...(state.googleDriveFolders || {}) };
  normalizeCounters();
  normalizeStoredNumbers();
  state.parliamentSettings = normalizeParliamentSettings(state.parliamentSettings, defaultParliamentSettings);
  state.governmentSettings = normalizeInstitutionSettings(state.governmentSettings, [{ id: 'presidente', name: 'Presidente del Consiglio', limit: 1 }, { id: 'ministro', name: 'Ministro', limit: 10 }]);
  state.compositionSettings = normalizeInstitutionSettings(state.compositionSettings, [{ id: 'presidente', name: 'Presidente della Corte', limit: 1 }, { id: 'giudice', name: 'Giudice costituzionale', limit: 15 }]);
  state.interpretationSettings = { fields: Array.isArray(state.interpretationSettings?.fields) ? state.interpretationSettings.fields : [] };
  (state.parties || []).forEach(party => {
    if (!party.googleStatuteDocumentId && (party.googleUrl || party.statuteUrl)) {
      party.googleStatuteDocumentId = extractGoogleDocId(party.googleUrl || party.statuteUrl) || null;
    }
    if (party.googleStatuteDocumentId && !party.googleUrl) {
      party.googleUrl = `https://docs.google.com/document/d/${encodeURIComponent(party.googleStatuteDocumentId)}/edit`;
    }
    if (party.googleUrl && !party.statuteUrl) {
      party.statuteUrl = party.googleUrl;
    }
  });
  // I nomi arrivano già allineati dal backend: qui si tiene solo la copia usata
  // per mostrare il titolo reale del file accanto allo statuto/regolamento.
  (state.parties || []).forEach(party => { if (!party.googleStatuteName && party.googleDocumentName) party.googleStatuteName = party.googleDocumentName; });
  (state.companies || []).forEach(company => {
    if (!company.googleRegulationDocumentId && (company.googleUrl || company.regulationUrl)) {
      company.googleRegulationDocumentId = extractGoogleDocId(company.googleUrl || company.regulationUrl) || null;
    }
    if (company.googleRegulationDocumentId && !company.googleUrl) {
      company.googleUrl = `https://docs.google.com/document/d/${encodeURIComponent(company.googleRegulationDocumentId)}/edit`;
    }
    if (company.googleUrl && !company.regulationUrl) {
      company.regulationUrl = company.googleUrl;
    }
  });
  (state.companies || []).forEach(company => { if (!company.googleRegulationName && company.googleDocumentName) company.googleRegulationName = company.googleDocumentName; });
}
async function saveRemoteState(permission = 'documents') {
  await apiRequest('save_state', { method: 'POST', body: JSON.stringify(remoteStatePayload(permission)) });
}
function queueRemoteSave(permission = 'documents') {
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    saveRemoteState(permission).catch(error => {
      console.error(error);
      showToast(error.message || 'Non hai il permesso di salvare questa modifica.');
    });
  }, 250);
}
async function loadRemoteState() {
  try {
    const payload = await apiRequest('state');
    remoteMode = true;
    currentUser = payload.user || null;
    csrfToken = currentUser?.csrfToken || '';
    applyRemoteState(payload.state);
    refreshGoogleConnectionStatus();
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
  refreshGoogleConnectionStatus();
  ensureOdgCategory();
  return payload;
}
// Login locale: usato quando il backend non è raggiungibile, come già avviene
// per le richieste di registrazione e recupero password. Gli utenti locali
// vivono nel localStorage di questo browser (admin@localhost / zero2026 alla
// prima apertura, con cambio credenziali obbligato).
function loginLocal(username, password) {
  const user = localAuth.users.find(item => item.username === username && !item.deletedAt);
  if (!user || user.password !== password) throw new Error('Credenziali non valide. Riprova.');
  remoteMode = false;
  currentUser = localUserPayload(user);
  localStorage.setItem('cz_local_user', JSON.stringify({ id: user.id }));
  ensureUserManagementCard();
  applyPermissions();
  localSecurityLog('login_local', 'info', { username });
  return user;
}
// Senza backend la sessione resta valida anche ricaricando la pagina,
// specularmente a quanto avviene in modalità remota.
function restoreLocalSession() {
  if (localStorage.getItem(STORAGE_KEYS.session) !== 'active') return false;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('cz_local_user') || 'null'); } catch { stored = null; }
  const user = localAuth.users.find(item => item.id === stored?.id && !item.deletedAt);
  if (!user) return false;
  remoteMode = false;
  currentUser = localUserPayload(user);
  ensureUserManagementCard();
  applyPermissions();
  return true;
}
async function submitLogin(event) {
  event.preventDefault();
  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  const alert = document.getElementById('loginAlert');
  alert.classList.add('d-none');
  try {
    try {
      await loginRemote(username, password);
      await requireFirstAccessCredentials();
    } catch (error) {
      // Senza backend il login remoto è impossibile: si ripiega sugli utenti
      // locali invece di lasciare l'utente chiuso fuori con un errore tecnico.
      if (!error.backendUnavailable) throw error;
      try {
        const localUser = loginLocal(username, password);
        await requireFirstAccessCredentials(localUser);
        showToast('Backend non raggiungibile: accesso effettuato in modalità locale.');
      } catch (localError) {
        throw new Error(`${error.message} In modalità locale: ${localError.message}`);
      }
    }
    localStorage.setItem(STORAGE_KEYS.session, 'active');
    scheduleSessionExpiryWarning();
    document.getElementById('loginView').classList.add('d-none');
    document.getElementById('appView').classList.remove('d-none');
    setView('dashboard');
  } catch (error) {
    alert.textContent = error.message || 'Credenziali non valide. Riprova.';
    alert.classList.remove('d-none');
  }
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
  return { users: localAuth.users.filter(user => !user.deletedAt).map(localUserPayload), deletedUsers: localAuth.users.filter(user => user.deletedAt).map(localUserPayload), roles: localAuth.roles, permissions: PERMISSION_CATALOG.map((permission, index) => ({ id: index + 1, permission_key: permission.key, label: permission.label, permission_group: permission.group })), rolePermissions: [], registrations: localAuth.registrations.filter(request => request.status === 'pending'), resets: localAuth.resets.filter(request => request.status === 'pending'), logs: localAuth.logs };
}
function localUserPayload(user) {
  const role = localAuth.roles.find(item => item.id === user.roleId || item.roleKey === user.role) || localAuth.roles[0];
  return { id: user.id, username: user.username, displayName: user.displayName, role: role.name, roleId: role.id, isPrimaryAdmin: Boolean(user.isPrimaryAdmin), mustChangeCredentials: Boolean(user.mustChangeCredentials), deletedAt: user.deletedAt || null, capabilities: user.isPrimaryAdmin ? ['*'] : (role.capabilities || []), permissions: role.permissions };
}
function capable(capability) {
  if (currentUser?.isPrimaryAdmin) return true;
  const capabilities = Array.isArray(currentUser?.capabilities) ? currentUser.capabilities : [];
  return capabilities.includes('*') || capabilities.includes(capability);
}

function legacyCapabilityCandidates(permission, action = 'view') {
  const prefixes = {
    documents: 'documents', templates: 'templates', odg: 'odg', parties: 'parties', companies: 'companies',
    parliament: 'parliament', government: 'government', composition: 'composition', interpretations: 'interpretations',
    useful_links: 'useful_links', tools: 'tools', settings: 'settings', users: 'users', roles: 'roles', logs: 'security_logs', documents_pdf: 'documents'
  };
  const prefix = prefixes[permission] || permission;
  const capabilities = Array.isArray(currentUser?.capabilities) ? currentUser.capabilities : [];
  const suffixes = {
    view: ['.view'], create: ['.create'], edit: ['.edit', '.change_', '.configuration.'],
    delete: ['.trash'], restore: ['.restore'], purge: ['.purge'], approve: ['.change_', '.resign', '.end', '.approve'], download: ['.download_pdf']
  }[action] || [];
  return capabilities.filter(key => key === prefix || key.startsWith(prefix + '.')).some(key => suffixes.some(suffix => key.includes(suffix)));
}

function can(permission, action = 'view') {
  if (currentUser?.isPrimaryAdmin) return true;
  if (Array.isArray(currentUser?.capabilities)) return legacyCapabilityCandidates(permission, action);
  const permissions = currentUser?.permissions || {};
  return Boolean(permissions['*']?.[action] || permissions[permission]?.[action]);
}
function denyPermission(permission, action) {
  const labels = { view: 'visualizzare', create: 'creare', edit: 'modificare', delete: 'eliminare', restore: 'ripristinare', purge: 'eliminare definitivamente', approve: 'approvare', download: 'scaricare' };
  showToast(`Non hai il permesso di ${labels[action] || 'eseguire questa azione'} in questa sezione.`);
  return false;
}
function requirePermission(permission, action = 'view') {
  return can(permission, action) || denyPermission(permission, action);
}
function formCapability(form) {
  const editedDocument = state.documents.find(item => item.id === editingDocumentId);
  const documentPrefix = editedDocument?.category === 'ODG' || document.getElementById('documentCategory')?.value === 'ODG' ? 'odg' : 'documents';
  const fixed = {
    documentForm: `${documentPrefix}.${editingDocumentId ? 'edit' : 'create'}`,
    templateForm: `templates.${editingTemplateId ? 'edit' : 'create'}`,
    partyForm: editingPartyId ? ['parties.edit', 'parties.change_status'] : 'parties.create',
    coalitionForm: editingCoalitionId ? ['coalitions.edit', 'coalitions.change_status', 'coalitions.manage_parties'] : 'coalitions.create',
    companyForm: `companies.${editingCompanyId ? 'edit' : 'create'}`,
    parliamentForm: `parliament.mandates.${editingParliamentId ? 'edit' : 'create'}`,
    memberForm: editingMemberId ? ['parliament.members.edit', 'parliament.members.change_role', 'parliament.members.change_resignation_date', 'parliament.members.undo_resignation'] : 'parliament.members.create',
    usefulLinkForm: `useful_links.${editingUsefulLinkId ? 'edit' : 'create'}`,
    interpretationForm: `interpretations.${window.editingInterpretationId ? 'edit' : 'create'}`,
    partyStatuteForm: (state.parties.find(item => item.id === editingPartyId)?.googleStatuteDocumentId || state.parties.find(item => item.id === editingPartyId)?.statuteUrl || state.parties.find(item => item.id === editingPartyId)?.googleUrl) ? 'party_statutes.change_link' : 'party_statutes.link',
    companyRegulationForm: (state.companies.find(item => item.id === editingCompanyId)?.googleRegulationDocumentId || state.companies.find(item => item.id === editingCompanyId)?.regulationUrl || state.companies.find(item => item.id === editingCompanyId)?.googleUrl) ? 'company_regulations.change_link' : 'company_regulations.link',
    partyStatuteForm: (state.parties.find(item => item.id === editingPartyId)?.googleStatuteDocumentId || state.parties.find(item => item.id === editingPartyId)?.statuteUrl || state.parties.find(item => item.id === editingPartyId)?.googleUrl) ? 'party_statutes.change_link' : 'party_statutes.link',
    companyRegulationForm: (state.companies.find(item => item.id === editingCompanyId)?.googleRegulationDocumentId || state.companies.find(item => item.id === editingCompanyId)?.regulationUrl || state.companies.find(item => item.id === editingCompanyId)?.googleUrl) ? 'company_regulations.change_link' : 'company_regulations.link',
    googleDriveFoldersForm: 'settings.google_folders.edit',
    categoryForm: 'settings.categories.create', numberingForm: 'settings.counters.edit',
    pageMarginsForm: 'settings.page_margins.edit', partyFieldForm: 'settings.party_fields.create',
    coalitionFieldForm: 'settings.coalition_fields.create', parliamentSettingsForm: ['parliament.configuration.roles_create', 'parliament.configuration.roles_edit', 'parliament.configuration.roles_delete'],
    parliamentFieldForm: 'parliament.configuration.fields_create', interpretationFieldForm: 'interpretations.configuration.fields_create'
  };
  if (fixed[form.id]) return fixed[form.id];
  for (const type of Object.keys(institutionConfigs)) {
    if (form.id === `${type}Form`) return `${type}.records.${window[`editing${type}Id`] ? 'edit' : 'create'}`;
    if (form.id === `${type}PersonForm`) return window[`editing${type}MemberId`] ? [`${type}.members.edit`, `${type}.members.change_role`, `${type}.members.end`, `${type}.members.change_end_date`, `${type}.members.undo_end`] : `${type}.members.create`;
    if (form.id === `${type}SettingsForm`) return [`${type}.configuration.roles_create`, `${type}.configuration.roles_edit`, `${type}.configuration.roles_delete`];
  }
  return null;
}
function enforceFormPermissions(event) {
  const required = formCapability(event.target);
  if (!required || (Array.isArray(required) ? required.some(capable) : capable(required))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showToast(`Non hai una delle capacità richieste: ${Array.isArray(required) ? required.join(', ') : required}.`);
}
function permissionForStorageKey(key) {
  const map = {
    documents: 'documents',
    templates: 'templates',
    counters: 'settings',
    categories: 'settings',
    pageMargins: 'settings',
    numberPadding: 'settings',
    googleDriveFolders: 'settings',
    parties: 'parties',
    partyFields: 'parties',
    coalitions: 'parties',
    coalitionFields: 'parties',
    companies: 'companies',
    parliaments: 'parliament',
    parliamentSettings: 'parliament',
    governments: 'government',
    governmentSettings: 'government',
    courtCompositions: 'composition',
    compositionSettings: 'composition',
    interpretations: 'interpretations',
    usefulLinks: 'useful_links',
    interpretationSettings: 'interpretations',
    trash: 'documents',
    cz_documents: 'documents',
    cz_templates: 'templates',
    cz_counters: 'settings',
    cz_categories: 'settings',
    cz_page_margins: 'settings',
    cz_number_padding: 'settings',
    cz_parties: 'parties',
    cz_party_fields: 'parties',
    cz_coalitions: 'parties',
    cz_coalition_fields: 'parties',
    cz_companies: 'companies',
    cz_parliaments: 'parliament',
    cz_parliament_settings: 'parliament',
    cz_governments: 'government',
    cz_government_settings: 'government',
    cz_court_compositions: 'composition',
    cz_composition_settings: 'composition',
    cz_interpretations: 'interpretations',
    cz_useful_links: 'useful_links',
    cz_interpretation_settings: 'interpretations',
    cz_trash: 'documents'
  };
  return map[key] || 'documents';
}
const TRASH_ENTITY_CONFIG = {
  documents: { storageKey: 'documents', permission: 'documents', label: 'Documento' },
  templates: { storageKey: 'templates', permission: 'templates', label: 'Template' },
  parties: { storageKey: 'parties', permission: 'parties', label: 'Partito' },
  coalitions: { storageKey: 'coalitions', permission: 'parties', label: 'Coalizione' },
  companies: { storageKey: 'companies', permission: 'companies', label: 'Azienda' },
  parliaments: { storageKey: 'parliaments', permission: 'parliament', label: 'Mandato parlamentare' },
  governments: { storageKey: 'governments', permission: 'government', label: 'Scheda Governo' },
  courtCompositions: { storageKey: 'courtCompositions', permission: 'composition', label: 'Composizione della Corte' },
  interpretations: { storageKey: 'interpretations', permission: 'interpretations', label: 'Interpretazione' },
  usefulLinks: { storageKey: 'usefulLinks', permission: 'useful_links', label: 'Link utile' },
  parliamentMembers: { storageKey: 'parliaments', permission: 'parliament', label: 'Nomina parlamentare', memberKey: 'members' },
  governmentMembers: { storageKey: 'governments', permission: 'government', label: 'Componente del Governo', memberKey: 'members' },
  compositionMembers: { storageKey: 'courtCompositions', permission: 'composition', label: 'Componente della Corte', memberKey: 'members' }
};
function trashConfig(entityType) { return TRASH_ENTITY_CONFIG[entityType] || null; }
function trashCapability(entityType, action, data = null) {
  const prefixes = {
    documents: data?.category === 'ODG' ? 'odg' : 'documents', templates: 'templates', parties: 'parties', coalitions: 'coalitions',
    companies: 'companies', parliaments: 'parliament.mandates', parliamentMembers: 'parliament.members',
    governments: 'government.records', governmentMembers: 'government.members', courtCompositions: 'composition.records',
    compositionMembers: 'composition.members', interpretations: 'interpretations', usefulLinks: 'useful_links'
  };
  return `${prefixes[entityType] || 'unknown'}.${action}`;
}
function hasTrashAccess() {
  const capabilities = Array.isArray(currentUser?.capabilities) ? currentUser.capabilities : [];
  return currentUser?.isPrimaryAdmin || capabilities.some(key => key.endsWith('.trash') || key.endsWith('.restore') || key.endsWith('.purge'));
}
function trashEntryTitle(entry) {
  const data = entry.data || {};
  return data.title || data.name || data.legislation || data.period || entry.label || 'Elemento senza titolo';
}
function localTrashEntry(entityType, entityId, parentId = '') {
  const config = trashConfig(entityType);
  if (!config) return null;
  const collection = state[config.storageKey];
  if (!Array.isArray(collection)) return null;
  if (config.memberKey) {
    const parent = collection.find(item => item.id === parentId);
    const items = parent?.[config.memberKey];
    const index = Array.isArray(items) ? items.findIndex(item => item.id === entityId) : -1;
    if (!parent || index < 0) return null;
    const [data] = items.splice(index, 1);
    parent.updatedAt = new Date().toISOString();
    return { id: crypto.randomUUID(), entityType, permission: config.permission, label: config.label, deletedAt: new Date().toISOString(), parentId, originalIndex: index, data };
  }
  const index = collection.findIndex(item => item.id === entityId);
  if (index < 0) return null;
  const [data] = collection.splice(index, 1);
  return { id: crypto.randomUUID(), entityType, permission: config.permission, label: config.label, deletedAt: new Date().toISOString(), originalIndex: index, data };
}
function localRestoreTrashEntry(trashId) {
  const index = state.trash.findIndex(entry => entry.id === trashId);
  const entry = state.trash[index];
  const config = entry && trashConfig(entry.entityType);
  if (!entry || !config) return false;
  const collection = state[config.storageKey];
  if (!Array.isArray(collection)) return false;
  if (config.memberKey) {
    const parent = collection.find(item => item.id === entry.parentId);
    if (!parent) throw new Error('Impossibile ripristinare il componente: la relativa scheda è stata eliminata. Ripristina prima la scheda.');
    parent[config.memberKey] ||= [];
    if (parent[config.memberKey].some(item => item.id === entry.data?.id)) throw new Error('Questo elemento è già presente nella scheda originale.');
    parent[config.memberKey].splice(Math.min(Number(entry.originalIndex) || 0, parent[config.memberKey].length), 0, entry.data);
    parent.updatedAt = new Date().toISOString();
  } else {
    if (collection.some(item => item.id === entry.data?.id)) throw new Error('Questo elemento è già presente nell’archivio principale.');
    collection.splice(Math.min(Number(entry.originalIndex) || 0, collection.length), 0, entry.data);
  }
  state.trash.splice(index, 1);
  return true;
}
function persistLocalTrashMutation(config) {
  writeStorage(STORAGE_KEYS[config.storageKey], state[config.storageKey]);
  writeStorage(STORAGE_KEYS.trash, state.trash);
}
function rerenderAfterTrashMutation() {
  const view = currentHashView();
  if (view === 'trash') renderTrash();
  else setView(view, false);
}
async function moveToTrash(entityType, entityId, parentId = '') {
  const config = trashConfig(entityType);
  const collection = config ? state[config.storageKey] : null;
  const parent = config?.memberKey && Array.isArray(collection) ? collection.find(item => item.id === parentId) : null;
  const data = config?.memberKey ? parent?.[config.memberKey]?.find(item => item.id === entityId) : collection?.find?.(item => item.id === entityId);
  if (!config || !capable(trashCapability(entityType, 'trash', data))) { showToast('Non hai il permesso di spostare questo elemento nel cestino.'); return; }
  if (!confirm('Spostare questo elemento nel cestino? Potrà essere ripristinato o eliminato definitivamente dal cestino.')) return;
  try {
    if (remoteMode) {
      clearTimeout(remoteSaveTimer);
      const payload = await apiRequest('trash_item', { method: 'POST', body: JSON.stringify({ entityType, entityId, parentId }) });
      applyRemoteState(payload.state);
    } else {
      const entry = localTrashEntry(entityType, entityId, parentId);
      if (!entry) throw new Error('Elemento non trovato o già eliminato.');
      state.trash.unshift(entry);
      persistLocalTrashMutation(config);
      localSecurityLog('item_trashed', 'warning', { entityType, entityId, parentId });
    }
    rerenderAfterTrashMutation();
    showToast('Elemento spostato nel cestino.');
  } catch (error) { showToast(error.message); }
}
async function restoreTrashItem(trashId) {
  const entry = state.trash.find(item => item.id === trashId);
  const config = entry && trashConfig(entry.entityType);
  if (!entry || !config || !capable(trashCapability(entry.entityType, 'restore', entry.data))) { showToast('Non hai il permesso di ripristinare questo elemento.'); return; }
  try {
    if (remoteMode) {
      clearTimeout(remoteSaveTimer);
      const payload = await apiRequest('restore_trash_item', { method: 'POST', body: JSON.stringify({ trashId }) });
      applyRemoteState(payload.state);
    } else {
      localRestoreTrashEntry(trashId);
      persistLocalTrashMutation(config);
      localSecurityLog('item_restored', 'info', { trashId, entityType: entry.entityType });
    }
    rerenderAfterTrashMutation();
    showToast('Elemento ripristinato nell’archivio principale.');
  } catch (error) { showToast(error.message); }
}
async function permanentlyDeleteTrashItem(trashId) {
  const entry = state.trash.find(item => item.id === trashId);
  const config = entry && trashConfig(entry.entityType);
  if (!entry || !config || !capable(trashCapability(entry.entityType, 'purge', entry.data))) { showToast('Non hai il permesso di eliminare definitivamente questo elemento.'); return; }
  if (!confirm(`Eliminare definitivamente “${trashEntryTitle(entry)}”? Questa azione non può essere annullata.`)) return;
  try {
    if (remoteMode) {
      clearTimeout(remoteSaveTimer);
      const payload = await apiRequest('purge_trash_item', { method: 'POST', body: JSON.stringify({ trashId }) });
      applyRemoteState(payload.state);
    } else {
      state.trash = state.trash.filter(item => item.id !== trashId);
      writeStorage(STORAGE_KEYS.trash, state.trash);
      localSecurityLog('item_purged', 'critical', { trashId, entityType: entry.entityType });
    }
    renderTrash();
    showToast('Elemento eliminato definitivamente.');
  } catch (error) { showToast(error.message); }
}
function applyPermissions() {
  const views = { dashboard: 'documents.view', templates: 'templates.view', parties: 'parties.view', coalitions: 'coalitions.view', companies: 'companies.view', parliament: 'parliament.mandates.view', government: 'government.records.view', composition: 'composition.records.view', interpretations: 'interpretations.view', usefulLinks: 'useful_links.view', odg: 'odg.view' };
  Object.entries(views).forEach(([view, capability]) => document.querySelectorAll(`[data-view-link="${view}"]`).forEach(link => { const navItem = link.closest('.nav-item'); if (navItem) navItem.classList.toggle('d-none', !capable(capability)); }));
  // La voce "Impostazioni" della navbar principale apre l'area di
  // configurazione: resta visibile se almeno una sezione è accessibile.
  document.querySelectorAll('[data-view-link="settings"]').forEach(link => { const navItem = link.closest('.nav-item'); if (navItem) navItem.classList.toggle('d-none', !canAccessSettingsArea()); });
  refreshSettingsSubnav();
  renderGoogleConnectionSettings();
  const controls = {
    '#newDocumentButton': 'documents.create', '#newTemplateButton': 'templates.create', '#newPartyButton': 'parties.create',
    '#newCoalitionButton': 'coalitions.create', '#newCompanyButton': 'companies.create', '#newParliamentButton': 'parliament.mandates.create',
    '#newOdgButton': 'odg.create', '#newInterpretationButton': 'interpretations.create', '#newUsefulLinkButton': 'useful_links.create',
    '[data-new-institution="government"]': 'government.records.create', '[data-new-institution="composition"]': 'composition.records.create'
  };
  Object.entries(controls).forEach(([selector, capability]) => document.querySelectorAll(selector).forEach(control => { control.classList.toggle('d-none', !capable(capability)); }));
  document.querySelectorAll('#newDocumentButton').forEach(control => control.classList.toggle('d-none', !capable('documents.create') || !googleConnection.connected));
  document.querySelectorAll('#newTemplateButton').forEach(control => control.classList.toggle('d-none', !capable('templates.create') || !googleConnection.connected));
  document.querySelectorAll('#newOdgButton').forEach(control => control.classList.toggle('d-none', !capable('odg.create') || !googleConnection.connected));
  document.querySelectorAll('[data-use-template]').forEach(control => control.classList.toggle('d-none', !capable('templates.use') || !capable('documents.create') || !googleConnection.connected));
}



function ensureTrashView() {
  const appContainer = document.querySelector('#appView > .container-fluid');
  if (!document.getElementById('trashView')) appContainer.insertAdjacentHTML('beforeend', '<section id="trashView" class="app-view d-none"><div class="d-flex flex-column flex-md-row justify-content-between align-items-md-end gap-3 mb-4"><div><p class="eyebrow text-secondary mb-2">Recupero e rimozione</p><h1 class="display-6 fw-bold mb-2">Cestino</h1><p class="text-secondary mb-0">Gli elementi nel cestino non sono visibili negli archivi principali. Ripristinali oppure rimuovili in modo definitivo secondo i permessi assegnati.</p></div><div class="stat-card trash-stat-card"><span class="text-secondary small">Elementi nel cestino</span><strong id="trashCount">0</strong></div></div><div class="card border-0 shadow-sm"><div class="card-body p-0"><div class="table-responsive"><table class="table align-middle mb-0"><thead><tr><th class="ps-4">Tipo</th><th>Elemento</th><th>Eliminato il</th><th class="text-end pe-4">Azioni</th></tr></thead><tbody id="trashTableBody"></tbody></table></div><div id="emptyTrash" class="empty-state d-none"><div class="display-6"><i class="bi bi-trash3" aria-hidden="true"></i></div><h2 class="h5 mt-3">Il cestino è vuoto</h2><p class="text-secondary mb-0">Gli elementi spostati qui non compariranno più nelle rispettive sezioni principali.</p></div></div></div></section>');
  ensureArchiveSearch('trashView', 'trashSearch', 'Cerca nel cestino', 'trashTableBody');
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Data non disponibile' : date.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function renderTrash() {
  ensureTrashView();
  const query = archiveSearchValue('trashSearch');
  const entries = [...(Array.isArray(state.trash) ? state.trash : [])].filter(entry => matchesArchiveSearch([entry.label, trashEntryTitle(entry)], query)).sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
  const body = document.getElementById('trashTableBody');
  body.innerHTML = entries.map(entry => {
    const config = trashConfig(entry.entityType);
    const canRestore = config && capable(trashCapability(entry.entityType, 'restore', entry.data));
    const canPurge = config && capable(trashCapability(entry.entityType, 'purge', entry.data));
    const hasGoogleDoc = entry.data && (entry.data.googleDocumentId || entry.data.googleStatuteDocumentId || entry.data.googleRegulationDocumentId);
    return `<tr><td class="ps-4"><span class="badge text-bg-light">${escapeHtml(entry.label || config?.label || 'Elemento')}</span></td><td><strong>${escapeHtml(trashEntryTitle(entry))}</strong>${entry.parentId ? '<small class="d-block text-secondary">Elemento contenuto in una scheda archiviata</small>' : ''}${hasGoogleDoc ? '<small class="d-block text-secondary">Include il documento Google associato</small>' : ''}</td><td class="small text-secondary">${escapeHtml(formatDateTime(entry.deletedAt))}</td><td class="text-end pe-4"><div class="d-flex justify-content-end flex-wrap gap-2">${canRestore ? `<button type="button" class="btn btn-sm btn-outline-primary" data-restore-trash="${entry.id}">Ripristina</button>` : ''}${canPurge ? `<button type="button" class="btn btn-sm btn-outline-danger" data-purge-trash="${entry.id}">Elimina definitivamente</button>` : ''}${!canRestore && !canPurge ? '<span class="small text-secondary">Nessuna azione autorizzata</span>' : ''}</div></td></tr>`;
  }).join('');
  document.getElementById('emptyTrash').classList.toggle('d-none', entries.length > 0);
  document.getElementById('trashCount').textContent = entries.length;
}


function localRequestRegistration(displayName, email, password) {
  if (localAuth.users.some(user => user.username === email && !user.deletedAt) || localAuth.registrations.some(request => request.email === email && request.status === 'pending')) throw new Error('Esiste già una richiesta o un utente con questa mail.');
  localAuth.registrations.push({ id: crypto.randomUUID(), email, displayName, password, status: 'pending', createdAt: new Date().toISOString() });
  saveLocalAuth();
  return { message: 'Richiesta locale inviata. Approvala dalla Gestione utenti.' };
}
function localRequestReset(email) {
  const approved = localAuth.resets.find(request => request.email === email && request.status === 'approved');
  if (approved) return { requiresPassword: true, message: 'Richiesta approvata. Inserisci la tua nuova password.' };
  const user = localAuth.users.find(item => item.username === email && !item.deletedAt);
  if (user && !localAuth.resets.some(request => request.email === email && request.status === 'pending')) localAuth.resets.push({ id: crypto.randomUUID(), userId: user.id, email, status: 'pending', createdAt: new Date().toISOString() });
  saveLocalAuth();
  return { message: 'Se la mail è registrata, la richiesta locale è stata inoltrata all’amministratore.' };
}
function localCompletePasswordReset(email, password) {
  const request = localAuth.resets.find(item => item.email === email && item.status === 'approved');
  const user = localAuth.users.find(item => item.id === request?.userId && !item.deletedAt);
  if (!request || !user) throw new Error('La richiesta non è ancora stata approvata o non è più valida.');
  user.password = password;
  localAuth.resets = localAuth.resets.filter(item => item.id !== request.id);
  saveLocalAuth();
  return { message: 'Password aggiornata. Ora puoi effettuare l’accesso.' };
}
function formatDate(value) {
  if (!value) return '—';
  try {
    const str = String(value).trim();
    if (!str) return '—';
    const d = new Date(str.includes('T') ? str : `${str}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  } catch {
    return '—';
  }
}
function today() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value = '') { return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function sanitizeRichHtml(value = '') {
  if (window.DOMPurify) return window.DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: false,
    ALLOWED_ATTR: ['class', 'style', 'src', 'alt', 'href', 'title', 'target', 'rel', 'width', 'height'],
    ALLOWED_CSS_PROPERTIES: ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height', 'display', 'margin', 'z-index']
  });
  const container = document.createElement('div');
  container.innerHTML = value;
  container.querySelectorAll('script,style,iframe,object,embed,form').forEach(element => element.remove());
  container.querySelectorAll('*').forEach(element => [...element.attributes].forEach(attribute => {
    if (/^on/i.test(attribute.name) || (['href', 'src'].includes(attribute.name) && !/^(https?:|mailto:|data:image\/)/i.test(attribute.value))) {
      element.removeAttribute(attribute.name);
    }
  }));
  return container.innerHTML;
}
function plainText(value = '') { const container = document.createElement('div'); container.innerHTML = value; return container.textContent || ''; }
// I progressivi sono testo con zeri iniziali (00001, 00002, ...): mantenerli come
// stringhe evita che "00012" diventi 12 e fa restare l'archivio ordinato.
function numberPadding() {
  const configured = Number.parseInt(state.numberPadding, 10);
  return Number.isFinite(configured) && configured >= 1 && configured <= 12 ? configured : DEFAULT_NUMBER_PADDING;
}
function padNumber(value, padding = numberPadding()) {
  const digits = String(value ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed.padStart(padding, '0');
}
function formatNumber(value) { return padNumber(value) || String(value ?? ''); }
// I contatori progressivi per categoria vivono in un oggetto {Categoria: '00002'}.
// Lo stato remoto storico però li ha salvati come array (PHP trasforma un
// oggetto vuoto in []): assegnare proprietà testuali a un array funziona in
// memoria, ma JSON.stringify le scarta, quindi la numerazione non avanzava mai
// e ogni documento di ogni tipologia restava 00001. Qui si forza sempre la
// forma a oggetto, scartando le chiavi numeriche derivate dagli array.
function normalizeCounters() {
  const source = state.counters;
  const counters = {};
  if (Array.isArray(source) || (source && typeof source === 'object')) {
    Object.entries(source).forEach(([category, value]) => {
      if (/^\d+$/.test(category)) return; // indici di array, non categorie
      const padded = padNumber(value);
      if (padded !== '') counters[category] = padded;
    });
  }
  state.counters = counters;
}
function nextNumber(category) {
  // Un contatore impostato esplicitamente ha sempre precedenza, anche quando è
  // inferiore ai numeri già archiviati: il reset non rinumera i file esistenti.
  const configured = state.counters?.[category];
  if (configured !== undefined && /^\d+$/.test(String(configured)) && Number.parseInt(configured, 10) > 0) return padNumber(configured);
  // Solo se il contatore manca del tutto si ricostruisce un valore prudente dai documenti.
  const fromDocuments = (state.documents || []).reduce((max, item) => item.category === category ? Math.max(max, numericValue(item.number)) : max, 0) + 1;
  return padNumber(String(fromDocuments));
}
function numericValue(value) { const parsed = Number.parseInt(String(value ?? '').replace(/\D+/g, ''), 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : 1; }
function advanceCounter(category, usedNumber) { const nextValue = Math.max(numericValue(nextNumber(category)), numericValue(usedNumber) + 1); state.counters[category] = padNumber(String(nextValue)); }
function normalizeStoredNumbers() {
  // Si normalizzano soltanto i contatori. I progressivi dei documenti esistenti
  // sono dati storici e non devono cambiare quando si modifica la numerazione.
  let changed = false;
  Object.entries(state.counters || {}).forEach(([category, value]) => { const padded = padNumber(value); if (padded && padded !== value) { state.counters[category] = padded; changed = true; } });
  return changed;
}
function documentCode(document) { return `${document.category} ${formatNumber(document.number)}/${document.year}`; }
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
function deleteCategory(name) {
  if (!capable('settings.categories.delete')) { showToast('Non hai il permesso di eliminare categorie.'); return; }
  const usedByDocuments = state.documents.some(document => document.category === name);
  const usedByTemplates = state.templates.some(template => template.category === name);
  if (usedByDocuments || usedByTemplates) { showToast('La categoria è ancora utilizzata da documenti o template.'); return; }
  if (!confirm(`Eliminare la categoria “${name}”?`)) return;
  state.categories = state.categories.filter(category => category.name !== name);
  delete state.counters[name];
  writeStorage(STORAGE_KEYS.categories, state.categories);
  writeStorage(STORAGE_KEYS.counters, state.counters);
  refreshCategoryOptions();
  renderSettings();
  showToast('Categoria eliminata.');
}
function syncEditorValue(editorId, inputId) {
  const editor = document.getElementById(editorId);
  const content = editor?.value || editor?.innerHTML || '';
  document.getElementById(inputId).value = sanitizeRichHtml(String(content).trim());
}
function setRichEditorContent(editorId, html = '') {
  const editor = document.getElementById(editorId);
  const safeHtml = sanitizeRichHtml(html || '');
  if (editor) editor.value = safeHtml;
}
function positionSelectedEditorImage(editor, position) {
  const node = editor.selection.getNode();
  const image = node?.nodeType === Node.ELEMENT_NODE && (node.matches('img') ? node : node.closest('img'));
  if (!image) { showToast('Seleziona prima un’immagine.'); return; }
  image.classList.add('editor-image');
  makeImageDraggable(editor.getBody(), image, editor);
  image.style.position = 'absolute';
  image.style.right = 'auto';
  image.style.transform = 'none';
  image.style.top = image.style.top || '1rem';
  if (position === 'center') {
    image.style.left = '50%';
    image.style.transform = 'translateX(-50%)';
  } else if (position === 'right') {
    image.style.left = 'auto';
    image.style.right = '1rem';
  } else {
    image.style.left = '1rem';
  }
  image.dataset.imagePosition = position;
  editor.nodeChanged();
  editor.save();
}
function initGoogleDocsLegacyEditor() {
  if (typeof googleDocsLegacy === 'undefined' || typeof googleDocsLegacy.init !== 'function') return;
  const configuredMargins = normalizePageMargins(state.pageMargins);
  googleDocsLegacy.init({
    selector: '.google-docs-legacy-editor',
    plugins: 'advlist autolink lists link image table charmap preview anchor searchreplace wordcount code fullscreen importcss pagebreak',
    toolbar: 'undo redo | styles | fontfamily fontsize | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | table image imageleft imagecenter imageright link unlink | pagebreak | preview fullscreen code | removeformat',
    toolbar_mode: 'floating',
    menubar: false,
    statusbar: false,
    height: 'calc(100vh - 280px)',
    min_height: 580,
    max_height: 780,
    branding: false,
    resize: true,
    default_link_target: '_blank',
    font_family_formats: 'Georgia=Georgia;Raleway=Raleway;Pinyon Script=Pinyon Script;Times New Roman=Times New Roman;Arial=Arial;Helvetica=Helvetica;Verdana=Verdana;Tahoma=Tahoma;Trebuchet MS=Trebuchet MS;Courier New=Courier New;Lucida Console=Lucida Console;Garamond=Garamond;Palatino Linotype=Palatino Linotype;Book Antiqua=Book Antiqua;Impact=Impact;Comic Sans MS=Comic Sans MS',
    font_size_formats: '8pt 9pt 10pt 11pt 12pt 14pt 16pt 18pt 20pt 24pt 28pt 32pt 36pt 42pt 48pt 56pt 64pt 72pt 84pt 96pt',
    pagebreak_separator: '<div class="page-break"><span class="page-break-label">↧ pagina successiva</span></div>',
    importcss_append: true,
    content_css: ['https://cdn.jsdelivr.net/npm/@fontsource/raleway@5.1.1/400.css', 'https://cdn.jsdelivr.net/npm/@fontsource/pinyon-script@5.1.1/400.css'],
    content_style: `body { position: relative; padding: ${configuredMargins.top}mm ${configuredMargins.right}mm ${configuredMargins.bottom}mm ${configuredMargins.left}mm; font-family: 'Raleway', Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.55; min-height: 297mm; width: 210mm; max-width: 210mm; margin: 0 auto; box-sizing: border-box; background: repeating-linear-gradient(90deg, transparent 0, transparent 14px, rgba(166,64,45,.035) 14px, rgba(166,64,45,.035) 15px), #fffdfb; border-left: 2px solid #a6402d; border-right: 2px solid #a6402d; box-shadow: inset 0 0 0 1px rgba(166,64,45,.08), inset -6px 0 0 rgba(166,64,45,.06), inset 6px 0 0 rgba(166,64,45,.06); } img { max-width: 100%; height: auto; } img.editor-image { position: absolute !important; z-index: 2 !important; margin: 0; cursor: grab; user-select: none; } img.editor-image.is-dragging { cursor: grabbing; opacity: .78; } img.editor-image.is-resizing { cursor: nwse-resize; opacity: .82; } table { border-collapse: collapse; max-width: 100%; } td { border: 1px solid #aeb7bf; padding: .5rem; } .page-break { page-break-before: always; position: relative; min-height: 32px; height: 32px; line-height: 32px; border-top: 2px dashed #a6402d; color: #a6402d; font-family: 'Pinyon Script', 'Raleway', serif; font-size: 22px; letter-spacing: .04em; text-align: center; margin: 24px 0; background: repeating-linear-gradient(90deg, transparent, transparent 10px, rgba(166,64,45,.08) 10px, rgba(166,64,45,.08) 11px); } .page-break::before { content: '↧ pagina successiva'; display: inline-block; padding: 0 1rem; background: #fffdfb; color: #a6402d; font-family: 'Pinyon Script', 'Raleway', serif; font-size: 22px; } .page-break-label { display: none; }`,
    setup(editor) {
      editor.ui.registry.addButton('imageleft', { text: 'Sinistra', tooltip: 'Posiziona immagine a sinistra', onAction: () => positionSelectedEditorImage(editor, 'left') });
      editor.ui.registry.addButton('imagecenter', { text: 'Centro', tooltip: 'Centra immagine', onAction: () => positionSelectedEditorImage(editor, 'center') });
      editor.ui.registry.addButton('imageright', { text: 'Destra', tooltip: 'Posiziona immagine a destra', onAction: () => positionSelectedEditorImage(editor, 'right') });
      editor.on('init', function () {
        const body = editor.getBody();
        if (body) body.style.padding = `${configuredMargins.top}mm ${configuredMargins.right}mm ${configuredMargins.bottom}mm ${configuredMargins.left}mm`;
        body.style.minHeight = '297mm';
        body.style.width = '210mm';
        body.style.maxWidth = '210mm';
        body.style.boxSizing = 'border-box';
        makeEditorImagesDraggable(body, editor);
      });
      editor.on('SetContent NodeChange', () => makeEditorImagesDraggable(editor.getBody(), editor));
      editor.on('change', () => { editor.save(); });
    }
  });
}
function applyPageMargins() {
  const margins = normalizePageMargins(state.pageMargins);
  state.pageMargins = margins;
  document.querySelectorAll('.rich-editor').forEach(editor => { editor.style.padding = `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`; });
  if (typeof googleDocsLegacy !== 'undefined') {
    document.querySelectorAll('.google-docs-legacy-editor').forEach(editor => {
      const instance = googleDocsLegacy.get(editor.id);
      if (instance) {
        const body = instance.getBody();
        if (body) body.style.padding = `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`;
      }
    });
  }
}
function editorHistory(editor) {
  let history = editorHistories.get(editor);
  if (!history) { history = { past: [], present: editor.innerHTML, future: [] }; editorHistories.set(editor, history); }
  return history;
}
function resetEditorHistory(editor) {
  if (!editor) return;
  editorHistories.set(editor, { past: [], present: editor.innerHTML, future: [] });
  makeEditorImagesDraggable(editor);
}
function recordEditorChange(editor) {
  if (!editor || editor.dataset.historyApplying === 'true') return;
  const history = editorHistory(editor);
  const current = editor.innerHTML;
  if (current === history.present) return;
  history.past.push(history.present);
  if (history.past.length > 100) history.past.shift();
  history.present = current; history.future = [];
}
function restoreEditorHtml(editor, html) {
  const history = editorHistory(editor);
  editor.dataset.historyApplying = 'true'; editor.innerHTML = html; delete editor.dataset.historyApplying;
  history.present = html; saveEditorSelection(editor);
  editor.querySelectorAll('.editor-image').forEach(image => makeImageDraggable(editor, image));
}
function undoEditorChange(editor) {
  const history = editorHistory(editor); if (!history.past.length) return;
  history.future.push(history.present); restoreEditorHtml(editor, history.past.pop());
}
function redoEditorChange(editor) {
  const history = editorHistory(editor); if (!history.future.length) return;
  history.past.push(history.present); restoreEditorHtml(editor, history.future.pop());
}
function deleteSelectedImage(control) {
  const editor = editorFromControl(control);
  const image = selectedEditorImage && editor?.contains(selectedEditorImage) ? selectedEditorImage : editor?.querySelector('.editor-image.is-selected');
  if (!image) { showToast('Seleziona prima un’immagine.'); return; }
  image.remove(); selectedEditorImage = null; recordEditorChange(editor);
}
function makeImageDraggable(editor, image, tinyEditor = null) {
  if (!editor || !image || image.dataset.dragReady === 'true') return;
  image.dataset.dragReady = 'true'; image.draggable = false; image.contentEditable = 'false';
  image.style.position = 'absolute'; image.style.zIndex = '2';
  const ownerDocument = editor.ownerDocument || document;
  const selectImage = () => {
    editor.querySelectorAll('.editor-image.is-selected').forEach(item => item.classList.remove('is-selected'));
    image.classList.add('is-selected'); selectedEditorImage = image;
    if (tinyEditor) {
      tinyEditor.selection.select(image);
      tinyEditor.nodeChanged();
    } else {
      const selection = ownerDocument.getSelection();
      const range = ownerDocument.createRange();
      range.selectNode(image); selection.removeAllRanges(); selection.addRange(range);
    }
  };
  if (!image.style.left) image.style.left = '1rem';
  if (!image.style.top) image.style.top = '1rem';
  const getResizeEdge = event => {
    const box = image.getBoundingClientRect();
    const edge = 10;
    const onLeft = event.clientX - box.left <= edge;
    const onRight = box.right - event.clientX <= edge;
    const onTop = event.clientY - box.top <= edge;
    const onBottom = box.bottom - event.clientY <= edge;
    if (onTop && onLeft) return 'nw';
    if (onTop && onRight) return 'ne';
    if (onBottom && onLeft) return 'sw';
    if (onBottom && onRight) return 'se';
    if (onLeft) return 'w';
    if (onRight) return 'e';
    if (onTop) return 'n';
    if (onBottom) return 's';
    return '';
  };
  image.addEventListener('pointermove', event => {
    if (image.classList.contains('is-resizing')) return;
    const edge = getResizeEdge(event);
    image.style.cursor = edge ? ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[edge]) : 'grab';
  });
  image.addEventListener('pointerdown', event => {
    event.preventDefault(); event.stopPropagation();
    selectImage();
    if (event.button !== 0) return;
    const editorBox = editor.getBoundingClientRect(); const imageBox = image.getBoundingClientRect();
    const normalizedLeft = imageBox.left - editorBox.left + editor.scrollLeft;
    const normalizedTop = imageBox.top - editorBox.top + editor.scrollTop;
    image.style.right = 'auto'; image.style.transform = 'none';
    image.style.left = `${Math.max(0, normalizedLeft)}px`;
    image.style.top = `${Math.max(0, normalizedTop)}px`;
    image.setPointerCapture?.(event.pointerId);
    const normalizedImageBox = image.getBoundingClientRect();
    const edge = getResizeEdge(event);
    if (edge) {
      const ratio = normalizedImageBox.width / Math.max(normalizedImageBox.height, 1);
      const startWidth = normalizedImageBox.width;
      const startHeight = normalizedImageBox.height;
      const startLeft = normalizedImageBox.left - editorBox.left + editor.scrollLeft;
      const startTop = normalizedImageBox.top - editorBox.top + editor.scrollTop;
      const startX = event.clientX;
      const startY = event.clientY;
      const resize = resizeEvent => {
        let nextWidth = startWidth;
        let nextHeight = startHeight;
        if (edge.includes('e')) nextWidth = startWidth + resizeEvent.clientX - startX;
        if (edge.includes('w')) nextWidth = startWidth - (resizeEvent.clientX - startX);
        if (edge.includes('s')) nextHeight = startHeight + resizeEvent.clientY - startY;
        if (edge.includes('n')) nextHeight = startHeight - (resizeEvent.clientY - startY);
        const horizontalChange = Math.abs(nextWidth - startWidth);
        const verticalChange = Math.abs(nextHeight - startHeight);
        if (edge.length === 1 && (edge === 'e' || edge === 'w')) nextHeight = nextWidth / ratio;
        else if (edge.length === 1 && (edge === 'n' || edge === 's')) nextWidth = nextHeight * ratio;
        else if (horizontalChange >= verticalChange) nextHeight = nextWidth / ratio;
        else nextWidth = nextHeight * ratio;
        const minWidth = 40;
        const maxWidth = Math.max(minWidth, editorBox.width - 2);
        nextWidth = Math.max(minWidth, Math.min(nextWidth, maxWidth));
        nextHeight = nextWidth / ratio;
        image.style.width = `${nextWidth}px`;
        image.style.height = 'auto';
        image.style.maxWidth = 'none';
        if (edge.includes('w')) image.style.left = `${Math.max(0, startLeft + (startWidth - nextWidth))}px`;
        if (edge.includes('n')) image.style.top = `${Math.max(0, startTop + (startHeight - nextHeight))}px`;
      };
      image.style.cursor = ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[edge]);
      image.classList.add('is-resizing');
      ownerDocument.addEventListener('pointermove', resize);
      const stopResize = () => { image.classList.remove('is-resizing'); recordEditorChange(editor); tinyEditor?.save(); ownerDocument.removeEventListener('pointermove', resize); ownerDocument.removeEventListener('pointerup', stopResize); };
      ownerDocument.addEventListener('pointerup', stopResize, { once: true });
      return;
    }
    {
      const startX = event.clientX; const startY = event.clientY;
      const startLeft = normalizedImageBox.left - editorBox.left + editor.scrollLeft; const startTop = normalizedImageBox.top - editorBox.top + editor.scrollTop;
      image.classList.add('is-dragging');
      const move = moveEvent => {
        image.style.left = `${Math.max(0, startLeft + moveEvent.clientX - startX)}px`;
        image.style.top = `${Math.max(0, startTop + moveEvent.clientY - startY)}px`;
      };
      const stop = () => { image.classList.remove('is-dragging'); recordEditorChange(editor); tinyEditor?.save(); ownerDocument.removeEventListener('pointermove', move); ownerDocument.removeEventListener('pointerup', stop); };
      ownerDocument.addEventListener('pointermove', move); ownerDocument.addEventListener('pointerup', stop, { once: true });
    }
  });
  image.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); selectImage(); });
}
function makeEditorImagesDraggable(editor, tinyEditor = null) { editor?.querySelectorAll('img').forEach(image => { image.classList.add('editor-image'); makeImageDraggable(editor, image, tinyEditor); }); }

function renderDocumentLibraryList() {
  const list = document.getElementById('documentLibraryList');
  if (!list) return;
  if (!state.documents?.length) {
    list.innerHTML = '<p class="text-secondary small mb-0">Nessun documento presente.</p>';
    return;
  }
  list.innerHTML = state.documents.slice(0, 18).map(document => `<button type="button" class="document-library-item" data-open-document="${escapeHtml(document.id)}">
    <span class="document-library-code">${escapeHtml(documentCode(document))}</span>
    <span class="document-library-title">${escapeHtml(document.title)}</span>
    <span class="document-library-meta">${escapeHtml(document.category)}</span>
  </button>`).join('');
}

function editorFromControl(control) { return control.closest('.modal-content')?.querySelector('.rich-editor'); }
function saveEditorSelection(editor) {
  const selection = window.getSelection();
  if (!selection.rangeCount || !editor?.contains(selection.anchorNode)) return;
  savedEditorRange = selection.getRangeAt(0).cloneRange();
}
function restoreEditorSelection(editor) {
  if (!editor || !savedEditorRange || !editor.contains(savedEditorRange.commonAncestorContainer)) return false;
  const rangeToRestore = savedEditorRange.cloneRange();
  editor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(rangeToRestore);
  savedEditorRange = rangeToRestore.cloneRange();
  return true;
}
function executeEditorCommand(control, value = null) {
  const editor = editorFromControl(control);
  restoreEditorSelection(editor);
  document.execCommand(control.dataset.editorCommand, false, value ?? control.value ?? null);
  saveEditorSelection(editor); recordEditorChange(editor);
}
function applyPixelFontSize(control) {
  const editor = editorFromControl(control);
  if (!editor) return;
  const size = Math.min(96, Math.max(8, Number.parseInt(control.value, 10) || 16));
  control.value = String(size);
  if (!restoreEditorSelection(editor)) { showToast('Seleziona il testo da ridimensionare.'); return; }
  const selection = window.getSelection();
  if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed) { showToast('Seleziona il testo da ridimensionare.'); return; }
  const span = document.createElement('span');
  span.style.fontSize = `${size}px`;
  span.appendChild(range.extractContents());
  range.insertNode(span);
  const selectedRange = document.createRange();
  selectedRange.selectNodeContents(span);
  selection.removeAllRanges();
  selection.addRange(selectedRange);
  saveEditorSelection(editor); recordEditorChange(editor);
}
function syncFontSizeControl(editor) {
  const selection = window.getSelection();
  if (!editor || !selection.rangeCount || !editor.contains(selection.anchorNode)) return;
  const control = editor.parentElement?.querySelector('[data-editor-command="fontSizePx"]');
  if (!control) return;
  const node = selection.getRangeAt(0).startContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const size = Number.parseFloat(window.getComputedStyle(element).fontSize);
  if (Number.isFinite(size)) control.value = String(Math.round(size));
}
function insertTable(editor) {
  const rows = Math.max(1, Number.parseInt(prompt('Numero di righe', '2'), 10) || 2);
  const columns = Math.max(1, Number.parseInt(prompt('Numero di colonne', '2'), 10) || 2);
  const table = document.createElement('table');
  table.className = 'document-table';
  table.innerHTML = `<tbody>${Array.from({ length: rows }, () => `<tr>${Array.from({ length: columns }, () => '<td>Scrivi qui</td>').join('')}</tr>`).join('')}</tbody>`;
  restoreEditorSelection(editor);
  document.execCommand('insertHTML', false, table.outerHTML); recordEditorChange(editor);
}
function insertImage(editor, position = 'cursor') {
  if (!editor) return;
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = 'image/*'; picker.hidden = true;
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0]; if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const image = document.createElement('img');
    image.src = dataUrl; image.alt = file.name; image.className = 'editor-image';
    image.dataset.imagePosition = position;
    image.style.maxWidth = '100%'; image.style.height = 'auto'; image.style.display = 'block'; image.style.position = 'absolute'; image.style.left = '1rem'; image.style.top = `${editor.scrollTop + 16}px`; image.style.position = 'absolute'; image.style.left = '1rem'; image.style.top = `${editor.scrollTop + 1}rem`;
    const range = savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer) ? savedEditorRange.cloneRange() : null;
    if (position === 'above') { editor.insertBefore(image, editor.firstChild); }
    else if (position === 'below') { editor.appendChild(image); }
    else if (range) {
      restoreEditorSelection(editor); range.deleteContents(); range.insertNode(image);
      const after = document.createRange(); after.setStartAfter(image); after.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(after);
    } else { editor.appendChild(image); }
    makeImageDraggable(editor, image); saveEditorSelection(editor); recordEditorChange(editor); picker.remove();
  });
  document.body.appendChild(picker); picker.click();
}
function organizeDocumentEditor() {
  const row = document.querySelector('#documentModal .modal-body > .row');
  if (!row || row.querySelector('.document-sidebar')) return;
  const sidebar = document.createElement('aside');
  const canvas = document.createElement('section');
  sidebar.className = 'document-sidebar';
  canvas.className = 'document-canvas';
  [...row.children].forEach(element => {
    const belongsToCanvas = element.querySelector('#googleDocumentEditorPanel');
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
    ['Georgia', 'Georgia'], ['Raleway', 'Raleway'], ['Pinyon Script', 'Pinyon Script'], ['Times New Roman', 'Times New Roman'], ['Arial', 'Arial'],
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
  document.body.insertAdjacentHTML('beforeend', `<div class="modal fade" id="registrationRequestModal" tabindex="-1" aria-hidden="true"><div class="modal-dialog"><div class="modal-content"><form id="registrationRequestForm"><div class="modal-header"><h2 class="modal-title h5">Richiedi registrazione</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button></div><div class="modal-body"><p class="text-secondary small">La richiesta sarà esaminata dall'amministratore principale.</p><div id="registrationRequestAlert" class="alert d-none" role="alert"></div><div class="mb-3"><label for="registrationDisplayName" class="form-label">Nome e cognome</label><input id="registrationDisplayName" class="form-control" required maxlength="160"></div><div class="mb-3"><label for="registrationEmail" class="form-label">Indirizzo e-mail</label><input id="registrationEmail" class="form-control" type="email" required maxlength="190"></div><div><label for="registrationPassword" class="form-label">Password</label><input id="registrationPassword" class="form-control" type="password" minlength="8" required><div class="form-text">Almeno 8 caratteri.</div></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Annulla</button><button class="btn btn-primary" type="submit">Invia richiesta</button></div></form></div></div></div><div class="modal fade" id="recoveryRequestModal" tabindex="-1" aria-hidden="true"><div class="modal-dialog"><div class="modal-content"><form id="recoveryRequestForm"><div class="modal-header"><h2 class="modal-title h5">Recupera password</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button></div><div class="modal-body"><p class="text-secondary small">La richiesta viene inoltrata all'amministratore principale, che autorizzerà una nuova password.</p><div id="recoveryRequestAlert" class="alert d-none" role="alert"></div><label for="recoveryEmail" class="form-label">Indirizzo e-mail</label><input id="recoveryEmail" class="form-control" type="email" required maxlength="190"><div id="recoveryPasswordFields" class="d-none mt-3"><div class="mb-3"><label for="recoveryNewPassword" class="form-label">Nuova password</label><input id="recoveryNewPassword" class="form-control" type="password" minlength="8" autocomplete="new-password"></div><label for="recoveryPasswordConfirmation" class="form-label">Conferma nuova password</label><input id="recoveryPasswordConfirmation" class="form-control" type="password" minlength="8" autocomplete="new-password"></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Annulla</button><button id="recoverySubmitButton" class="btn btn-primary" type="submit">Invia richiesta</button></div></form></div></div></div>`);
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
    const payload = await apiRequest('request_registration', { method: 'POST', body: JSON.stringify({ displayName, email, password }) }).catch(error => { if (!error.backendUnavailable) throw error; return localRequestRegistration(displayName, email, password); });
    showRequestFeedback('registrationRequestAlert', payload.message || 'Richiesta inviata.');
    event.target.reset();
  } catch (error) { localSecurityLog('registration_request_failed', 'warning', { message: error.message }); showRequestFeedback('registrationRequestAlert', error.message, 'danger'); }
}

async function submitRecoveryRequest(event) {
  event.preventDefault();
  try {
    const emailInput = document.getElementById('recoveryEmail');
    const email = emailInput.value.trim().toLowerCase();
    const passwordFields = document.getElementById('recoveryPasswordFields');
    const completing = !passwordFields.classList.contains('d-none');
    if (completing) {
      const password = document.getElementById('recoveryNewPassword').value;
      const confirmation = document.getElementById('recoveryPasswordConfirmation').value;
      if (password.length < 8) throw new Error('La nuova password deve contenere almeno 8 caratteri.');
      if (password !== confirmation) throw new Error('Le password non coincidono.');
      const payload = await apiRequest('complete_password_reset', { method: 'POST', body: JSON.stringify({ email, password }) }).catch(error => { if (!error.backendUnavailable) throw error; return localCompletePasswordReset(email, password); });
      showRequestFeedback('recoveryRequestAlert', payload.message || 'Password aggiornata.');
      passwordFields.classList.add('d-none');
      emailInput.readOnly = false;
      document.getElementById('recoveryNewPassword').required = false;
      document.getElementById('recoveryPasswordConfirmation').required = false;
      document.getElementById('recoverySubmitButton').textContent = 'Invia richiesta';
      event.target.reset();
      return;
    }
    const payload = await apiRequest('request_password_reset', { method: 'POST', body: JSON.stringify({ email }) }).catch(error => { if (!error.backendUnavailable) throw error; return localRequestReset(email); });
    showRequestFeedback('recoveryRequestAlert', payload.message || 'Richiesta inviata.');
    if (payload.requiresPassword) {
      passwordFields.classList.remove('d-none');
      emailInput.readOnly = true;
      document.getElementById('recoveryNewPassword').required = true;
      document.getElementById('recoveryPasswordConfirmation').required = true;
      document.getElementById('recoverySubmitButton').textContent = 'Salva nuova password';
    }
  } catch (error) { localSecurityLog('password_reset_request_failed', 'warning', { message: error.message }); showRequestFeedback('recoveryRequestAlert', error.message, 'danger'); }
}

function canAccessManagement() { return capable('users.view') || capable('roles.view'); }

/*
 * Area "Impostazioni": raggruppa in una sotto-navigazione dedicata le sezioni
 * di configurazione e amministrazione. Le voci compaiono solo se l'utente ha
 * la capacità corrispondente; la voce "Impostazioni" della navbar principale
 * resta visibile se almeno una sezione dell'area è accessibile.
 */
const SETTINGS_SECTIONS = [
  { view: 'settings', label: 'Impostazioni', icon: 'bi-sliders' },
  { view: 'tools', label: 'Tools', icon: 'bi-tools' },
  { view: 'trash', label: 'Cestino', icon: 'bi-trash3' },
  { view: 'securityLogs', label: 'Log di sicurezza', icon: 'bi-shield-lock' },
  { view: 'access', label: 'Utenti e permessi', icon: 'bi-people' }
];
function isSettingsSection(view) { return SETTINGS_SECTIONS.some(section => section.view === view); }
function canAccessSettingsSection(view) {
  if (view === 'trash') return hasTrashAccess();
  if (view === 'access') return canAccessManagement();
  return capable({ settings: 'settings.view', tools: 'tools.view', securityLogs: 'security_logs.view' }[view] || 'settings.view');
}
function canAccessSettingsArea() { return SETTINGS_SECTIONS.some(section => canAccessSettingsSection(section.view)); }
function firstAccessibleSettingsSection() { return SETTINGS_SECTIONS.find(section => canAccessSettingsSection(section.view))?.view || 'dashboard'; }
function ensureSettingsSubnav() {
  SETTINGS_SECTIONS.forEach(({ view }) => {
    const section = document.getElementById(`${view}View`);
    if (!section || section.querySelector('.settings-subnav')) return;
    const nav = document.createElement('nav');
    nav.className = 'settings-subnav nav nav-pills mb-4';
    nav.setAttribute('aria-label', 'Sezioni di configurazione');
    nav.innerHTML = SETTINGS_SECTIONS.map(item => `<a class="nav-link" href="#${item.view}" data-settings-subnav="${item.view}"><i class="bi ${item.icon} me-1" aria-hidden="true"></i>${item.label}</a>`).join('');
    section.prepend(nav);
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', event => { event.preventDefault(); setView(link.dataset.settingsSubnav); }));
  });
}
function refreshSettingsSubnav(activeView = null) {
  // La voce attiva si deduce dalla sezione realmente visibile: è l'unica
  // fonte affidabile qualunque sia l'ordine delle chiamate (applyPermissions,
  // setView, refresh asincroni).
  const visible = document.querySelector('.app-view:not(.d-none)')?.id?.replace(/View$/, '');
  const view = activeView || visible || currentHashView();
  document.querySelectorAll('[data-settings-subnav]').forEach(link => {
    link.classList.toggle('active', link.dataset.settingsSubnav === view);
    link.classList.toggle('d-none', !canAccessSettingsSection(link.dataset.settingsSubnav));
  });
}

function ensureUserManagementCard() {
  if (!canAccessManagement() || document.getElementById('userManagementCard')) return;
  const appContainer = document.querySelector('#appView > .container-fluid');
  if (!document.getElementById('accessView')) appContainer.insertAdjacentHTML('beforeend', '<section id="accessView" class="app-view d-none"><div class="mb-4"><p class="eyebrow text-secondary mb-2">Amministrazione</p><h1 class="display-6 fw-bold mb-2">Utenti e permessi</h1><p class="text-secondary mb-0">Crea ruoli, assegna capacità e gestisci gli accessi.</p></div><div id="accessManagementContainer"></div></section>');
  const accessContainer = document.getElementById('accessManagementContainer');
  if (accessContainer) accessContainer.insertAdjacentHTML('beforeend', '<div class="card border-0 shadow-sm" id="userManagementCard"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-center gap-3 mb-3"><div><h2 class="h5 mb-1">Gestione accessi</h2><p class="text-secondary small mb-0">Approva registrazioni, autorizza recuperi e gestisci gli accessi.</p></div><button type="button" class="btn btn-outline-primary btn-sm" id="refreshUsersButton">Aggiorna</button></div><div id="userManagementContent"></div></div></div>');
}

function renderUserManagement(data) {
  data.roles = (data.roles || []).filter(role => !['guest', 'reader', 'editor'].includes(role.role_key || role.roleKey));
  ensureUserManagementCard();
  const content = document.getElementById('userManagementContent');
  if (!content) return;
  const users = data.users.map(user => `<tr><td>${escapeHtml(user.displayName)}</td><td>${escapeHtml(user.username)}</td><td><select class="form-select form-select-sm user-role-select" data-user-id="${user.id}" ${user.isPrimaryAdmin || !capable('users.change_role') ? 'disabled' : ''}><option value="reader" ${user.role === 'reader' ? 'selected' : ''}>Lettore</option><option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Redattore</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Amministratore</option></select></td><td>${user.isPrimaryAdmin ? '<span class="badge text-bg-primary">Principale</span>' : capable('users.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger delete-user-button" data-user-id="${user.id}">Elimina</button>` : '—'}</td></tr>`).join('');
  const deletedUsers = (data.deletedUsers || []).map(user => `<tr><td>${escapeHtml(user.displayName)}</td><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.role || '—')}</td><td class="small text-secondary">${escapeHtml(formatDateTime(user.deletedAt))}</td><td class="text-end"><div class="d-flex justify-content-end flex-wrap gap-2">${capable('users.restore') ? `<button type="button" class="btn btn-sm btn-outline-primary restore-user-button" data-user-id="${user.id}">Ripristina</button>` : ''}${capable('users.purge') ? `<button type="button" class="btn btn-sm btn-outline-danger purge-user-button" data-user-id="${user.id}">Elimina definitivamente</button>` : ''}</div></td></tr>`).join('');
  const registrations = data.registrations.length ? data.registrations.map(item => `<div class="border-bottom py-2 d-flex flex-wrap align-items-center justify-content-between gap-2"><span><strong>${escapeHtml(item.display_name)}</strong><small class="d-block text-secondary">${escapeHtml(item.email)}</small></span><span class="d-flex gap-2"><select class="form-select form-select-sm registration-role" data-request-id="${item.id}" aria-label="Ruolo richiesto"><option value="reader">Lettore</option><option value="editor">Redattore</option></select>${capable('registrations.approve') ? `<button type="button" class="btn btn-sm btn-primary approve-registration-button" data-request-id="${item.id}">Approva</button>` : ''}${capable('registrations.reject') ? `<button type="button" class="btn btn-sm btn-outline-danger reject-registration-button" data-request-id="${item.id}">Rifiuta</button>` : ''}</span></div>`).join('') : '<p class="text-secondary small mb-0">Nessuna richiesta di registrazione.</p>';
  const resets = data.resets.length ? data.resets.map(item => `<div class="border-bottom py-2 d-flex flex-wrap align-items-center justify-content-between gap-2"><span><strong>${escapeHtml(item.email)}</strong><small class="d-block text-secondary">Richiesta di recupero</small></span>${capable('password_resets.approve') ? `<button type="button" class="btn btn-sm btn-primary approve-reset-button" data-request-id="${item.id}">Approva richiesta</button>` : ''}</div>`).join('') : '<p class="text-secondary small mb-0">Nessuna richiesta di recupero.</p>';
  content.innerHTML = `<h3 class="h6">Utenti attivi</h3><div class="table-responsive mb-4"><table class="table align-middle"><thead><tr><th>Nome</th><th>E-mail</th><th>Ruolo</th><th>Azioni</th></tr></thead><tbody>${users}</tbody></table></div><h3 class="h6">Utenti nel cestino</h3><p class="small text-secondary">Gli account eliminati non possono accedere. Puoi ripristinarli oppure rimuoverli in modo definitivo.</p><div class="table-responsive mb-4"><table class="table align-middle"><thead><tr><th>Nome</th><th>E-mail</th><th>Ruolo</th><th>Eliminato il</th><th class="text-end">Azioni</th></tr></thead><tbody>${deletedUsers || '<tr><td colspan="5" class="text-secondary">Nessun utente nel cestino.</td></tr>'}</tbody></table></div><div class="row g-4"><div class="col-12 col-xl-6"><h3 class="h6">Richieste di registrazione</h3>${registrations}</div><div class="col-12 col-xl-6"><h3 class="h6">Recuperi password</h3>${resets}</div></div>`;
  content.querySelectorAll('.user-role-select').forEach(select => { const user = data.users.find(item => String(item.id) === select.dataset.userId); select.innerHTML = data.roles.filter(role => currentUser?.isPrimaryAdmin || (role.role_key || role.roleKey) !== 'admin').map(role => `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join(''); select.value = user?.roleId || ''; });
  content.querySelectorAll('.registration-role').forEach(select => { select.innerHTML = data.roles.filter(role => (currentUser?.isPrimaryAdmin || (role.role_key || role.roleKey) !== 'admin') && !role.isPrimaryAdmin && !role.is_primary_admin).map(role => `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join(''); });
  const capabilityCatalog = capable('roles.view') ? (data.capabilities || []) : [];
  const capabilityGroups = [...new Set(capabilityCatalog.map(capability => capability.capability_group))];
  const roleCards = data.roles.filter(role => role.role_key !== 'admin' && role.roleKey !== 'admin').map(role => {
    const selected = new Set((data.roleCapabilities || []).filter(item => String(item.role_id) === String(role.id) && Number(item.allowed) !== 0).map(item => item.capability_key));
    return `<div class="border rounded p-3 mb-3 capability-role-card"><div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><div><strong>${escapeHtml(role.name)}</strong>${role.isSystem || role.is_system ? '<small class="d-block text-secondary">Ruolo di sistema</small>' : ''}<small class="d-block text-secondary">${selected.size} capacità assegnate</small></div><div class="d-flex gap-2">${capable('roles.edit_permissions') ? `<button type="button" class="btn btn-sm btn-outline-secondary select-role-capabilities" data-role-id="${role.id}">Seleziona tutte</button><button type="button" class="btn btn-sm btn-outline-secondary clear-role-capabilities" data-role-id="${role.id}">Deseleziona</button><button type="button" class="btn btn-sm btn-primary save-role-capabilities" data-role-id="${role.id}">Salva capacità</button>` : ''}${capable('roles.delete') && !(role.isSystem || role.is_system) ? `<button type="button" class="btn btn-sm btn-outline-danger delete-role-button" data-role-id="${role.id}" data-role-name="${escapeHtml(role.name)}">Elimina ruolo</button>` : ''}</div></div><div class="accordion" id="capabilities-${role.id}">${capabilityGroups.map((group, groupIndex) => { const groupCapabilities = capabilityCatalog.filter(capability => capability.capability_group === group); return `<div class="accordion-item"><h4 class="accordion-header"><button class="accordion-button ${groupIndex ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#capability-group-${role.id}-${groupIndex}">${escapeHtml(group)} <span class="badge text-bg-light ms-2">${groupCapabilities.filter(capability => selected.has(capability.capability_key)).length}/${groupCapabilities.length}</span></button></h4><div id="capability-group-${role.id}-${groupIndex}" class="accordion-collapse collapse ${groupIndex ? '' : 'show'}"><div class="accordion-body py-2">${groupCapabilities.map(capability => `<label class="d-flex align-items-start gap-2 py-2 border-bottom"><input type="checkbox" class="form-check-input role-capability mt-1" data-role-id="${role.id}" value="${escapeHtml(capability.capability_key)}" ${!capable('roles.edit_permissions') ? 'disabled' : ''} ${selected.has(capability.capability_key) ? 'checked' : ''}><span><strong class="small">${escapeHtml(capability.label)}</strong><code class="d-block small">${escapeHtml(capability.capability_key)}</code></span>${Number(capability.is_dangerous) ? '<span class="badge text-bg-danger ms-auto">Critica</span>' : ''}</label>`).join('')}</div></div></div>`; }).join('')}</div></div>`;
  }).join('');
  content.insertAdjacentHTML('beforeend', `<hr class="my-4"><div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3"><div><h3 class="h6 mb-1">Ruoli e capacità specifiche</h3><p class="text-secondary small mb-0">Ogni casella corrisponde a una singola azione verificata anche dal server.</p></div>${capable('roles.create') ? `<div class="input-group" style="max-width: 24rem"><input id="newRoleName" class="form-control" placeholder="Nome nuovo ruolo"><button type="button" class="btn btn-outline-primary" id="createRoleButton">Crea ruolo</button></div>` : ''}</div>${roleCards}`);
}

async function refreshUserManagement() {
  if (!canAccessManagement()) return;
  ensureUserManagementCard();
  try { renderUserManagement(remoteMode ? await apiRequest('admin_data') : localAdminData()); } catch (error) { document.getElementById('userManagementContent').innerHTML = `<p class="text-danger small">${escapeHtml(error.message)}</p>`; }
}

async function userManagementAction(action, body, successMessage) {
  try {
    if (remoteMode) await apiRequest(action, { method: 'POST', body: JSON.stringify(body) });
    else {
      if (action === 'create_role') { const name = body.name.trim(); if (!name || localAuth.roles.some(role => role.name.toLowerCase() === name.toLowerCase())) throw new Error('Il nome ruolo è vuoto o già esistente.'); localAuth.roles.push({ id: crypto.randomUUID(), name, roleKey: `custom_${Date.now()}`, isSystem: false, permissions: {} }); }
      if (action === 'save_role_permissions') { const role = localAuth.roles.find(item => item.id === body.roleId); if (!role || role.roleKey === 'admin') throw new Error('Ruolo non modificabile.'); role.permissions = body.permissions; }
      if (action === 'save_role_capabilities') { const role = localAuth.roles.find(item => String(item.id) === String(body.roleId)); if (!role || role.roleKey === 'admin') throw new Error('Ruolo non modificabile.'); role.capabilities = body.capabilities; }
      if (action === 'delete_role') { const index = localAuth.roles.findIndex(item => String(item.id) === String(body.roleId)); const role = localAuth.roles[index]; if (!role || role.isSystem || role.roleKey === 'admin') throw new Error('Questo ruolo non può essere eliminato.'); if (localAuth.users.some(user => String(user.roleId) === String(role.id))) throw new Error('Il ruolo è assegnato a uno o più utenti. Assegna prima un altro ruolo a questi utenti.'); localAuth.roles.splice(index, 1); }
      if (action === 'approve_registration') { const request = localAuth.registrations.find(item => item.id === body.requestId); const role = localAuth.roles.find(item => item.id === body.roleId); if (!request || !role) throw new Error('Richiesta o ruolo non trovati.'); localAuth.users.push({ id: crypto.randomUUID(), username: request.email, displayName: request.displayName, roleId: role.id, isPrimaryAdmin: false, password: request.password }); request.status = 'approved'; }
      if (action === 'reject_registration') { const request = localAuth.registrations.find(item => item.id === body.requestId); if (request) request.status = 'rejected'; }
      if (action === 'approve_password_reset') { const request = localAuth.resets.find(item => item.id === body.requestId && item.status === 'pending'); if (!request) throw new Error('Richiesta non trovata.'); request.status = 'approved'; }
      if (action === 'change_user_role') { const user = localAuth.users.find(item => item.id === body.userId); const role = localAuth.roles.find(item => item.id === body.roleId); if (!user || !role || user.isPrimaryAdmin) throw new Error('Utente non modificabile.'); user.roleId = role.id; }
      if (action === 'delete_user') { const user = localAuth.users.find(item => item.id === body.userId); if (!user || user.isPrimaryAdmin) throw new Error('Utente non eliminabile.'); user.deletedAt = new Date().toISOString(); }
      if (action === 'restore_user') { const user = localAuth.users.find(item => item.id === body.userId); if (!user || user.isPrimaryAdmin || !user.deletedAt) throw new Error('Utente non ripristinabile.'); delete user.deletedAt; }
      if (action === 'purge_user') { const index = localAuth.users.findIndex(item => item.id === body.userId); const user = localAuth.users[index]; if (!user || user.isPrimaryAdmin || !user.deletedAt) throw new Error('Utente non eliminabile definitivamente.'); localAuth.users.splice(index, 1); }
      saveLocalAuth();
    }
    if (!remoteMode) localSecurityLog(action, action.includes('delete') || action.includes('purge') ? 'warning' : 'info', body);
    await refreshUserManagement(); showToast(successMessage);
  } catch (error) { showToast(error.message); }
}

function setView(view, pushState = true) {
  closeEditorToolbarMenus();
  // Dopo la scelta di una sezione richiude il menu sui dispositivi compatti,
  // lasciando subito tutto lo spazio disponibile al contenuto.
  const mobileNav = document.getElementById('mainNav');
  if (mobileNav?.classList.contains('show') && window.matchMedia('(max-width: 991.98px)').matches) {
    bootstrap.Collapse.getOrCreateInstance(mobileNav, { toggle: false }).hide();
  }
  if (canAccessManagement()) ensureUserManagementCard();
  ensureTrashView();
  ensureSettingsSubnav();
  if (isSettingsSection(view) && !canAccessSettingsSection(view)) {
    // Sezione dell'area impostazioni non permessa: si ripiega sulla prima
    // sezione accessibile dell'area, altrimenti sulla dashboard.
    view = view === 'settings' ? firstAccessibleSettingsSection() : (canAccessSettingsSection('settings') ? 'settings' : firstAccessibleSettingsSection());
  }
  if (!isSettingsSection(view) && view !== 'dashboard' && !can({ dashboard: 'documents', templates: 'templates', parties: 'parties', coalitions: 'parties', companies: 'companies', parliament: 'parliament', government: 'government', composition: 'composition', interpretations: 'interpretations', usefulLinks: 'useful_links', odg: 'odg' }[view] || 'documents')) view = 'dashboard';
  document.querySelectorAll('.editor-page').forEach(element => element.classList.add('d-none'));
  document.querySelectorAll('.app-view').forEach(element => element.classList.toggle('d-none', element.id !== `${view}View`));
  // La voce "Impostazioni" della navbar resta evidenziata in tutta l'area.
  document.querySelectorAll('[data-view-link]').forEach(link => link.classList.toggle('active', link.dataset.viewLink === view || (link.dataset.viewLink === 'settings' && isSettingsSection(view))));
  refreshSettingsSubnav(view);
  if (view === 'dashboard') renderDocuments();
  if (view === 'parties') renderParties();
  if (view === 'coalitions') renderCoalitions();
  if (view === 'companies') renderCompanies();
  if (view === 'parliament') renderParliaments();
  if (view === 'government') renderInstitution('government');
  if (view === 'composition') renderInstitution('composition');
  if (view === 'odg') renderOdg();
  if (view === 'interpretations') renderInterpretations();
  if (view === 'templates') renderTemplates();
  if (view === 'usefulLinks') renderUsefulLinks();
  // La sezione Tools vive in tools/app_tools.js: si invoca solo se il file è stato caricato.
  if (view === 'tools') window.renderTools?.();
  if (view === 'securityLogs') renderSecurityLogs();
  if (view === 'trash') renderTrash();
  if (view === 'settings') { renderSettings(); renderInstitutionSettings('government'); renderInstitutionSettings('composition'); renderInterpretationSettings(); }
  if (view === 'access') { ensureUserManagementCard(); refreshUserManagement(); }
  applyPermissions();
  if (pushState && window.location.hash !== '#' + view) {
    window.history.pushState({ view }, '', '#' + view);
  }
}

function closeEditorToolbarMenus() {
  document.activeElement?.blur();
  document.querySelectorAll('.tox-toolbar__overflow--open').forEach(menu => menu.classList.remove('tox-toolbar__overflow--open'));
  document.querySelectorAll('.tox-tbtn[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

let modalPageScrollY = 0;
function bindResponsiveModalScrolling() {
  document.addEventListener('show.bs.modal', event => {
    if (!window.matchMedia('(max-width: 991.98px)').matches || !event.target.classList.contains('modal')) return;
    modalPageScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${modalPageScrollY}px`;
    document.body.style.width = '100%';
  });
  document.addEventListener('hidden.bs.modal', () => {
    if (document.querySelector('.modal.show') || document.body.style.position !== 'fixed') return;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, modalPageScrollY);
  });
}

function showEditorScreen(screenId) {
  document.querySelectorAll('.app-view, .editor-page').forEach(element => element.classList.add('d-none'));
  document.getElementById(screenId).classList.remove('d-none');
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function ensureArchiveSearch(viewId, inputId, placeholder, targetId) {
  const view = document.getElementById(viewId);
  const target = document.getElementById(targetId);
  if (!view || !target || document.getElementById(inputId)) return;
  const insertionTarget = target.closest('tbody') ? target.closest('.card') : target;
  insertionTarget.insertAdjacentHTML('beforebegin', `<div class="archive-search-row mb-4"><div class="input-group search-box"><span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span><input id="${inputId}" data-archive-search="${viewId}" type="search" class="form-control" placeholder="${placeholder}"></div></div>`);
}
function archiveSearchValue(inputId) { return document.getElementById(inputId)?.value.trim().toLowerCase() || ''; }
function matchesArchiveSearch(values, query) { return !query || values.filter(Boolean).join(' ').toLowerCase().includes(query); }
function ensureMemberSearch(targetId, inputId, placeholder) {
  const target = document.getElementById(targetId);
  if (!target || document.getElementById(inputId)) return;
  target.insertAdjacentHTML('beforebegin', `<div class="mandate-member-search input-group mb-4"><span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span><input id="${inputId}" data-member-search="${targetId}" type="search" class="form-control" placeholder="${placeholder}"></div>`);
}

function closeEditorScreen() {
  document.querySelectorAll('.editor-page').forEach(element => element.classList.add('d-none'));
  setView('dashboard');
}

async function editDocumentNumber(id) {
  const item = state.documents.find(document => document.id === id);
  if (!item || !capable(item.category === 'ODG' ? 'odg.edit' : 'documents.change_number')) return;
  const value = window.prompt('Nuovo numero del documento', item.number);
  if (value === null) return;
  if (!/^\d+$/.test(value.trim()) || Number.parseInt(value, 10) < 1) { showToast('Inserisci un numero positivo.'); return; }
  const previous = item.number;
  item.number = padNumber(value.trim());
  writeStorage(STORAGE_KEYS.documents, state.documents);
  if (remoteMode) { clearTimeout(remoteSaveTimer); try { await saveRemoteState('documents'); } catch (error) { item.number = previous; showToast(error.message); return; } }
  renderDocuments();
  showToast('Numerazione del documento aggiornata.');
}

let securityLogsCache = null;
async function renderSecurityLogs(force = false) {
  const body = document.getElementById('securityLogsTableBody');
  if (!body || !capable('security_logs.view')) return;
  if (!force && securityLogsCache) { drawSecurityLogs(securityLogsCache); return; }
  body.innerHTML = '<tr><td colspan="5" class="text-secondary ps-4">Caricamento…</td></tr>';
  try {
    securityLogsCache = remoteMode ? (await apiRequest('security_logs')).logs : localAuth.logs;
    drawSecurityLogs(securityLogsCache);
  } catch (error) { body.innerHTML = `<tr><td colspan="5" class="text-danger ps-4">${escapeHtml(error.message)}</td></tr>`; }
}
function drawSecurityLogs(logs = []) {
  const query = archiveSearchValue('securityLogSearch');
  const filtered = logs.filter(log => matchesArchiveSearch([log.event_type, log.severity, log.username, log.ip_address, log.details], query));
  document.getElementById('securityLogsTableBody').innerHTML = filtered.map(log => `<tr><td class="ps-4 small">${escapeHtml(formatDateTime(log.created_at))}</td><td><span class="badge ${log.severity === 'critical' ? 'text-bg-danger' : log.severity === 'warning' ? 'text-bg-warning' : 'text-bg-secondary'}">${escapeHtml(log.severity)}</span></td><td>${escapeHtml(log.event_type)}</td><td>${escapeHtml(log.username || 'Sistema')}</td><td class="small text-break">${escapeHtml(typeof log.details === 'string' ? log.details : JSON.stringify(log.details || {}))}</td></tr>`).join('');
  document.getElementById('emptySecurityLogs').classList.toggle('d-none', filtered.length > 0);
}

function renderDocuments() {
  const query = document.getElementById('documentSearch').value.trim().toLowerCase();
  const documents = state.documents.filter(document => [document.title, document.category, document.number].join(' ').toLowerCase().includes(query)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const body = document.getElementById('documentTableBody');
  body.innerHTML = documents.map(document => `<tr class="document-row" data-open-document="${document.id}" tabindex="0" role="button"><td class="ps-4 fw-semibold">${escapeHtml(documentCode(document))}</td><td><strong>${escapeHtml(document.title)}</strong><small class="d-block text-secondary">${document.templateName ? `Template: ${escapeHtml(document.templateName)}` : 'Documento Google'}${document.googleModifiedTime ? ` · Modificato ${escapeHtml(formatDateTime(document.googleModifiedTime))}` : ''}</small></td><td><span class="badge text-bg-light">${escapeHtml(document.category)}</span>${document.category === 'ODG' ? ` <span class="badge ${document.status === 'valutato' ? 'text-bg-success' : 'text-bg-warning'}">${document.status === 'valutato' ? 'Valutato' : 'Da valutare'}</span>` : ''} <span class="badge ${document.publicationStatus === 'pubblicato' ? 'text-bg-success' : 'text-bg-secondary'}">${document.publicationStatus === 'pubblicato' ? 'Pubblicato' : 'Non pubblicato'}</span></td><td>${formatDate(document.date)}</td><td class="text-end pe-4"><div class="d-flex justify-content-end flex-wrap gap-2">${document.category === 'ODG' && capable('odg.change_evaluation') ? `<button type="button" class="btn btn-sm ${document.status === 'valutato' ? 'btn-outline-warning' : 'btn-outline-success'}" data-toggle-odg-status="${document.id}">${document.status === 'valutato' ? 'Segna da valutare' : 'Segna valutato'}</button>` : ''}${capable(document.category === 'ODG' ? 'odg.change_publication' : 'documents.change_publication') ? `<button type="button" class="btn btn-sm ${document.publicationStatus === 'pubblicato' ? 'btn-outline-warning' : 'btn-outline-success'}" data-toggle-publication-status="${document.id}">${document.publicationStatus === 'pubblicato' ? 'Segna non pubblicato' : 'Segna pubblicato'}</button>` : ''}${capable(document.category === 'ODG' ? 'odg.edit' : 'documents.change_number') ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-edit-document-number="${document.id}">Modifica numero</button>` : ''}${capable(document.category === 'ODG' ? 'odg.download_pdf' : 'documents.download_pdf') && document.googleDocumentId ? `<button class="btn btn-sm btn-primary" data-download-pdf="${document.id}">Scarica PDF</button>` : ''}${capable(document.category === 'ODG' ? 'odg.trash' : 'documents.trash') ? `<button class="btn btn-sm btn-outline-danger" data-trash-item="documents" data-entity-id="${document.id}">Cestino</button>` : ''}</div></td></tr>`).join('');
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
  const query = archiveSearchValue('odgSearch');
  const odgs = state.documents.filter(document => document.category === 'ODG' && matchesArchiveSearch([document.title, document.number, document.year, document.status], query)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  document.getElementById('odgGrid').innerHTML = odgs.map(odg => `<div class="col-12 col-md-6 col-xl-4"><article class="party-card odg-card card border-0 shadow-sm" data-open-document="${odg.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-2 mb-3"><h2 class="h5 mb-0">${escapeHtml(odg.title)}</h2><span class="badge ${odg.status === 'valutato' ? 'text-bg-success' : 'text-bg-warning'}">${odg.status === 'valutato' ? 'Valutato' : 'Da valutare'}</span></div><p class="text-secondary small mb-3">Creato il ${formatDate(odg.date)}</p><p class="card-text text-secondary odg-preview">${escapeHtml(plainText(odg.body))}</p></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-between gap-2"><span class="small text-secondary">${escapeHtml(documentCode(odg))}</span><span class="d-flex gap-2">${capable('odg.change_evaluation') ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-toggle-odg-status="${odg.id}">${odg.status === 'valutato' ? 'Segna da valutare' : 'Segna valutato'}</button>` : ''}<button type="button" class="btn btn-sm btn-outline-secondary" data-open-document="${odg.id}">Apri ODG</button>${capable('odg.download_pdf') ? `<button type="button" class="btn btn-sm btn-primary" data-download-pdf="${odg.id}">Scarica PDF</button>` : ''}${capable('odg.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="documents" data-entity-id="${odg.id}">Cestino</button>` : ''}</span></div></article></div>`).join('');
  document.getElementById('emptyOdg').classList.toggle('d-none', odgs.length > 0);
  document.getElementById('odgCount').textContent = odgs.length;
  document.getElementById('odgToEvaluateCount').textContent = odgs.filter(odg => odg.status !== 'valutato').length;
  document.getElementById('odgEvaluatedCount').textContent = odgs.filter(odg => odg.status === 'valutato').length;
}

function normalizeUsefulUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function openUsefulLink(id) {
  if (!capable('useful_links.open')) { showToast('Non hai il permesso di aprire link esterni.'); return; }
  const item = state.usefulLinks.find(link => link.id === id);
  const url = normalizeUsefulUrl(item?.url || '');
  if (!url) { showToast('Il link non è valido.'); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}
function openUsefulLinkModal(id = '') {
  const item = state.usefulLinks.find(link => link.id === id);
  editingUsefulLinkId = item?.id || null;
  document.getElementById('usefulLinkForm').reset();
  document.getElementById('usefulLinkName').value = item?.name || '';
  document.getElementById('usefulLinkUrl').value = item?.url || '';
  document.querySelector('#usefulLinkModal .modal-title').textContent = item ? 'Modifica link' : 'Nuovo link';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('usefulLinkModal')).show();
}
async function saveUsefulLink(event) {
  event.preventDefault();
  const existing = state.usefulLinks.find(link => link.id === editingUsefulLinkId);
  const name = document.getElementById('usefulLinkName').value.trim();
  const url = normalizeUsefulUrl(document.getElementById('usefulLinkUrl').value.trim());
  if (!name || !url) { showToast('Inserisci un nome e un link HTTP o HTTPS valido.'); return; }
  const record = { id: existing?.id || crypto.randomUUID(), name, url, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (existing) state.usefulLinks[state.usefulLinks.indexOf(existing)] = record; else state.usefulLinks.unshift(record);
  writeStorage(STORAGE_KEYS.usefulLinks, state.usefulLinks);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    try { await saveRemoteState('useful_links'); }
    catch (error) {
      if (existing) state.usefulLinks[state.usefulLinks.indexOf(record)] = existing;
      else state.usefulLinks = state.usefulLinks.filter(item => item.id !== record.id);
      localStorage.setItem(STORAGE_KEYS.usefulLinks, JSON.stringify(state.usefulLinks));
      showToast('Salvataggio non riuscito: ' + error.message);
      return;
    }
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('usefulLinkModal')).hide();
  editingUsefulLinkId = null;
  renderUsefulLinks();
  showToast(existing ? 'Link aggiornato.' : 'Link aggiunto.');
}
function renderUsefulLinks() {
  const query = archiveSearchValue('usefulLinkSearch');
  const links = state.usefulLinks.filter(item => matchesArchiveSearch([item.name, item.url], query));
  document.getElementById('usefulLinksTableBody').innerHTML = links.map(item => `<tr class="document-row" data-open-useful-link="${item.id}" tabindex="0" role="link"><td class="ps-4 fw-semibold">${escapeHtml(item.name)}</td><td><span class="text-secondary useful-link-url">${escapeHtml(item.url)}</span></td><td class="text-end pe-4"><div class="d-flex justify-content-end gap-2">${capable('useful_links.edit') ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-edit-useful-link="${item.id}">Modifica</button>` : ''}${capable('useful_links.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="usefulLinks" data-entity-id="${item.id}">Cestino</button>` : ''}</div></td></tr>`).join('');
  document.getElementById('emptyUsefulLinks').classList.toggle('d-none', links.length > 0);
}

function renderTemplates() {
  const grid = document.getElementById('templateGrid');
  const query = archiveSearchValue('templateSearch');
  const templates = state.templates.filter(template => matchesArchiveSearch([template.name, template.category], query));
  grid.innerHTML = templates.map(template => `<div class="col-12 col-md-6 col-xl-4"><article class="template-card card border-0 shadow-sm"><div class="card-body p-4"><p class="eyebrow text-secondary mb-2">${escapeHtml(template.category)}</p><h2 class="h5">${escapeHtml(template.name)}</h2><p class="card-text text-secondary small mb-0">Template Google Documenti</p></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-end flex-wrap gap-2">${capable('templates.edit') ? `<button class="btn btn-sm btn-outline-secondary" data-edit-template="${template.id}">Modifica</button>` : ''}${capable('templates.trash') ? `<button class="btn btn-sm btn-outline-danger" data-trash-item="templates" data-entity-id="${template.id}">Cestino</button>` : ''}${capable('templates.use') && capable('documents.create') ? `<button class="btn btn-sm btn-outline-secondary" data-use-template="${template.id}">Usa template</button>` : ''}</div></article></div>`).join('');
  document.getElementById('emptyTemplates').classList.toggle('d-none', templates.length > 0);
}

function deleteTemplate(templateId) {
  moveToTrash('templates', templateId);
}

function renderParties() {
  const grid = document.getElementById('partyGrid');
  const query = archiveSearchValue('partySearch');
  const parties = [...state.parties].filter(party => matchesArchiveSearch([party.name, party.status, ...Object.values(party.fields || {})], query)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  grid.innerHTML = parties.map(party => {
    const hasStatute = Boolean(party.googleStatuteDocumentId || party.googleUrl || party.statuteUrl);
    const dateFormatted = formatDate((party.updatedAt || party.createdAt || '').slice(0, 10));
    const isGoogleDoc = Boolean(party.googleStatuteDocumentId);
    return `<div class="col-12 col-md-6 col-xl-4"><article class="party-card card border-0 shadow-sm" data-open-party="${party.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-2 mb-3"><h2 class="h5 mb-0">${escapeHtml(party.name)}</h2><span class="badge ${statusClass(party.status)}">${statusLabel(party.status)}</span></div><p class="text-secondary small mb-3">${hasStatute ? `Statuto registrato · Aggiornato il ${dateFormatted}` : 'Statuto da collegare'}</p><dl class="party-facts mb-0">${state.partyFields.map(field => `<div><dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(party.fields?.[field.id] || '—')}</dd></div>`).join('')}</dl></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-between align-items-center gap-2"><span class="small text-secondary">${(party.history || []).length} modifiche registrate</span><span class="d-flex gap-2">${capable('parties.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="parties" data-entity-id="${party.id}">Cestino</button>` : ''}${isGoogleDoc && capable('party_statutes.download_pdf') ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-download-statute-pdf="${party.id}">Scarica PDF</button>` : ''}${hasStatute && capable('party_statutes.change_link') ? `<button type="button" class="btn btn-sm btn-outline-primary" data-relink-party-statute="${party.id}">Cambia link</button>` : ''}${capable(hasStatute ? 'party_statutes.view' : 'party_statutes.link') ? `<button type="button" class="btn btn-sm ${hasStatute ? 'btn-primary' : 'btn-outline-primary'}" data-open-party-statute="${party.id}">${hasStatute ? 'Vedi statuto' : 'Collega statuto'}</button>` : ''}</span></div></article></div>`;
  }).join('');
  document.getElementById('emptyParties').classList.toggle('d-none', parties.length > 0);
  document.getElementById('partyCount').textContent = parties.length;
  document.getElementById('activePartyCount').textContent = parties.filter(party => party.status === 'attivo').length;
  document.getElementById('partyFieldCount').textContent = state.partyFields.length;
}

function renderCoalitionFields(coalition = null) {
  const fields = document.getElementById('coalitionFields');
  if (fields) fields.innerHTML = state.coalitionFields.map(field => `<div class="col-12 col-md-6"><label class="form-label" for="coalition-field-${field.id}">${escapeHtml(field.name)}</label><input id="coalition-field-${field.id}" class="form-control coalition-field-input" data-field-id="${field.id}" required value="${escapeHtml(coalition?.fields?.[field.id] || '')}"></div>`).join('');
}

function renderCoalitionHistory(coalition = null) {
  const panel = document.getElementById('coalitionHistoryPanel');
  const list = document.getElementById('coalitionHistory');
  const empty = document.getElementById('coalitionHistoryEmpty');
  const clearBtn = document.getElementById('clearCoalitionHistoryButton');
  const formCol = document.getElementById('coalitionFormColumn');
  if (!panel || !list) return;

  const canView = capable('coalitions.view_history') || capable('coalitions.view');
  if (!coalition || !canView) {
    panel.classList.add('d-none');
    if (formCol) formCol.className = 'col-12';
    return;
  }
  panel.classList.remove('d-none');
  if (formCol) formCol.className = 'col-12 col-lg-7';

  const history = Array.isArray(coalition.history) ? coalition.history : [];
  const canEdit = capable('coalitions.edit');
  if (clearBtn) {
    clearBtn.classList.toggle('d-none', history.length === 0 || !canEdit);
    clearBtn.dataset.coalitionId = coalition.id;
  }

  if (history.length === 0) {
    list.innerHTML = '';
    list.classList.add('d-none');
    if (empty) empty.classList.remove('d-none');
    return;
  }

  if (empty) empty.classList.add('d-none');
  list.classList.remove('d-none');

  list.innerHTML = history.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => {
    const dateStr = entry.at ? formatDate(entry.at.slice(0, 10)) : 'Data non registrata';
    const deleteBtnHtml = canEdit ? `<button type="button" class="btn btn-sm btn-outline-danger btn-delete-history-item" data-delete-coalition-history="${coalition.id}" data-history-index="${index}" title="Elimina questa voce dalla cronologia"><i class="bi bi-trash"></i></button>` : '';

    return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
      <div class="flex-grow-1">
        <strong>${escapeHtml(entry.label)}</strong>
        <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}</span>
      </div>
      ${deleteBtnHtml}
    </div>`;
  }).join('');
}

async function deleteCoalitionHistoryItem(coalitionId, index) {
  if (!capable('coalitions.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const coalition = state.coalitions.find(item => item.id === coalitionId);
  const idx = Number(index);
  if (!coalition || !Array.isArray(coalition.history) || idx < 0 || idx >= coalition.history.length) return;
  if (!confirm('Vuoi eliminare questa voce dalla cronologia della coalizione?')) return;

  coalition.history.splice(idx, 1);
  coalition.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.coalitions, state.coalitions);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('parties');
  }
  renderCoalitionHistory(coalition);
  renderCoalitions();
  showToast('Voce della cronologia eliminata.');
}

async function clearCoalitionHistory(coalitionId) {
  if (!capable('coalitions.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const coalition = state.coalitions.find(item => item.id === coalitionId);
  if (!coalition || !Array.isArray(coalition.history) || coalition.history.length === 0) return;
  if (!confirm(`Sei sicuro di voler eliminare interamente la cronologia della coalizione «${coalition.name}»? L'operazione non può essere annullata.`)) return;

  coalition.history = [];
  coalition.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.coalitions, state.coalitions);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('parties');
  }
  renderCoalitionHistory(coalition);
  renderCoalitions();
  showToast('Cronologia della coalizione svuotata.');
  const list = document.getElementById('coalitionHistory');
  const empty = document.getElementById('coalitionHistoryEmpty');
  const clearBtn = document.getElementById('clearCoalitionHistoryButton');
  const formCol = document.getElementById('coalitionFormColumn');
  if (!panel || !list) return;

  const canView = capable('coalitions.view_history') || capable('coalitions.view');
  if (!coalition || !canView) {
    panel.classList.add('d-none');
    if (formCol) formCol.className = 'col-12';
    return;
  }
  panel.classList.remove('d-none');
  if (formCol) formCol.className = 'col-12 col-lg-7';

  const history = Array.isArray(coalition.history) ? coalition.history : [];
  const canEdit = capable('coalitions.edit');
  if (clearBtn) {
    clearBtn.classList.toggle('d-none', history.length === 0 || !canEdit);
    clearBtn.dataset.coalitionId = coalition.id;
  }

  if (history.length === 0) {
    list.innerHTML = '';
    list.classList.add('d-none');
    if (empty) empty.classList.remove('d-none');
    return;
  }

  if (empty) empty.classList.add('d-none');
  list.classList.remove('d-none');

  list.innerHTML = history.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => {
    const dateStr = entry.at ? formatDate(entry.at.slice(0, 10)) : 'Data non registrata';
    const deleteBtnHtml = canEdit ? `<button type="button" class="btn btn-sm btn-outline-danger btn-delete-history-item" data-delete-coalition-history="${coalition.id}" data-history-index="${index}" title="Elimina questa voce dalla cronologia"><i class="bi bi-trash"></i></button>` : '';

    return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
      <div class="flex-grow-1">
        <strong>${escapeHtml(entry.label)}</strong>
        <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}</span>
      </div>
      ${deleteBtnHtml}
    </div>`;
  }).join('');
}

async function deleteCoalitionHistoryItem(coalitionId, index) {
  if (!capable('coalitions.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const coalition = state.coalitions.find(item => item.id === coalitionId);
  const idx = Number(index);
  if (!coalition || !Array.isArray(coalition.history) || idx < 0 || idx >= coalition.history.length) return;
  if (!confirm('Vuoi eliminare questa voce dalla cronologia della coalizione?')) return;

  coalition.history.splice(idx, 1);
  coalition.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.coalitions, state.coalitions);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('parties');
  }
  renderCoalitionHistory(coalition);
  renderCoalitions();
  showToast('Voce della cronologia eliminata.');
}

async function clearCoalitionHistory(coalitionId) {
  if (!capable('coalitions.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const coalition = state.coalitions.find(item => item.id === coalitionId);
  if (!coalition || !Array.isArray(coalition.history) || coalition.history.length === 0) return;
  if (!confirm(`Sei sicuro di voler eliminare interamente la cronologia della coalizione «${coalition.name}»? L'operazione non può essere annullata.`)) return;

  coalition.history = [];
  coalition.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.coalitions, state.coalitions);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('parties');
  }
  renderCoalitionHistory(coalition);
  renderCoalitions();
  showToast('Cronologia della coalizione svuotata.');
}

function renderCoalitions() {
  const grid = document.getElementById('coalitionGrid');
  if (!grid) return;
  const query = archiveSearchValue('coalitionSearch') || '';
  const coalitions = [...state.coalitions].filter(coalition => {
    const partyNames = (coalition.parties || []).map(id => state.parties.find(p => p.id === id)?.name).filter(Boolean);
    return matchesArchiveSearch([coalition.name, coalition.status, ...partyNames, ...Object.values(coalition.fields || {})], query);
  }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  grid.innerHTML = coalitions.map(coalition => {
    const partyNames = (coalition.parties || []).map(id => state.parties.find(party => party.id === id)?.name).filter(Boolean);
    return `<div class="col-12 col-md-6 col-xl-4"><article class="party-card coalition-card card border-0 shadow-sm" data-open-coalition="${coalition.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-2 mb-3"><h2 class="h5 mb-0">${escapeHtml(coalition.name)}</h2><span class="badge ${statusClass(coalition.status)}">${statusLabel(coalition.status)}</span></div><p class="text-secondary small mb-3">${partyNames.length ? `${partyNames.length} ${partyNames.length === 1 ? 'partito associato' : 'partiti associati'}` : 'Nessun partito associato'}</p><dl class="party-facts mb-0">${state.coalitionFields.map(field => `<div><dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(coalition.fields?.[field.id] || '—')}</dd></div>`).join('')}</dl></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-between align-items-center gap-2"><span class="small text-secondary">${(coalition.history || []).length} modifiche registrate</span><span class="d-flex gap-2">${capable('coalitions.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="coalitions" data-entity-id="${coalition.id}">Cestino</button>` : ''}<button type="button" class="btn btn-sm btn-outline-secondary" data-open-coalition="${coalition.id}">Modifica</button></span></div></article></div>`;
  }).join('');

  document.getElementById('emptyCoalitions').classList.toggle('d-none', coalitions.length > 0);
  const countEl = document.getElementById('coalitionCount');
  if (countEl) countEl.textContent = coalitions.length;
}

function renderCompanies() {
  const grid = document.getElementById('companyGrid');
  const query = archiveSearchValue('companySearch');
  const companies = [...state.companies].filter(company => matchesArchiveSearch([company.name, company.regulation], query)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  grid.innerHTML = companies.map(company => {
    const hasRegulation = Boolean(company.googleRegulationDocumentId || company.googleUrl || company.regulationUrl);
    const dateFormatted = formatDate((company.updatedAt || company.createdAt || '').slice(0, 10));
    const isGoogleDoc = Boolean(company.googleRegulationDocumentId);
    return `<div class="col-12 col-md-6 col-xl-4"><article class="party-card company-card card border-0 shadow-sm" data-open-company="${company.id}" tabindex="0" role="button"><div class="card-body p-4"><h2 class="h5 mb-3">${escapeHtml(company.name)}</h2><p class="text-secondary small mb-0">${hasRegulation ? `Regolamento registrato · Aggiornato il ${dateFormatted}` : 'Regolamento da collegare'}</p></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-between align-items-center gap-2"><span class="small text-secondary">${(company.history || []).length} modifiche registrate</span><span class="d-flex gap-2">${capable('companies.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="companies" data-entity-id="${company.id}">Cestino</button>` : ''}${isGoogleDoc && capable('company_regulations.download_pdf') ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-download-regulation-pdf="${company.id}">Scarica PDF</button>` : ''}${hasRegulation && capable('company_regulations.change_link') ? `<button type="button" class="btn btn-sm btn-outline-primary" data-relink-company-regulation="${company.id}">Cambia link</button>` : ''}${capable(hasRegulation ? 'company_regulations.view' : 'company_regulations.link') ? `<button type="button" class="btn btn-sm ${hasRegulation ? 'btn-primary' : 'btn-outline-primary'}" data-open-company-regulation="${company.id}">${hasRegulation ? 'Vedi regolamento' : 'Collega regolamento'}</button>` : ''}</span></div></article></div>`;
  }).join('');
  document.getElementById('emptyCompanies').classList.toggle('d-none', companies.length > 0);
  document.getElementById('companyCount').textContent = companies.length;
  document.getElementById('companyRegulationCount').textContent = companies.filter(company => company.googleRegulationDocumentId || company.googleUrl || company.regulationUrl).length;
}

function institutionSettings(type) { return state[institutionConfigs[type].settingsKey]; }
function institutionRecords(type) { return state[institutionConfigs[type].key]; }
function institutionRole(type, roleId) { return institutionSettings(type).roles.find(role => role.id === roleId); }
function institutionActive(record) { return !record.endDate; }

function ensureInstitutionViews() {
  const nav = document.querySelector('#mainNav .navbar-nav');
  const parliamentLink = nav?.querySelector('[data-view-link="parliament"]')?.closest('.nav-item');
  if (nav && parliamentLink && !nav.querySelector('[data-view-link="government"]')) {
    let prev = parliamentLink;
    ['government', 'composition'].forEach(type => {
      const item = document.createElement('li');
      item.className = 'nav-item';
      item.innerHTML = `<a class="nav-link" href="#${institutionConfigs[type].view}" data-view-link="${institutionConfigs[type].view}">${institutionConfigs[type].label}</a>`;
      nav.insertBefore(item, prev.nextSibling);
      prev = item;
    });
  }
  const appContainer = document.querySelector('#appView > .container-fluid');
  Object.entries(institutionConfigs).forEach(([type, config]) => {
    if (!document.getElementById(`${config.view}View`)) {
      appContainer.insertAdjacentHTML('beforeend', `<section id="${config.view}View" class="app-view d-none"><div class="d-flex flex-column flex-md-row justify-content-between align-items-md-end gap-3 mb-4"><div><p class="eyebrow text-secondary mb-2">Archivio istituzionale</p><h1 class="display-6 fw-bold mb-2">${config.label}</h1><p class="text-secondary mb-0">Gestisci periodi, ruoli, nomine e storico.</p></div><button class="btn btn-primary" type="button" data-new-institution="${type}">+ ${config.newLabel || `Nuovo ${config.itemLabel.toLowerCase()}`}</button></div><div class="row g-3 mb-4"><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">Schede archiviate</span><strong id="${config.view}Count">0</strong></div></div><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">Periodi in corso</span><strong id="${config.view}CurrentCount">0</strong></div></div><div class="col-12 col-md-4"><div class="stat-card"><span class="text-secondary small">Componenti registrati</span><strong id="${config.view}MemberCount">0</strong></div></div></div><div id="${config.view}Grid" class="row g-4"></div><div id="${config.view}Empty" class="empty-state d-none"><div class="display-6">□</div><h3 class="h5 mt-3">Nessuna scheda archiviata</h3><p class="text-secondary mb-0">Crea la prima scheda per iniziare.</p></div></section>`);
    }
    if (!document.getElementById(`${type}Editor`)) {
      document.body.insertAdjacentHTML('beforeend', `<div class="editor-page d-none" id="${type}Editor"><div class="modal-dialog"><div class="modal-content"><form id="${type}Form"><div class="modal-header"><div><p class="eyebrow text-secondary mb-1">Archivio istituzionale</p><h2 class="modal-title h4">${config.itemLabel}</h2></div><button type="button" class="btn-close" data-close-institution="${type}" aria-label="Chiudi"></button></div><div class="modal-body"><div class="row g-3"><div class="col-md-6"><label for="${type}Period" class="form-label">Periodo o denominazione</label><input id="${type}Period" class="form-control" required placeholder="Es. XVIII legislatura"></div><div class="col-md-3"><label for="${type}Start" class="form-label">Data inizio</label><input id="${type}Start" type="date" class="form-control" required></div><div class="col-md-3"><label for="${type}End" class="form-label">Data fine</label><input id="${type}End" type="date" class="form-control"></div><div class="col-12"><label for="${type}Status" class="form-label">Stato</label><select id="${type}Status" class="form-select"><option value="in corso">In corso</option><option value="concluso">Concluso</option></select></div><div class="col-12"><hr><div class="d-flex justify-content-between align-items-center"><div><h3 class="h6 mb-1">Nomine e componenti</h3><p class="text-secondary small mb-0">Le cessazioni restano nello storico e non occupano il limite del ruolo.</p></div><button type="button" class="btn btn-sm btn-primary" data-add-institution-member="${type}">+ Nuova nomina</button></div></div><div class="col-12" id="${type}RoleLists"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-close-institution="${type}">Annulla</button><button class="btn btn-primary" type="submit">Salva ${config.itemLabel.toLowerCase()}</button></div></form></div></div></div>`);
    }
    if (!document.getElementById(`${type}PersonModal`)) {
      document.body.insertAdjacentHTML('beforeend', `<div class="modal fade" id="${type}PersonModal" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-lg"><div class="modal-content"><form id="${type}PersonForm"><div class="modal-header"><h2 class="modal-title h5">Nuova nomina</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button></div><div class="modal-body"><div class="row g-3"><div class="col-md-7"><label for="${type}PersonName" class="form-label">Nome e cognome</label><input id="${type}PersonName" class="form-control" required></div><div class="col-md-5"><label for="${type}PersonRole" class="form-label">Ruolo</label><select id="${type}PersonRole" class="form-select" required></select></div><div class="col-md-6"><label for="${type}PersonStart" class="form-label">Data nomina</label><input id="${type}PersonStart" type="date" class="form-control" required></div><div class="col-md-6"><label for="${type}PersonEnd" class="form-label">Data cessazione</label><input id="${type}PersonEnd" type="date" class="form-control"></div><div class="col-12"><label for="${type}PersonNotes" class="form-label">Annotazioni</label><textarea id="${type}PersonNotes" class="form-control" rows="3"></textarea></div></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Annulla</button><button class="btn btn-primary" type="submit">Salva nomina</button></div></form></div></div></div>`);
    }
    const settingsView = document.getElementById('settingsView');
    if (settingsView && !document.getElementById(`${type}SettingsCard`)) {
      settingsView.querySelector('.row')?.insertAdjacentHTML('beforeend', `<div class="col-12 col-xl-6"><div class="card border-0 shadow-sm h-100" id="${type}SettingsCard"><div class="card-body p-4"><h2 class="h5 mb-1">Configurazione ${config.label}</h2><p class="text-secondary small">Crea i ruoli e imposta il numero massimo di componenti per ciascun ruolo.</p><form id="${type}SettingsForm" class="vstack gap-2"></form></div></div></div>`);
    }
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
  if (!document.getElementById('interpretationEditor')) document.body.insertAdjacentHTML('beforeend', '<div class="editor-page d-none" id="interpretationEditor"><div class="modal-dialog"><div class="modal-content"><form id="interpretationForm"><div class="modal-header"><div><p class="eyebrow text-secondary mb-1">Archivio interpretativo</p><h2 class="modal-title h4">Nuova interpretazione</h2></div><button type="button" class="btn-close" id="closeInterpretationEditor" aria-label="Chiudi"></button></div><div class="modal-body"><div class="row g-3"><div class="col-md-8"><label for="interpretationName" class="form-label">Nome interpretazione</label><input id="interpretationName" class="form-control" required placeholder="Es. Interpretazione dell’articolo 12"></div><div class="col-md-4"><label for="interpretationDate" class="form-label">Data di creazione</label><input id="interpretationDate" type="date" class="form-control" required></div><div id="interpretationBaseFields" class="row g-3"></div><div class="col-12"><label for="interpretationText" class="form-label">Testo dell’interpretazione</label><textarea id="interpretationText" class="form-control interpretation-text" rows="15" style="max-height:400px; overflow-y:auto;" required placeholder="Scrivi qui l’interpretazione..."></textarea><div class="form-text">Questo contenuto è un testo interpretativo e non viene archiviato come documento.</div></div></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" id="cancelInterpretationEditor">Annulla</button><button class="btn btn-primary" type="submit">Salva interpretazione</button></div></form></div></div></div>');
  const settingsView = document.getElementById('settingsView');
  if (!document.getElementById('interpretationSettingsCard')) settingsView.querySelector('.row').insertAdjacentHTML('beforeend', '<div class="col-12 col-xl-6"><div class="card border-0 shadow-sm h-100" id="interpretationSettingsCard"><div class="card-body p-4"><h2 class="h5 mb-1">Valori base delle interpretazioni</h2><p class="text-secondary small">Questi campi saranno disponibili in ogni nuova interpretazione.</p><form id="interpretationFieldForm" class="row g-2 mb-3"><div class="col"><label for="interpretationFieldName" class="visually-hidden">Nome valore base</label><input id="interpretationFieldName" class="form-control" required placeholder="Es. Fonte normativa"></div><div class="col-auto"><button class="btn btn-primary" type="submit">Aggiungi campo</button></div></form><div id="interpretationFieldList" class="vstack gap-2"></div></div></div></div>');
}

function renderInterpretationFields(interpretation = null) {
  document.getElementById('interpretationBaseFields').innerHTML = state.interpretationSettings.fields.map(field => `<div class="col-12 col-md-6"><label class="form-label" for="interpretation-field-${field.id}">${escapeHtml(field.name)}</label><input id="interpretation-field-${field.id}" class="form-control interpretation-field-input" data-field-id="${field.id}" value="${escapeHtml(interpretation?.fields?.[field.id] || '')}"></div>`).join('');
}

function renderInterpretations() {
  const query = archiveSearchValue('interpretationSearch');
  const interpretations = [...state.interpretations].filter(item => matchesArchiveSearch([item.name, item.text, ...Object.values(item.fields || {})], query)).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  document.getElementById('interpretationGrid').innerHTML = interpretations.map(item => `<div class="col-12 col-md-6 col-xl-4"><article class="party-card interpretation-card card border-0 shadow-sm" data-open-interpretation="${item.id}" tabindex="0" role="button"><div class="card-body p-4"><p class="eyebrow text-secondary mb-2">Creata il ${formatDate(item.date)}</p><h2 class="h5 mb-3">${escapeHtml(item.name)}</h2><p class="card-text text-secondary interpretation-preview">${escapeHtml(item.text)}</p><dl class="party-facts mb-0">${state.interpretationSettings.fields.slice(0, 3).map(field => `<div><dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(item.fields?.[field.id] || '—')}</dd></div>`).join('')}</dl></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-between gap-2"><span class="small text-secondary">Testo interpretativo</span><span class="d-flex gap-2">${capable('interpretations.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="interpretations" data-entity-id="${item.id}">Cestino</button>` : ''}<button type="button" class="btn btn-sm btn-outline-secondary" data-open-interpretation="${item.id}">Apri scheda</button></span></div></article></div>`).join('');
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
  const query = archiveSearchValue(`${type}Search`);
  const records = [...institutionRecords(type)].filter(record => matchesArchiveSearch([record.period, record.status, ...(record.members || []).flatMap(member => [member.name, member.role, member.annotations])], query)).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  document.getElementById(`${config.view}Grid`).innerHTML = records.map(record => {
    const active = (record.members || []).filter(institutionActive).length;
    const dateFormatted = `${formatDate(record.startDate)} → ${record.endDate ? formatDate(record.endDate) : 'In corso'}`;
    return `<div class="col-12 col-xl-6"><article class="parliament-card card border-0 shadow-sm" data-open-institution="${type}" data-record-id="${record.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-3"><div><p class="eyebrow text-secondary mb-2">${escapeHtml(record.period)}</p><h2 class="h4 mb-2">${config.itemLabel}</h2></div><span class="badge ${record.status === 'in corso' ? 'text-bg-success' : 'text-bg-secondary'}">${mandateStatusLabel(record.status)}</span></div><p class="text-secondary mb-3">${dateFormatted}</p><div class="d-flex flex-wrap gap-3 small">${institutionSettings(type).roles.map(role => `<span>${(record.members || []).filter(member => member.role === role.id && institutionActive(member)).length} ${escapeHtml(role.name.toLowerCase())}</span>`).join('')}<span>${active} in carica</span></div></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-between gap-2"><span class="small text-secondary">${(record.members || []).length} nomine nello storico</span><span class="d-flex gap-2">${capable(`${type}.records.trash`) ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="${type === 'government' ? 'governments' : 'courtCompositions'}" data-entity-id="${record.id}">Cestino</button>` : ''}<button type="button" class="btn btn-sm btn-outline-secondary" data-open-institution="${type}" data-record-id="${record.id}">Gestisci</button></span></div></article></div>`;
  }).join('');
  document.getElementById(`${config.view}Empty`).classList.toggle('d-none', records.length > 0);
  document.getElementById(`${config.view}Count`).textContent = records.length;
  document.getElementById(`${config.view}CurrentCount`).textContent = records.filter(record => record.status === 'in corso').length;
  document.getElementById(`${config.view}MemberCount`).textContent = records.reduce((total, record) => total + (record.members || []).length, 0);
}

function renderInstitutionMembers(type, record) {
  const container = document.getElementById(`${type}RoleLists`);
  const query = archiveSearchValue(`${type}MemberSearch`);
  const membersList = record.members || [];
  container.innerHTML = institutionSettings(type).roles.map(role => {
    const members = membersList.filter(member => member.role === role.id && matchesArchiveSearch([member.name, member.annotations], query));
    const active = members.filter(institutionActive).length;
    return `<section class="mb-4"><h4 class="h6">${escapeHtml(role.name)}</h4><div class="parliament-member-list">${members.length ? members.map(member => `<div class="parliament-member ${member.endDate ? 'is-resigned' : ''}"><div><strong>${escapeHtml(member.name)}</strong>${member.replacesMemberId ? `<span class="d-block small text-primary">↳ Subentra a ${escapeHtml(record.members.find(item => item.id === member.replacesMemberId)?.name || 'membro cessato')}</span>` : ''}<span class="d-block small text-secondary">${member.endDate ? `Cessato il ${formatDate(member.endDate)}` : `Nominato il ${formatDate(member.startDate)}`}${member.annotations ? ` · Annotazioni: ${escapeHtml(member.annotations)}` : ''}</span></div><div class="d-flex gap-2">${capable(`${type}.members.edit`) ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-edit-institution-member="${type}" data-member-id="${member.id}">Modifica</button>` : ''}${!member.endDate && capable(`${type}.members.end`) ? `<button type="button" class="btn btn-sm btn-outline-danger" data-end-institution-member="${type}" data-member-id="${member.id}">Cessa</button>` : ''}${capable(`${type}.members.trash`) ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="${type === 'government' ? 'governmentMembers' : 'compositionMembers'}" data-entity-id="${member.id}" data-parent-id="${record.id}">Cestino</button>` : ''}</div></div>`).join('') : `<p class="small text-secondary mb-2">Nessun componente.</p>`}${capable(`${type}.members.create`) && active < role.limit ? `<button type="button" class="btn btn-sm btn-outline-primary" data-add-institution-member="${type}" data-role-id="${role.id}">+ Aggiungi ${escapeHtml(role.name)}</button>` : ''}</div></section>`;
  }).join('');
}

function openInstitutionEditor(type, recordId = '') {
  const config = institutionConfigs[type];
  const record = institutionRecords(type).find(item => item.id === recordId);
  window[`editing${type}Id`] = record?.id || null;
  document.getElementById(`${type}Period`).value = record?.period || '';
  document.getElementById(`${type}Start`).value = record?.startDate || today();
  document.getElementById(`${type}End`).value = record?.endDate || '';
  document.getElementById(`${type}Status`).value = record?.status || 'in corso';
  document.querySelector(`#${type}Editor .modal-title`).textContent = record ? `${config.itemLabel} ${record.period}` : `Nuovo ${config.itemLabel.toLowerCase()}`;
  ensureMemberSearch(`${type}RoleLists`, `${type}MemberSearch`, 'Cerca componente per nome o annotazioni');
  if (record) renderInstitutionMembers(type, record);
  else document.getElementById(`${type}RoleLists`).innerHTML = '<p class="small text-secondary">Salva la scheda per inserire le nomine.</p>';
  showEditorScreen(`${type}Editor`);
}

function saveInstitution(type, event) {
  event.preventDefault();
  const existingId = window[`editing${type}Id`];
  const existing = institutionRecords(type).find(item => item.id === existingId);
  const period = document.getElementById(`${type}Period`).value.trim();
  const startDate = document.getElementById(`${type}Start`).value;
  const endDate = document.getElementById(`${type}End`).value;
  const status = document.getElementById(`${type}Status`).value;
  if (!period || !startDate) {
    showToast('Inserisci il periodo e la data di inizio.');
    return;
  }
  if (status === 'concluso' && (!endDate || endDate < startDate)) {
    showToast('Per una scheda conclusa, inserisci una data di fine valida.');
    return;
  }
  const record = {
    id: existingId || crypto.randomUUID(),
    period,
    startDate,
    endDate: status === 'in corso' ? (endDate || '') : endDate,
    status,
    members: existing?.members || [],
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const records = institutionRecords(type);
  if (existing) records[records.indexOf(existing)] = record;
  else records.unshift(record);
  writeStorage(STORAGE_KEYS[institutionConfigs[type].key], records);
  renderInstitution(type);
  openInstitutionEditor(type, record.id);
  showToast(`${institutionConfigs[type].itemLabel} salvato.`);
}

function openInstitutionMember(type, memberId = '', roleId = '') { const record = institutionRecords(type).find(item => item.id === window[`editing${type}Id`]); const member = record?.members.find(item => item.id === memberId); if (!record) return; const form = document.getElementById(`${type}PersonForm`); let replaces = document.getElementById(`${type}PersonReplaces`); if (!replaces) { const wrapper = document.createElement('div'); wrapper.className = 'col-12'; wrapper.innerHTML = `<label class="form-label" for="${type}PersonReplaces">Subentra a</label><select id="${type}PersonReplaces" class="form-select"><option value="">Nuova nomina</option></select><div class="form-text">Indica il membro cessato a cui subentra questa nomina.</div>`; form.querySelector(`#${type}PersonRole`).closest('.col-md-5').after(wrapper); replaces = wrapper.querySelector('select'); } window[`editing${type}MemberId`] = member?.id || null; document.getElementById(`${type}PersonRole`).innerHTML = institutionSettings(type).roles.map(role => `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join(''); document.getElementById(`${type}PersonForm`).reset(); document.getElementById(`${type}PersonRole`).value = member?.role || roleId || institutionSettings(type).roles[0].id; replaces.innerHTML = '<option value="">Nuova nomina</option>' + (record.members || []).filter(item => item.id !== memberId && item.endDate && item.role === (member?.role || roleId)).map(item => `<option value="${item.id}">${escapeHtml(item.name)} · cessato il ${formatDate(item.endDate)}</option>`).join(''); replaces.value = member?.replacesMemberId || ''; document.getElementById(`${type}PersonName`).value = member?.name || ''; document.getElementById(`${type}PersonStart`).value = member?.startDate || today(); document.getElementById(`${type}PersonEnd`).value = member?.endDate || ''; document.getElementById(`${type}PersonNotes`).value = member?.annotations || ''; bootstrap.Modal.getOrCreateInstance(document.getElementById(`${type}PersonModal`)).show(); }

function saveInstitutionMember(type, event) { event.preventDefault(); const record = institutionRecords(type).find(item => item.id === window[`editing${type}Id`]); if (!record) return; const memberId = window[`editing${type}MemberId`]; const role = document.getElementById(`${type}PersonRole`).value; const roleConfig = institutionRole(type, role); const activeCount = record.members.filter(member => member.role === role && institutionActive(member) && member.id !== memberId).length; if (!memberId && activeCount >= roleConfig.limit) { showToast(`Hai raggiunto il numero massimo per il ruolo ${roleConfig.name}.`); return; } const existing = record.members.find(member => member.id === memberId); const person = { id: memberId || crypto.randomUUID(), role, name: document.getElementById(`${type}PersonName`).value.trim(), replacesMemberId: document.getElementById(`${type}PersonReplaces`)?.value || '', startDate: document.getElementById(`${type}PersonStart`).value, endDate: document.getElementById(`${type}PersonEnd`).value, annotations: document.getElementById(`${type}PersonNotes`).value.trim(), createdAt: existing?.createdAt || new Date().toISOString() }; if (!person.name || !person.startDate) { showToast('Inserisci nome e data di nomina.'); return; } if (existing) record.members[record.members.indexOf(existing)] = person; else record.members.push(person); record.updatedAt = new Date().toISOString(); writeStorage(STORAGE_KEYS[institutionConfigs[type].key], institutionRecords(type)); bootstrap.Modal.getOrCreateInstance(document.getElementById(`${type}PersonModal`)).hide(); renderInstitutionMembers(type, record); renderInstitution(type); }

function endInstitutionMember(type, memberId) { if (!capable(`${type}.members.end`)) { showToast('Non hai il permesso di registrare cessazioni.'); return; } const record = institutionRecords(type).find(item => item.id === window[`editing${type}Id`]); const member = record?.members.find(item => item.id === memberId); if (!record || !member || member.endDate || !confirm(`Registrare la cessazione di ${member.name}?`)) return; member.endDate = today(); record.updatedAt = new Date().toISOString(); writeStorage(STORAGE_KEYS[institutionConfigs[type].key], institutionRecords(type)); renderInstitutionMembers(type, record); renderInstitution(type); }

function bindInstitutionEvents() { Object.keys(institutionConfigs).forEach(type => { document.getElementById(`${type}Form`).addEventListener('submit', event => saveInstitution(type, event)); document.getElementById(`${type}PersonForm`).addEventListener('submit', event => saveInstitutionMember(type, event)); document.getElementById(`${type}SettingsForm`).addEventListener('submit', event => { event.preventDefault(); const roles = [...document.querySelectorAll(`#${type}SettingsForm .institution-role-setting`)].map(row => ({ id: row.dataset.roleId, name: row.querySelector('.institution-role-name').value.trim(), limit: Math.max(0, Number.parseInt(row.querySelector('.institution-role-limit').value, 10) || 0) })).filter(role => role.name); if (!roles.length || new Set(roles.map(role => role.name.toLowerCase())).size !== roles.length) { showToast('Inserisci nomi di ruolo univoci.'); return; } state[institutionConfigs[type].settingsKey].roles = roles; writeStorage(STORAGE_KEYS[institutionConfigs[type].settingsKey], state[institutionConfigs[type].settingsKey]); renderInstitutionSettings(type); renderInstitution(type); showToast('Configurazione salvata.'); }); document.getElementById(`${type}SettingsForm`).addEventListener('click', event => { const add = event.target.closest('[data-add-institution-role]'); if (add) { if (!capable(`${type}.configuration.roles_create`)) { showToast('Non hai il permesso di creare ruoli.'); return; } const row = document.createElement('div'); row.className = 'row g-2 align-items-end institution-role-setting'; row.dataset.roleId = crypto.randomUUID(); row.innerHTML = '<div class="col"><label class="form-label">Nome ruolo</label><input class="form-control institution-role-name" placeholder="Es. Sottosegretario" required></div><div class="col-auto"><label class="form-label">Numero</label><input class="form-control institution-role-limit" type="number" min="0" value="1" required></div><div class="col-auto"><button type="button" class="btn btn-outline-danger" data-remove-institution-role="' + type + '">Rimuovi</button></div>'; document.querySelector(`#${type}SettingsForm > .vstack`).appendChild(row); row.querySelector('input').focus(); return; } const remove = event.target.closest('[data-remove-institution-role]'); if (remove) { if (!capable(`${type}.configuration.roles_delete`)) { showToast('Non hai il permesso di eliminare ruoli.'); return; } remove.closest('.institution-role-setting').remove(); } }); }); document.addEventListener('click', event => { const newInstitution = event.target.closest('[data-new-institution]'); if (newInstitution) openInstitutionEditor(newInstitution.dataset.newInstitution); const openInstitution = event.target.closest('[data-open-institution]'); if (openInstitution) openInstitutionEditor(openInstitution.dataset.openInstitution, openInstitution.dataset.recordId); const closeInstitution = event.target.closest('[data-close-institution]'); if (closeInstitution) { document.getElementById(`${closeInstitution.dataset.closeInstitution}Editor`).classList.add('d-none'); setView(institutionConfigs[closeInstitution.dataset.closeInstitution].view); } const addMember = event.target.closest('[data-add-institution-member]'); if (addMember) openInstitutionMember(addMember.dataset.addInstitutionMember, '', addMember.dataset.roleId || ''); const editMember = event.target.closest('[data-edit-institution-member]'); if (editMember) openInstitutionMember(editMember.dataset.editInstitutionMember, editMember.dataset.memberId); const endMember = event.target.closest('[data-end-institution-member]'); if (endMember) endInstitutionMember(endMember.dataset.endInstitutionMember, endMember.dataset.memberId); }); }

function renderParliaments() {
  const grid = document.getElementById('parliamentGrid');
  const query = archiveSearchValue('parliamentSearch');
  const mandates = [...state.parliaments].filter(mandate => matchesArchiveSearch([mandate.legislation, mandate.status, ...(mandate.members || []).flatMap(member => [member.name, member.role, member.memberParty, member.memberCoalition])], query)).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  grid.innerHTML = mandates.map(mandate => {
    const active = (mandate.members || []).filter(member => !member.resignationDate).length;
    const roleSummary = parliamentRoles().map(role => `<span>${(mandate.members || []).filter(member => member.role === role.id && !member.resignationDate).length} ${escapeHtml(parliamentRoleLabel(role.id, true).toLowerCase())} attivi</span>`).join('');
    const dateFormatted = `${formatDate(mandate.startDate)} → ${mandate.endDate ? formatDate(mandate.endDate) : 'In corso'}`;
    return `<div class="col-12 col-xl-6"><article class="parliament-card card border-0 shadow-sm" data-open-parliament="${mandate.id}" tabindex="0" role="button"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start gap-3"><div><p class="eyebrow text-secondary mb-2">Legislazione ${escapeHtml(mandate.legislation)}</p><h2 class="h4 mb-2">Mandato parlamentare</h2></div><span class="badge ${mandate.status === 'in corso' ? 'text-bg-success' : 'text-bg-secondary'}">${mandateStatusLabel(mandate.status)}</span></div><p class="text-secondary mb-3">${dateFormatted}</p><div class="d-flex flex-wrap gap-3 small">${roleSummary}<span>${active} in carica</span></div></div><div class="card-footer bg-white border-0 px-4 pb-4 d-flex justify-content-between gap-2"><span class="small text-secondary">${(mandate.members || []).length} nomine nello storico</span><span class="d-flex gap-2">${capable('parliament.mandates.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="parliaments" data-entity-id="${mandate.id}">Cestino</button>` : ''}<button type="button" class="btn btn-sm btn-outline-secondary" data-open-parliament-action="${mandate.id}">Gestisci mandato</button></span></div></article></div>`;
  }).join('');
  document.getElementById('emptyParliaments').classList.toggle('d-none', mandates.length > 0);
  document.getElementById('parliamentCount').textContent = mandates.length;
  document.getElementById('currentParliamentCount').textContent = mandates.filter(mandate => mandate.status === 'in corso').length;
  document.getElementById('memberCount').textContent = mandates.reduce((total, mandate) => total + (mandate.members || []).length, 0);
}

function renderMemberList(mandate, role) {
  const query = archiveSearchValue('parliamentMemberSearch');
  const members = mandate.members.filter(member => member.role === role && matchesArchiveSearch([member.name, member.memberParty, member.memberCoalition, member.annotations], query));
  const list = document.querySelector(`[data-role-list="${role}"]`);
  const limit = parliamentRole(role)?.limit ?? 0;
  const roleLabel = parliamentRoleLabel(role);
  if (!list) return;
  list.innerHTML = members.length ? members.map(member => `<div class="parliament-member ${member.resignationDate ? 'is-resigned' : ''}"><div><strong>${escapeHtml(member.name)}</strong>${member.replacesMemberId ? `<span class="d-block small text-primary">↳ Subentra a ${escapeHtml(mandate.members.find(item => item.id === member.replacesMemberId)?.name || 'membro dimesso')}</span>` : ''}<span class="d-block small text-secondary">${member.resignationDate ? `Dimesso il ${formatDate(member.resignationDate)}` : `Giurato il ${formatDate(member.oathDate)}`}${member.memberParty ? ` · ${escapeHtml(member.memberParty)}` : ''}${member.annotations ? ` · Annotazioni: ${escapeHtml(member.annotations)}` : ''}</span></div><div class="d-flex gap-2">${capable('parliament.members.edit') ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-edit-member="${member.id}">Modifica</button>` : ''}${!member.resignationDate && capable('parliament.members.resign') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-resign-member="${member.id}">Dimetti</button>` : member.resignationDate && capable('parliament.members.create') ? `<button type="button" class="btn btn-sm btn-outline-primary" data-new-nomination="${role}">Nuova nomina</button>` : ''}${capable('parliament.members.trash') ? `<button type="button" class="btn btn-sm btn-outline-danger" data-trash-item="parliamentMembers" data-entity-id="${member.id}" data-parent-id="${mandate.id}">Cestino</button>` : ''}</div></div>`).join('') : `<p class="small text-secondary mb-2">Nessun ${roleLabel.toLowerCase()} inserito.</p>`;
  if (capable('parliament.members.create') && members.filter(member => !member.resignationDate).length < limit) list.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn-sm btn-outline-primary" data-new-nomination="${role}">+ Aggiungi ${roleLabel}</button>`);
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
  ensureMemberSearch('parliamentRoleLists', 'parliamentMemberSearch', 'Cerca parlamentare per nome, partito o coalizione');
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
  ensureMemberSearch('parliamentRoleLists', 'parliamentMemberSearch', 'Cerca parlamentare per nome, partito o coalizione');
  document.querySelector('#parliamentModal .modal-title').textContent = 'Nuovo mandato';
  showEditorScreen('parliamentModal');
}

function saveParliament(event) {
  event.preventDefault();
  const legislation = document.getElementById('legislationNumber').value.trim();
  const startDate = document.getElementById('mandateStart').value;
  const endDate = document.getElementById('mandateEnd').value;
  const status = document.getElementById('mandateStatus').value;
  if (!legislation || !startDate) { showToast('Inserisci la legislazione e la data di inizio.'); return; }
  if (status === 'concluso' && (!endDate || endDate < startDate)) { showToast('Per un mandato concluso, inserisci una data di fine valida.'); return; }
  const existing = state.parliaments.find(item => item.id === editingParliamentId);
  const record = { id: editingParliamentId || crypto.randomUUID(), legislation, startDate, endDate: status === 'in corso' ? (endDate || '') : endDate, status, members: existing?.members || [], createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (existing) state.parliaments[state.parliaments.indexOf(existing)] = record; else state.parliaments.unshift(record);
  writeStorage(STORAGE_KEYS.parliaments, state.parliaments);
  renderParliaments();
  showToast(existing ? 'Mandato aggiornato.' : 'Mandato salvato. Ora puoi inserire le nomine.');
  openParliamentEditor(record.id);
}

function syncMemberCoalitionFromParty() {
  const partyName = document.getElementById('memberParty')?.value || '';
  const coalitionSelect = document.getElementById('memberCoalition');
  if (!coalitionSelect) return;
  const party = state.parties.find(item => item.name === partyName);
  const coalition = party ? state.coalitions.find(item => Array.isArray(item.parties) && item.parties.includes(party.id) && item.status !== 'cancellata') : null;
  coalitionSelect.value = coalition?.name || '';
}

function openMemberEditor(memberId = '', role = 'titolare') {
  const mandate = state.parliaments.find(item => item.id === editingParliamentId);
  const member = mandate?.members.find(item => item.id === memberId);
  if (!mandate) return;
  editingMemberId = member?.id || null;
  document.getElementById('memberForm').reset();
  document.getElementById('memberRole').innerHTML = parliamentRoles().map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  document.getElementById('memberName').value = member?.name || '';
  const replacements = (mandate.members || []).filter(item => item.id !== memberId && item.resignationDate && item.role === (member?.role || role));
  document.getElementById('memberReplaces').innerHTML = '<option value="">Nuova nomina</option>' + replacements.map(item => `<option value="${item.id}">${escapeHtml(item.name)} · dimesso il ${formatDate(item.resignationDate)}</option>`).join('');
  document.getElementById('memberReplaces').value = member?.replacesMemberId || '';
  document.getElementById('memberRole').value = member?.role || role;
  document.getElementById('oathDate').value = member?.oathDate || today();
  document.getElementById('resignationDate').value = member?.resignationDate || '';
  const undoResignationButton = document.getElementById('undoResignationButton');
  undoResignationButton.classList.toggle('d-none', !member?.resignationDate || !capable('parliament.members.undo_resignation'));
  undoResignationButton.dataset.memberId = member?.resignationDate ? member.id : '';
  const partySelect = document.getElementById('memberParty');
  const coalitionSelect = document.getElementById('memberCoalition');
  const partyOptions = [...state.parties].filter(party => party.status !== 'cancellato').sort((a, b) => a.name.localeCompare(b.name));
  const coalitionOptions = [...state.coalitions].filter(coalition => coalition.status !== 'cancellata').sort((a, b) => a.name.localeCompare(b.name));
  partySelect.innerHTML = '<option value="">Nessun partito</option>' + partyOptions.map(party => `<option value="${escapeHtml(party.name)}">${escapeHtml(party.name)}</option>`).join('');
  coalitionSelect.innerHTML = '<option value="">Nessuna coalizione</option>' + coalitionOptions.map(coalition => `<option value="${escapeHtml(coalition.name)}">${escapeHtml(coalition.name)}</option>`).join('');
  partySelect.value = member?.memberParty || '';
  coalitionSelect.value = member?.memberCoalition || '';
  if (!member) syncMemberCoalitionFromParty();
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
  const record = { id: editingMemberId || crypto.randomUUID(), name: document.getElementById('memberName').value.trim(), role, replacesMemberId: document.getElementById('memberReplaces').value || '', oathDate: document.getElementById('oathDate').value, resignationDate: editingMemberId ? document.getElementById('resignationDate').value : '', memberParty: document.getElementById('memberParty').value.trim(), memberCoalition: document.getElementById('memberCoalition').value.trim(), annotations: document.getElementById('memberAnnotations').value.trim(), extra, createdAt: existing?.createdAt || new Date().toISOString() };
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
  if (!capable('parliament.members.resign')) { showToast('Non hai il permesso di registrare dimissioni.'); return; }
  if (!mandate || !member || member.resignationDate || !confirm(`Registrare le dimissioni di ${member.name}?`)) return;
  member.resignationDate = today();
  mandate.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parliaments, state.parliaments);
  renderParliamentMembers(mandate); renderParliaments(); showToast('Dimissioni registrate nello storico.');
}

function undoMemberResignation(memberId) {
  const mandate = state.parliaments.find(item => item.id === editingParliamentId);
  const member = mandate?.members.find(item => item.id === memberId);
  if (!capable('parliament.members.undo_resignation')) { showToast('Non hai il permesso di annullare dimissioni.'); return; }
  if (!mandate || !member?.resignationDate || !confirm(`Annullare le dimissioni di ${member.name}?`)) return;
  member.resignationDate = '';
  mandate.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parliaments, state.parliaments);
  document.getElementById('resignationDate').value = '';
  const button = document.getElementById('undoResignationButton');
  button.classList.add('d-none');
  button.dataset.memberId = '';
  renderParliamentMembers(mandate);
  renderParliaments();
  showToast('Dimissioni annullate. Il parlamentare risulta nuovamente attivo.');
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
  const folderInput = document.getElementById('googleDocumentsFolderId') || document.getElementById('googleDriveFolderId');
  if (folderInput) folderInput.value = state.googleDriveFolders?.documents || '';
  document.getElementById('googleDriveFoldersCard')?.classList.toggle('d-none', !capable('settings.google_folders.edit'));
  ['top', 'right', 'bottom', 'left'].forEach(side => { const input = document.getElementById(`pageMargin${side[0].toUpperCase()}${side.slice(1)}`); if (input) input.value = state.pageMargins[side]; });
  const padding = numberPadding();
  const paddingExample = `${padNumber('1', padding)}, ${padNumber('2', padding)}`;
  document.getElementById('numberingForm').innerHTML = `<div class="row align-items-center g-2 mb-3 pb-3 border-bottom"><div class="col"><label class="form-label mb-0" for="numberPaddingInput">Cifre del progressivo</label><div class="form-text">Gli zeri iniziali sono aggiunti in automatico: ${escapeHtml(paddingExample)}…</div></div><div class="col-auto"><input class="form-control" id="numberPaddingInput" type="number" min="1" max="12" value="${padding}" style="width:6.5rem"></div></div>`
    + categories.map(category => `<div class="row align-items-center g-2 mb-3"><div class="col"><label class="form-label mb-0" for="counter-${encodeURIComponent(category)}">${escapeHtml(category)}</label><div class="form-text">Formato: ${escapeHtml(category)} ${escapeHtml(padNumber('1', padding))}/anno</div></div><div class="col-auto"><input class="form-control counter-input" id="counter-${encodeURIComponent(category)}" data-category="${escapeHtml(category)}" type="text" inputmode="numeric" pattern="[0-9]+" value="${escapeHtml(nextNumber(category))}"></div></div>`).join('')
    + '<button class="btn btn-primary mt-2" type="submit">Salva numerazione</button>';
  document.getElementById('categoryList').innerHTML = categories.map(category => `<span class="d-flex justify-content-between align-items-center gap-2 border-bottom pb-2"><span>${escapeHtml(category)}<small class="d-block text-secondary">${state.templates.filter(template => template.category === category).length} template${state.documents.some(document => document.category === category) ? ` · ${state.documents.filter(document => document.category === category) ? state.documents.filter(document => document.category === category).length : 0} documenti` : ''}</small></span><span class="d-flex align-items-center gap-2"><strong>${nextNumber(category)}</strong><button type="button" class="btn btn-sm btn-outline-danger" data-delete-category="${escapeHtml(category)}" title="Elimina categoria">Elimina</button></span></span>`).join('');
  document.getElementById('categoryList').innerHTML = categories.map(category => `<span class="d-flex justify-content-between align-items-center gap-2 border-bottom pb-2"><span>${escapeHtml(category)}<small class="d-block text-secondary">${state.templates.filter(template => template.category === category).length} template${state.documents.some(document => document.category === category) ? ` · ${state.documents.filter(document => document.category === category) ? state.documents.filter(document => document.category === category).length : 0} documenti` : ''}</small></span><span class="d-flex align-items-center gap-2"><strong>${nextNumber(category)}</strong><button type="button" class="btn btn-sm btn-outline-danger" data-delete-category="${escapeHtml(category)}" title="Elimina categoria">Elimina</button></span></span>`).join('');
  document.getElementById('partyFieldList').innerHTML = state.partyFields.length ? state.partyFields.map(field => `<div class="d-flex justify-content-between align-items-center border-bottom pb-2"><span>${escapeHtml(field.name)}<small class="d-block text-secondary">Obbligatorio nei nuovi partiti</small></span><button type="button" class="btn btn-sm btn-outline-danger" data-remove-party-field="${field.id}" title="Rimuovi campo">Rimuovi</button></div>`).join('') : '<p class="text-secondary small mb-0">Nessun campo configurato. Il nome, lo status e lo Statuto sono sempre disponibili.</p>';
  const coalitionFieldList = document.getElementById('coalitionFieldList');
  if (coalitionFieldList) coalitionFieldList.innerHTML = state.coalitionFields.length ? state.coalitionFields.map(field => `<div class="d-flex justify-content-between align-items-center border-bottom pb-2"><span>${escapeHtml(field.name)}<small class="d-block text-secondary">Obbligatorio nelle nuove coalizioni</small></span><button type="button" class="btn btn-sm btn-outline-danger" data-remove-coalition-field="${field.id}" title="Rimuovi campo">Rimuovi</button></div>`).join('') : '<p class="text-secondary small mb-0">Nessun campo configurato. Il nome e lo status sono sempre disponibili.</p>';
  const parliamentSettingsForm = document.getElementById('parliamentSettingsForm');
  parliamentSettingsForm.innerHTML = `<div id="parliamentRoleSettings" class="col-12 vstack gap-2">${parliamentRoles().map(role => `<div class="row g-2 align-items-end parliament-role-setting" data-role-id="${role.id}"><div class="col"><label class="form-label">Nome ruolo</label><input class="form-control parliament-role-name" value="${escapeHtml(role.name)}" required></div><div class="col-auto"><label class="form-label">Numero</label><input class="form-control parliament-role-limit" type="number" min="0" value="${role.limit}" required></div><div class="col-auto"><button type="button" class="btn btn-outline-danger remove-parliament-role" data-role-id="${role.id}" ${parliamentRoles().length <= 1 ? 'disabled' : ''}>Rimuovi</button></div></div>`).join('')}</div><div class="col-12 d-flex gap-2"><button type="button" class="btn btn-outline-primary" id="addParliamentRole">+ Nuovo ruolo</button><button class="btn btn-primary" type="submit">Salva configurazione</button></div>`;
  document.getElementById('parliamentFieldList').innerHTML = state.parliamentSettings.fields.length ? state.parliamentSettings.fields.map(field => `<div class="d-flex justify-content-between align-items-center border-bottom pb-2"><span>${escapeHtml(field.name)}<small class="d-block text-secondary">Disponibile per ogni parlamentare</small></span><button type="button" class="btn btn-sm btn-outline-danger" data-remove-parliament-field="${field.id}">Rimuovi</button></div>`).join('') : '<p class="text-secondary small mb-0">Nessuna informazione aggiuntiva configurata.</p>';
}

function renderPartyFields(party = null) {
  const fields = document.getElementById('partyFields');
  let html = state.partyFields.map(field => `<div class="col-12 col-md-6"><label class="form-label" for="party-field-${field.id}">${escapeHtml(field.name)}</label><input id="party-field-${field.id}" class="form-control party-field-input" data-field-id="${field.id}" required value="${escapeHtml(party?.fields?.[field.id] || '')}"></div>`).join('');
  if (party) {
    const hasStatute = Boolean(party.googleStatuteDocumentId || party.googleUrl || party.statuteUrl);
    const isGoogle = Boolean(party.googleStatuteDocumentId);
    const statusText = isGoogle ? 'Statuto Google collegato' : (hasStatute ? 'Statuto web collegato' : 'Nessuno statuto ancora collegato');
    html += `<div class="col-12 mt-3"><div class="p-3 border rounded bg-white shadow-sm d-flex justify-content-between align-items-center"><div><strong class="d-block">Statuto del partito</strong><span class="text-secondary small">${escapeHtml(statusText)}</span></div><div class="d-flex gap-2">${hasStatute && capable('party_statutes.change_link') ? `<button type="button" class="btn btn-sm btn-outline-primary" data-relink-party-statute="${party.id}">Cambia link</button>` : ''}<button type="button" class="btn btn-sm ${hasStatute ? 'btn-primary' : 'btn-outline-primary'}" data-open-party-statute="${party.id}"><i class="bi ${hasStatute ? 'bi-box-arrow-up-right me-1' : 'bi-plus-lg me-1'}"></i>${hasStatute ? 'Vedi statuto' : 'Collega statuto'}</button></div></div></div>`;
    html += `<div class="col-12 mt-3"><div class="p-3 border rounded bg-white shadow-sm d-flex justify-content-between align-items-center"><div><strong class="d-block">Statuto del partito</strong><span class="text-secondary small">${escapeHtml(statusText)}</span></div><div class="d-flex gap-2">${hasStatute && capable('party_statutes.change_link') ? `<button type="button" class="btn btn-sm btn-outline-primary" data-relink-party-statute="${party.id}">Cambia link</button>` : ''}<button type="button" class="btn btn-sm ${hasStatute ? 'btn-primary' : 'btn-outline-primary'}" data-open-party-statute="${party.id}"><i class="bi ${hasStatute ? 'bi-box-arrow-up-right me-1' : 'bi-plus-lg me-1'}"></i>${hasStatute ? 'Vedi statuto' : 'Collega statuto'}</button></div></div></div>`;
  }
  fields.innerHTML = html;
}

function renderPartyHistory(party = null) {
  const panel = document.getElementById('partyHistoryPanel');
  const list = document.getElementById('partyHistory');
  const empty = document.getElementById('partyHistoryEmpty');
  const clearBtn = document.getElementById('clearPartyHistoryButton');
  const formCol = document.getElementById('partyFormColumn');
  if (!panel || !list) return;

  if (!party || !capable('parties.view_history')) {
    panel.classList.add('d-none');
    if (formCol) formCol.className = 'col-12';
    return;
  }
  panel.classList.remove('d-none');
  if (formCol) formCol.className = 'col-12 col-lg-7';

  const history = Array.isArray(party.history) ? party.history : [];
  if (clearBtn) {
    clearBtn.classList.toggle('d-none', history.length === 0 || !capable('parties.edit'));
    clearBtn.dataset.partyId = party.id;
  }

  if (history.length === 0) {
    list.innerHTML = '';
    list.classList.add('d-none');
    if (empty) empty.classList.remove('d-none');
    return;
  }

  if (empty) empty.classList.add('d-none');
  list.classList.remove('d-none');

  const canEdit = capable('parties.edit');
  list.innerHTML = history.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => {
    const isStatute = entry.label === 'Statuto' || entry.label === 'Statuto Google';
    const dateStr = entry.at ? formatDate(entry.at.slice(0, 10)) : 'Data non registrata';
    const modifier = entry.googleModifiedBy ? ` · ${escapeHtml(entry.googleModifiedBy)}` : '';
    const deleteBtnHtml = canEdit ? `<button type="button" class="btn btn-sm btn-outline-danger btn-delete-history-item" data-delete-party-history="${party.id}" data-history-index="${index}" title="Elimina questa voce dalla cronologia"><i class="bi bi-trash"></i></button>` : '';

    if (isStatute && (entry.previousStatute !== undefined || entry.nextStatute !== undefined)) {
      return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
        <button type="button" class="history-version-btn flex-grow-1 text-start" data-open-statute-history="${party.id}" data-history-index="${index}">
          <strong>${escapeHtml(entry.label)}</strong>
          <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}${modifier}</span>
          <span class="d-block small text-primary mt-1"><i class="bi bi-file-diff me-1"></i>Apri confronto versioni</span>
        </button>
        ${deleteBtnHtml}
      </div>`;
    }

    return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
      <div class="flex-grow-1">
        <strong>${escapeHtml(entry.label)}</strong>
        <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}${modifier}</span>
      </div>
      ${deleteBtnHtml}
    </div>`;
  }).join('');
}

async function deletePartyHistoryItem(partyId, index) {
  if (!capable('parties.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const party = state.parties.find(item => item.id === partyId);
  const idx = Number(index);
  if (!party || !Array.isArray(party.history) || idx < 0 || idx >= party.history.length) return;
  if (!confirm('Vuoi eliminare questa voce dalla cronologia del partito?')) return;

  party.history.splice(idx, 1);
  party.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parties, state.parties);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('parties');
  }
  renderPartyHistory(party);
  renderParties();
  showToast('Voce della cronologia eliminata.');
}

async function clearPartyHistory(partyId) {
  if (!capable('parties.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const party = state.parties.find(item => item.id === partyId);
  if (!party || !Array.isArray(party.history) || party.history.length === 0) return;
  if (!confirm(`Sei sicuro di voler eliminare interamente la cronologia del partito «${party.name}»? L'operazione non può essere annullata.`)) return;

  party.history = [];
  party.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parties, state.parties);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('parties');
  }
  renderPartyHistory(party);
  renderParties();
  showToast('Cronologia del partito svuotata.');
  const list = document.getElementById('partyHistory');
  const empty = document.getElementById('partyHistoryEmpty');
  const clearBtn = document.getElementById('clearPartyHistoryButton');
  const formCol = document.getElementById('partyFormColumn');
  if (!panel || !list) return;

  if (!party || !capable('parties.view_history')) {
    panel.classList.add('d-none');
    if (formCol) formCol.className = 'col-12';
    return;
  }
  panel.classList.remove('d-none');
  if (formCol) formCol.className = 'col-12 col-lg-7';

  const history = Array.isArray(party.history) ? party.history : [];
  if (clearBtn) {
    clearBtn.classList.toggle('d-none', history.length === 0 || !capable('parties.edit'));
    clearBtn.dataset.partyId = party.id;
  }

  if (history.length === 0) {
    list.innerHTML = '';
    list.classList.add('d-none');
    if (empty) empty.classList.remove('d-none');
    return;
  }

  if (empty) empty.classList.add('d-none');
  list.classList.remove('d-none');

  const canEdit = capable('parties.edit');
  list.innerHTML = history.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => {
    const isStatute = entry.label === 'Statuto' || entry.label === 'Statuto Google';
    const dateStr = entry.at ? formatDate(entry.at.slice(0, 10)) : 'Data non registrata';
    const modifier = entry.googleModifiedBy ? ` · ${escapeHtml(entry.googleModifiedBy)}` : '';
    const deleteBtnHtml = canEdit ? `<button type="button" class="btn btn-sm btn-outline-danger btn-delete-history-item" data-delete-party-history="${party.id}" data-history-index="${index}" title="Elimina questa voce dalla cronologia"><i class="bi bi-trash"></i></button>` : '';

    if (isStatute && (entry.previousStatute !== undefined || entry.nextStatute !== undefined)) {
      return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
        <button type="button" class="history-version-btn flex-grow-1 text-start" data-open-statute-history="${party.id}" data-history-index="${index}">
          <strong>${escapeHtml(entry.label)}</strong>
          <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}${modifier}</span>
          <span class="d-block small text-primary mt-1"><i class="bi bi-file-diff me-1"></i>Apri confronto versioni</span>
        </button>
        ${deleteBtnHtml}
      </div>`;
    }

    return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
      <div class="flex-grow-1">
        <strong>${escapeHtml(entry.label)}</strong>
        <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}${modifier}</span>
      </div>
      ${deleteBtnHtml}
    </div>`;
  }).join('');
}

async function deletePartyHistoryItem(partyId, index) {
  if (!capable('parties.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const party = state.parties.find(item => item.id === partyId);
  const idx = Number(index);
  if (!party || !Array.isArray(party.history) || idx < 0 || idx >= party.history.length) return;
  if (!confirm('Vuoi eliminare questa voce dalla cronologia del partito?')) return;

  party.history.splice(idx, 1);
  party.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parties, state.parties);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('parties');
  }
  renderPartyHistory(party);
  renderParties();
  showToast('Voce della cronologia eliminata.');
}

async function clearPartyHistory(partyId) {
  if (!capable('parties.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const party = state.parties.find(item => item.id === partyId);
  if (!party || !Array.isArray(party.history) || party.history.length === 0) return;
  if (!confirm(`Sei sicuro di voler eliminare interamente la cronologia del partito «${party.name}»? L'operazione non può essere annullata.`)) return;

  party.history = [];
  party.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.parties, state.parties);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('parties');
  }
  renderPartyHistory(party);
  renderParties();
  showToast('Cronologia del partito svuotata.');
}

function renderCompanyHistory(company = null) {
  const panel = document.getElementById('companyHistoryPanel');
  const list = document.getElementById('companyHistory');
  const empty = document.getElementById('companyHistoryEmpty');
  const clearBtn = document.getElementById('clearCompanyHistoryButton');
  const formCol = document.getElementById('companyFormColumn');
  if (!panel || !list) return;

  if (!company || !capable('companies.view_history')) {
    panel.classList.add('d-none');
    if (formCol) formCol.className = 'col-12';
    return;
  }
  panel.classList.remove('d-none');
  if (formCol) formCol.className = 'col-12 col-lg-7';

  const history = Array.isArray(company.history) ? company.history : [];
  const canEdit = capable('companies.edit') || capable('company_regulations.edit');
  if (clearBtn) {
    clearBtn.classList.toggle('d-none', history.length === 0 || !canEdit);
    clearBtn.dataset.companyId = company.id;
  }

  if (history.length === 0) {
    list.innerHTML = '';
    list.classList.add('d-none');
    if (empty) empty.classList.remove('d-none');
    return;
  }

  if (empty) empty.classList.add('d-none');
  list.classList.remove('d-none');

  list.innerHTML = history.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => {
    const isRegulation = entry.label === 'Regolamento' || entry.label === 'Regolamento Google';
    const dateStr = entry.at ? formatDate(entry.at.slice(0, 10)) : 'Data non registrata';
    const modifier = entry.googleModifiedBy ? ` · ${escapeHtml(entry.googleModifiedBy)}` : '';
    const deleteBtnHtml = canEdit ? `<button type="button" class="btn btn-sm btn-outline-danger btn-delete-history-item" data-delete-company-history="${company.id}" data-history-index="${index}" title="Elimina questa voce dalla cronologia"><i class="bi bi-trash"></i></button>` : '';

    if (isRegulation && (entry.previousStatute !== undefined || entry.nextStatute !== undefined)) {
      return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
        <button type="button" class="history-version-btn flex-grow-1 text-start" data-open-company-history="${company.id}" data-history-index="${index}">
          <strong>${escapeHtml(entry.label)}</strong>
          <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}${modifier}</span>
          <span class="d-block small text-primary mt-1"><i class="bi bi-file-diff me-1"></i>Apri confronto versioni</span>
        </button>
        ${deleteBtnHtml}
      </div>`;
    }

    return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
      <div class="flex-grow-1">
        <strong>${escapeHtml(entry.label)}</strong>
        <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}${modifier}</span>
      </div>
      ${deleteBtnHtml}
    </div>`;
  }).join('');
}

async function deleteCompanyHistoryItem(companyId, index) {
  if (!capable('companies.edit') && !capable('company_regulations.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const company = state.companies.find(item => item.id === companyId);
  const idx = Number(index);
  if (!company || !Array.isArray(company.history) || idx < 0 || idx >= company.history.length) return;
  if (!confirm('Vuoi eliminare questa voce dalla cronologia dell’azienda?')) return;

  company.history.splice(idx, 1);
  company.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.companies, state.companies);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('companies');
  }
  renderCompanyHistory(company);
  renderCompanies();
  showToast('Voce della cronologia eliminata.');
}

async function clearCompanyHistory(companyId) {
  if (!capable('companies.edit') && !capable('company_regulations.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const company = state.companies.find(item => item.id === companyId);
  if (!company || !Array.isArray(company.history) || company.history.length === 0) return;
  if (!confirm(`Sei sicuro di voler eliminare interamente la cronologia dell’azienda «${company.name}»? L'operazione non può essere annullata.`)) return;

  company.history = [];
  company.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.companies, state.companies);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('companies');
  }
  renderCompanyHistory(company);
  renderCompanies();
  showToast('Cronologia dell’azienda svuotata.');
  const list = document.getElementById('companyHistory');
  const empty = document.getElementById('companyHistoryEmpty');
  const clearBtn = document.getElementById('clearCompanyHistoryButton');
  const formCol = document.getElementById('companyFormColumn');
  if (!panel || !list) return;

  if (!company || !capable('companies.view_history')) {
    panel.classList.add('d-none');
    if (formCol) formCol.className = 'col-12';
    return;
  }
  panel.classList.remove('d-none');
  if (formCol) formCol.className = 'col-12 col-lg-7';

  const history = Array.isArray(company.history) ? company.history : [];
  const canEdit = capable('companies.edit') || capable('company_regulations.edit');
  if (clearBtn) {
    clearBtn.classList.toggle('d-none', history.length === 0 || !canEdit);
    clearBtn.dataset.companyId = company.id;
  }

  if (history.length === 0) {
    list.innerHTML = '';
    list.classList.add('d-none');
    if (empty) empty.classList.remove('d-none');
    return;
  }

  if (empty) empty.classList.add('d-none');
  list.classList.remove('d-none');

  list.innerHTML = history.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => {
    const isRegulation = entry.label === 'Regolamento' || entry.label === 'Regolamento Google';
    const dateStr = entry.at ? formatDate(entry.at.slice(0, 10)) : 'Data non registrata';
    const modifier = entry.googleModifiedBy ? ` · ${escapeHtml(entry.googleModifiedBy)}` : '';
    const deleteBtnHtml = canEdit ? `<button type="button" class="btn btn-sm btn-outline-danger btn-delete-history-item" data-delete-company-history="${company.id}" data-history-index="${index}" title="Elimina questa voce dalla cronologia"><i class="bi bi-trash"></i></button>` : '';

    if (isRegulation && (entry.previousStatute !== undefined || entry.nextStatute !== undefined)) {
      return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
        <button type="button" class="history-version-btn flex-grow-1 text-start" data-open-company-history="${company.id}" data-history-index="${index}">
          <strong>${escapeHtml(entry.label)}</strong>
          <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}${modifier}</span>
          <span class="d-block small text-primary mt-1"><i class="bi bi-file-diff me-1"></i>Apri confronto versioni</span>
        </button>
        ${deleteBtnHtml}
      </div>`;
    }

    return `<div class="history-entry history-entry-row d-flex justify-content-between align-items-center gap-2">
      <div class="flex-grow-1">
        <strong>${escapeHtml(entry.label)}</strong>
        <span class="d-block small text-secondary">${escapeHtml(entry.from || '—')} → ${escapeHtml(entry.to || '—')} · ${dateStr}${modifier}</span>
      </div>
      ${deleteBtnHtml}
    </div>`;
  }).join('');
}

async function deleteCompanyHistoryItem(companyId, index) {
  if (!capable('companies.edit') && !capable('company_regulations.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const company = state.companies.find(item => item.id === companyId);
  const idx = Number(index);
  if (!company || !Array.isArray(company.history) || idx < 0 || idx >= company.history.length) return;
  if (!confirm('Vuoi eliminare questa voce dalla cronologia dell’azienda?')) return;

  company.history.splice(idx, 1);
  company.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.companies, state.companies);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('companies');
  }
  renderCompanyHistory(company);
  renderCompanies();
  showToast('Voce della cronologia eliminata.');
}

async function clearCompanyHistory(companyId) {
  if (!capable('companies.edit') && !capable('company_regulations.edit')) {
    showToast('Non hai il permesso di modificare la cronologia.');
    return;
  }
  const company = state.companies.find(item => item.id === companyId);
  if (!company || !Array.isArray(company.history) || company.history.length === 0) return;
  if (!confirm(`Sei sicuro di voler eliminare interamente la cronologia dell’azienda «${company.name}»? L'operazione non può essere annullata.`)) return;

  company.history = [];
  company.updatedAt = new Date().toISOString();
  writeStorage(STORAGE_KEYS.companies, state.companies);
  if (remoteMode) {
    clearTimeout(remoteSaveTimer);
    await saveRemoteState('companies');
  }
  renderCompanyHistory(company);
  renderCompanies();
  showToast('Cronologia dell’azienda svuotata.');
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
  if (!capable('party_statutes.view_history')) { showToast('Non hai il permesso di confrontare le versioni degli statuti.'); return; }
  const party = state.parties.find(item => item.id === partyId);
  const entry = party?.history?.[Number(historyIndex)];
  if (!party || !entry) return;
  const hasStoredVersions = entry.previousStatute !== undefined && entry.nextStatute !== undefined;
  const diff = hasStoredVersions ? diffStatuteText(plainText(entry.previousStatute), plainText(entry.nextStatute)) : { previous: '<span class="text-secondary">Versione precedente non disponibile: questa modifica è stata registrata prima dell’archiviazione delle versioni.</span>', next: escapeHtml(plainText(party.statute || '')) || '<span class="text-secondary">Nessun contenuto</span>' };
  document.getElementById('statuteHistoryTitle').textContent = `${party.name} · Statuto`;
  document.getElementById('statuteHistoryDate').textContent = `Versione salvata il ${formatDate(entry.at ? entry.at.slice(0, 10) : '')}`;
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

async function openPartyStatuteEditor(partyId, changeLink = false) {
  const party = state.parties.find(item => item.id === partyId);
  if (!party) return;
  const docUrl = party.statuteUrl || party.googleUrl || (party.googleStatuteDocumentId ? `https://docs.google.com/document/d/${encodeURIComponent(party.googleStatuteDocumentId)}/edit` : null);
  if (docUrl && !changeLink) {
    if (!capable('party_statutes.view')) { showToast('Non hai il permesso di visualizzare lo statuto.'); return; }
    window.open(docUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  const requiredCapability = docUrl ? 'party_statutes.change_link' : 'party_statutes.link';
  if (!capable(requiredCapability)) { showToast(docUrl ? 'Non hai il permesso di modificare il collegamento dello statuto.' : 'Non hai il permesso di collegare lo statuto.'); return; }
  editingPartyId = party.id;
  document.getElementById('partyStatutePartyName').textContent = party.name;
  document.getElementById('partyStatuteSubtitle').textContent = docUrl ? 'Modifica il link dello Statuto (Google Documenti o pagina web esterna).' : 'Inserisci il link dello Statuto (Google Documenti o pagina web esterna).';
  document.getElementById('partyStatuteSubtitle').textContent = docUrl ? 'Modifica il link dello Statuto (Google Documenti o pagina web esterna).' : 'Inserisci il link dello Statuto (Google Documenti o pagina web esterna).';
  const status = document.getElementById('partyStatuteStatus');
  status.textContent = statusLabel(party.status);
  status.className = `badge ${statusClass(party.status)}`;
  document.getElementById('partyStatuteGoogleUrl').value = docUrl || '';
  document.getElementById('partyStatuteGoogleTitle').textContent = docUrl ? 'Modifica il link dello statuto' : 'Collega uno statuto';
  document.getElementById('openPartyStatuteGoogleButton').innerHTML = `<i class="bi bi-link-45deg me-1"></i>${docUrl ? 'Salva e sostituisci' : 'Salva e collega'}`;
  document.getElementById('partyStatuteGoogleTitle').textContent = docUrl ? 'Modifica il link dello statuto' : 'Collega uno statuto';
  document.getElementById('openPartyStatuteGoogleButton').innerHTML = `<i class="bi bi-link-45deg me-1"></i>${docUrl ? 'Salva e sostituisci' : 'Salva e collega'}`;
  const showLinkEditor = () => showEditorScreen('partyStatuteEditor');
  const partyModal = document.getElementById('partyModal');
  if (partyModal.classList.contains('show')) {
    partyModal.addEventListener('hidden.bs.modal', showLinkEditor, { once: true });
    bootstrap.Modal.getOrCreateInstance(partyModal).hide();
  } else showLinkEditor();
}

function openCompanyEditor(companyId = '') {
  const company = state.companies.find(item => item.id === companyId);
  editingCompanyId = company?.id || null;
  document.getElementById('companyForm').reset();
  document.getElementById('companyName').value = company?.name || '';
  const regContainer = document.getElementById('companyModalRegulationContainer');
  if (regContainer) {
    if (company) {
      const hasRegulation = Boolean(company.googleRegulationDocumentId || company.googleUrl || company.regulationUrl);
      const isGoogle = Boolean(company.googleRegulationDocumentId);
      const regText = isGoogle ? 'Regolamento Google collegato' : (hasRegulation ? 'Regolamento web collegato' : 'Nessun regolamento ancora collegato');
      regContainer.classList.remove('d-none');
      regContainer.innerHTML = `<div class="p-3 border rounded bg-white shadow-sm d-flex justify-content-between align-items-center mb-3"><div><strong class="d-block">Regolamento aziendale</strong><span class="text-secondary small">${escapeHtml(regText)}</span></div><div class="d-flex gap-2">${hasRegulation && capable('company_regulations.change_link') ? `<button type="button" class="btn btn-sm btn-outline-primary" data-relink-company-regulation="${company.id}">Cambia link</button>` : ''}<button type="button" class="btn btn-sm ${hasRegulation ? 'btn-primary' : 'btn-outline-primary'}" data-open-company-regulation="${company.id}"><i class="bi ${hasRegulation ? 'bi-box-arrow-up-right me-1' : 'bi-plus-lg me-1'}"></i>${hasRegulation ? 'Vedi regolamento' : 'Collega regolamento'}</button></div></div>`;
      regContainer.innerHTML = `<div class="p-3 border rounded bg-white shadow-sm d-flex justify-content-between align-items-center mb-3"><div><strong class="d-block">Regolamento aziendale</strong><span class="text-secondary small">${escapeHtml(regText)}</span></div><div class="d-flex gap-2">${hasRegulation && capable('company_regulations.change_link') ? `<button type="button" class="btn btn-sm btn-outline-primary" data-relink-company-regulation="${company.id}">Cambia link</button>` : ''}<button type="button" class="btn btn-sm ${hasRegulation ? 'btn-primary' : 'btn-outline-primary'}" data-open-company-regulation="${company.id}"><i class="bi ${hasRegulation ? 'bi-box-arrow-up-right me-1' : 'bi-plus-lg me-1'}"></i>${hasRegulation ? 'Vedi regolamento' : 'Collega regolamento'}</button></div></div>`;
    } else {
      regContainer.classList.add('d-none');
      regContainer.innerHTML = '';
    }
  }
  renderCompanyHistory(company);
  document.querySelector('#companyModal .modal-title').textContent = company ? 'Modifica azienda' : 'Nuova azienda';
  document.querySelector('#companyModal button[type="submit"]').textContent = company ? 'Salva modifiche' : 'Salva azienda';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('companyModal')).show();
}

async function openCompanyRegulationEditor(companyId, changeLink = false) {
  const company = state.companies.find(item => item.id === companyId);
  if (!company) return;
  const docUrl = company.regulationUrl || company.googleUrl || (company.googleRegulationDocumentId ? `https://docs.google.com/document/d/${encodeURIComponent(company.googleRegulationDocumentId)}/edit` : null);
  if (docUrl && !changeLink) {
    if (!capable('company_regulations.view')) { showToast('Non hai il permesso di visualizzare il regolamento.'); return; }
    window.open(docUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  const requiredCapability = docUrl ? 'company_regulations.change_link' : 'company_regulations.link';
  if (!capable(requiredCapability)) { showToast(docUrl ? 'Non hai il permesso di modificare il collegamento del regolamento.' : 'Non hai il permesso di collegare il regolamento.'); return; }
  editingCompanyId = company.id;
  document.getElementById('companyRegulationCompanyName').textContent = company.name;
  document.getElementById('companyRegulationSubtitle').textContent = docUrl ? 'Modifica il link del Regolamento (Google Documenti o pagina web esterna).' : 'Inserisci il link del Regolamento (Google Documenti o pagina web esterna).';
  document.getElementById('companyRegulationSubtitle').textContent = docUrl ? 'Modifica il link del Regolamento (Google Documenti o pagina web esterna).' : 'Inserisci il link del Regolamento (Google Documenti o pagina web esterna).';
  document.getElementById('companyRegulationGoogleUrl').value = docUrl || '';
  document.getElementById('companyRegulationGoogleTitle').textContent = docUrl ? 'Modifica il link del regolamento' : 'Collega un regolamento';
  document.getElementById('openCompanyRegulationGoogleButton').innerHTML = `<i class="bi bi-link-45deg me-1"></i>${docUrl ? 'Salva e sostituisci' : 'Salva e collega'}`;
  document.getElementById('companyRegulationGoogleTitle').textContent = docUrl ? 'Modifica il link del regolamento' : 'Collega un regolamento';
  document.getElementById('openCompanyRegulationGoogleButton').innerHTML = `<i class="bi bi-link-45deg me-1"></i>${docUrl ? 'Salva e sostituisci' : 'Salva e collega'}`;
  const showLinkEditor = () => showEditorScreen('companyRegulationEditor');
  const companyModal = document.getElementById('companyModal');
  if (companyModal.classList.contains('show')) {
    companyModal.addEventListener('hidden.bs.modal', showLinkEditor, { once: true });
    bootstrap.Modal.getOrCreateInstance(companyModal).hide();
  } else showLinkEditor();
}

function closeCompanyRegulationEditor() {
  editingCompanyId = null;
  setView('companies');
}

async function saveCompanyRegulation(event) {
  event.preventDefault();
  const company = state.companies.find(item => item.id === editingCompanyId);
  if (!company) return;
  const rawUrl = document.getElementById('companyRegulationGoogleUrl').value.trim();
  if (!rawUrl) { showToast('Inserisci un link valido per il regolamento.'); return; }
  let url = rawUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const docId = extractGoogleDocId(url);
    url = docId ? `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit` : `https://${url}`;
  }
  try {
    const previousUrl = company.regulationUrl || company.googleUrl || (company.googleRegulationDocumentId ? `https://docs.google.com/document/d/${company.googleRegulationDocumentId}/edit` : '');
    const replacing = Boolean(previousUrl);
    let linked = null;
    if (remoteMode) {
      linked = await apiRequest('google_document_link', { method: 'POST', body: JSON.stringify({ scope: 'company_regulations', entityId: company.id, url }) });
    }
    const isGoogle = linked ? Boolean(linked.isGoogleDoc) : Boolean(extractGoogleDocId(url));
    const docId = linked?.id || (isGoogle ? extractGoogleDocId(url) : null);
    const docName = linked?.name || null;
    const finalUrl = linked?.url || url;

    if (company.googleRegulationDocumentId && company.googleRegulationDocumentId !== docId) {
      const rawUrl = document.getElementById('companyRegulationGoogleUrl').value.trim();
      if (!rawUrl) { showToast('Inserisci un link valido per il regolamento.'); return; }
      let url = rawUrl;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        const docId = extractGoogleDocId(url);
        url = docId ? `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit` : `https://${url}`;
      }
      try {
        const previousUrl = company.regulationUrl || company.googleUrl || (company.googleRegulationDocumentId ? `https://docs.google.com/document/d/${company.googleRegulationDocumentId}/edit` : '');
        const replacing = Boolean(previousUrl);
        let linked = null;
        if (remoteMode) {
          linked = await apiRequest('google_document_link', { method: 'POST', body: JSON.stringify({ scope: 'company_regulations', entityId: company.id, url }) });
        }
        const isGoogle = linked ? Boolean(linked.isGoogleDoc) : Boolean(extractGoogleDocId(url));
        const docId = linked?.id || (isGoogle ? extractGoogleDocId(url) : null);
        const docName = linked?.name || null;
        const finalUrl = linked?.url || url;

        if (company.googleRegulationDocumentId && company.googleRegulationDocumentId !== docId) {
          company.googleLatestText = '';
          company.googleModifiedBy = null;
        }
        company.googleRegulationDocumentId = isGoogle ? docId : null;
        company.googleRegulationName = docName;
        company.googleDocumentName = docName;
        company.googleUrl = finalUrl;
        company.regulationUrl = finalUrl;
        company.regulation = isGoogle ? 'Regolamento Google collegato' : 'Regolamento esterno collegato';
        company.googleModifiedTime = linked?.modifiedTime || null;
        company.googleRegulationDocumentId = isGoogle ? docId : null;
        company.googleRegulationName = docName;
        company.googleDocumentName = docName;
        company.googleUrl = finalUrl;
        company.regulationUrl = finalUrl;
        company.regulation = isGoogle ? 'Regolamento Google collegato' : 'Regolamento esterno collegato';
        company.googleModifiedTime = linked?.modifiedTime || null;
        company.updatedAt = new Date().toISOString();
        if (!Array.isArray(company.history)) company.history = [];
        company.history.push({
          label: isGoogle ? 'Regolamento Google' : 'Regolamento',
          from: previousUrl || 'Nessun regolamento',
          to: finalUrl,
          at: new Date().toISOString()
        });
        if (!Array.isArray(company.history)) company.history = [];
        company.history.push({
          label: isGoogle ? 'Regolamento Google' : 'Regolamento',
          from: previousUrl || 'Nessun regolamento',
          to: finalUrl,
          at: new Date().toISOString()
        });
        writeStorage(STORAGE_KEYS.companies, state.companies);
        if (remoteMode) { clearTimeout(remoteSaveTimer); await saveRemoteState('companies'); }
        closeCompanyRegulationEditor();
        renderCompanies();
        showToast(replacing ? 'Collegamento del regolamento aggiornato.' : 'Regolamento collegato.');
      } catch (error) { showToast(error.message || 'Impossibile collegare il regolamento.'); }
    }

    function openCompanyHistory(companyId, historyIndex) {
      if (!capable('company_regulations.view_history')) { showToast('Non hai il permesso di confrontare le versioni dei regolamenti.'); return; }
      const company = state.companies.find(item => item.id === companyId);
      const entry = company?.history?.[Number(historyIndex)];
      if (!company || !entry) return;
      const hasStoredVersions = entry.previousStatute !== undefined && entry.nextStatute !== undefined;
      const diff = hasStoredVersions ? diffStatuteText(plainText(entry.previousStatute), plainText(entry.nextStatute)) : { previous: '<span class="text-secondary">Versione precedente non disponibile.</span>', next: escapeHtml(plainText(company.regulation || '')) || '<span class="text-secondary">Nessun contenuto</span>' };
      document.getElementById('statuteHistoryTitle').textContent = `${company.name} · Regolamento`;
      document.getElementById('statuteHistoryDate').textContent = `Versione salvata il ${formatDate(entry.at ? entry.at.slice(0, 10) : '')}`;
      document.getElementById('statutePreviousVersion').innerHTML = diff.previous;
      document.getElementById('statuteNextVersion').innerHTML = diff.next;
      const showComparison = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('statuteHistoryModal')).show();
      const companyModal = document.getElementById('companyModal');
      if (companyModal.classList.contains('show')) {
        companyModal.addEventListener('hidden.bs.modal', showComparison, { once: true });
        bootstrap.Modal.getOrCreateInstance(companyModal).hide();
      } else showComparison();
    }

    async function saveCompany(event) {
      event.preventDefault();
      const name = document.getElementById('companyName').value.trim();
      if (!name) { showToast('Inserisci il nome dell’azienda.'); return; }
      const existingCompany = state.companies.find(item => item.id === editingCompanyId);
      const history = existingCompany?.history ? [...existingCompany.history] : [];
      if (existingCompany && existingCompany.name !== name) history.push({ label: 'Nome', from: existingCompany.name, to: name, at: new Date().toISOString() });
      // Il file è collegato da Drive: il suo nome resta gestito su Google e viene
      // riallineato dalla sincronizzazione, senza rinominarlo insieme all'azienda.
      const regulationName = existingCompany?.googleRegulationName || '';
      const record = {
        id: editingCompanyId || crypto.randomUUID(),
        name,
        regulation: existingCompany?.regulation || '',
        googleRegulationDocumentId: existingCompany?.googleRegulationDocumentId || null,
        googleRegulationName: regulationName || null,
        googleLatestText: existingCompany?.googleLatestText || '',
        googleUrl: existingCompany?.googleUrl || null,
        regulationUrl: existingCompany?.regulationUrl || existingCompany?.googleUrl || null,
        googleModifiedTime: existingCompany?.googleModifiedTime || null,
        googleModifiedBy: existingCompany?.googleModifiedBy || null,
        history,
        createdAt: existingCompany?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (existingCompany) state.companies[state.companies.indexOf(existingCompany)] = record;
      else state.companies.unshift(record);
      writeStorage(STORAGE_KEYS.companies, state.companies);
      bootstrap.Modal.getOrCreateInstance(document.getElementById('companyModal')).hide();
      editingCompanyId = null;
      renderCompanies();
      showToast(existingCompany ? 'Azienda aggiornata.' : 'Azienda salvata.');
    }

    function closePartyStatuteEditor() {
      editingPartyId = null;
      setView('parties');
    }

    async function savePartyStatute(event) {
      event.preventDefault();
      const party = state.parties.find(item => item.id === editingPartyId);
      if (!party) return;
      const rawUrl = document.getElementById('partyStatuteGoogleUrl').value.trim();
      if (!rawUrl) { showToast('Inserisci un link valido per lo statuto.'); return; }
      let url = rawUrl;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        const docId = extractGoogleDocId(url);
        url = docId ? `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit` : `https://${url}`;
      }
      try {
        const previousUrl = party.statuteUrl || party.googleUrl || (party.googleStatuteDocumentId ? `https://docs.google.com/document/d/${party.googleStatuteDocumentId}/edit` : '');
        const replacing = Boolean(previousUrl);
        let linked = null;
        if (remoteMode) {
          linked = await apiRequest('google_document_link', { method: 'POST', body: JSON.stringify({ scope: 'party_statutes', entityId: party.id, url }) });
        }
        const isGoogle = linked ? Boolean(linked.isGoogleDoc) : Boolean(extractGoogleDocId(url));
        const docId = linked?.id || (isGoogle ? extractGoogleDocId(url) : null);
        const docName = linked?.name || null;
        const finalUrl = linked?.url || url;

        if (party.googleStatuteDocumentId && party.googleStatuteDocumentId !== docId) {
          const rawUrl = document.getElementById('partyStatuteGoogleUrl').value.trim();
          if (!rawUrl) { showToast('Inserisci un link valido per lo statuto.'); return; }
          let url = rawUrl;
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            const docId = extractGoogleDocId(url);
            url = docId ? `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit` : `https://${url}`;
          }
          try {
            const previousUrl = party.statuteUrl || party.googleUrl || (party.googleStatuteDocumentId ? `https://docs.google.com/document/d/${party.googleStatuteDocumentId}/edit` : '');
            const replacing = Boolean(previousUrl);
            let linked = null;
            if (remoteMode) {
              linked = await apiRequest('google_document_link', { method: 'POST', body: JSON.stringify({ scope: 'party_statutes', entityId: party.id, url }) });
            }
            const isGoogle = linked ? Boolean(linked.isGoogleDoc) : Boolean(extractGoogleDocId(url));
            const docId = linked?.id || (isGoogle ? extractGoogleDocId(url) : null);
            const docName = linked?.name || null;
            const finalUrl = linked?.url || url;

            if (party.googleStatuteDocumentId && party.googleStatuteDocumentId !== docId) {
              party.googleLatestText = '';
              party.googleModifiedBy = null;
            }
            party.googleStatuteDocumentId = isGoogle ? docId : null;
            party.googleStatuteName = docName;
            party.googleDocumentName = docName;
            party.googleUrl = finalUrl;
            party.statuteUrl = finalUrl;
            party.statute = isGoogle ? 'Statuto Google collegato' : 'Statuto esterno collegato';
            party.googleModifiedTime = linked?.modifiedTime || null;
            party.googleStatuteDocumentId = isGoogle ? docId : null;
            party.googleStatuteName = docName;
            party.googleDocumentName = docName;
            party.googleUrl = finalUrl;
            party.statuteUrl = finalUrl;
            party.statute = isGoogle ? 'Statuto Google collegato' : 'Statuto esterno collegato';
            party.googleModifiedTime = linked?.modifiedTime || null;
            party.updatedAt = new Date().toISOString();
            if (!Array.isArray(party.history)) party.history = [];
            party.history.push({
              label: isGoogle ? 'Statuto Google' : 'Statuto',
              from: previousUrl || 'Nessuno statuto',
              to: finalUrl,
              at: new Date().toISOString()
            });
            if (!Array.isArray(party.history)) party.history = [];
            party.history.push({
              label: isGoogle ? 'Statuto Google' : 'Statuto',
              from: previousUrl || 'Nessuno statuto',
              to: finalUrl,
              at: new Date().toISOString()
            });
            writeStorage(STORAGE_KEYS.parties, state.parties);
            if (remoteMode) { clearTimeout(remoteSaveTimer); await saveRemoteState('parties'); }
            closePartyStatuteEditor();
            renderParties();
            showToast(replacing ? 'Collegamento dello statuto aggiornato.' : 'Statuto collegato.');
          } catch (error) { showToast(error.message || 'Impossibile collegare lo statuto.'); }
        }

        async function saveParty(event) {
          event.preventDefault();
          const name = document.getElementById('partyName').value.trim();
          if (!name) { showToast('Inserisci il nome del partito.'); return; }
          const fields = Object.fromEntries([...document.querySelectorAll('.party-field-input')].map(input => [input.dataset.fieldId, input.value.trim()]));
          if (Object.values(fields).some(value => !value)) { showToast('Compila tutte le informazioni minime configurate.'); return; }
          const status = document.getElementById('partyStatus').value;
          const existingParty = state.parties.find(item => item.id === editingPartyId);
          const history = existingParty?.history ? [...existingParty.history] : [];
          // Il file è collegato da Drive: il suo nome resta gestito su Google e viene
          // riallineato dalla sincronizzazione, senza rinominarlo insieme al partito.
          const statuteName = existingParty?.googleStatuteName || '';
          if (existingParty) {
            state.partyFields.forEach(field => { const from = existingParty.fields?.[field.id] || ''; const to = fields[field.id] || ''; if (from !== to) history.push({ label: field.name, from, to, at: new Date().toISOString() }); });
            if (existingParty.status !== status) history.push({ label: 'Status', from: statusLabel(existingParty.status), to: statusLabel(status), at: new Date().toISOString() });
          }
          const record = {
            id: editingPartyId || crypto.randomUUID(),
            name,
            status,
            fields,
            statute: existingParty?.statute || '',
            googleStatuteDocumentId: existingParty?.googleStatuteDocumentId || null,
            googleStatuteName: statuteName || null,
            googleLatestText: existingParty?.googleLatestText || '',
            googleUrl: existingParty?.googleUrl || null,
            statuteUrl: existingParty?.statuteUrl || existingParty?.googleUrl || null,
            googleModifiedTime: existingParty?.googleModifiedTime || null,
            googleModifiedBy: existingParty?.googleModifiedBy || null,
            history,
            createdAt: existingParty?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          if (existingParty) state.parties[state.parties.indexOf(existingParty)] = record;
          else state.parties.unshift(record);
          writeStorage(STORAGE_KEYS.parties, state.parties);
          bootstrap.Modal.getOrCreateInstance(document.getElementById('partyModal')).hide();
          editingPartyId = null;
          renderParties();
          showToast(existingParty ? 'Partito aggiornato.' : 'Partito salvato.');
        }
        function renderCoalitionParties(coalition = null) {
          const container = document.getElementById('coalitionPartiesList');
          if (!container) return;
          const parties = state.parties.filter(p => p.status !== 'cancellato').sort((a, b) => a.name.localeCompare(b.name));
          if (parties.length === 0) {
            container.innerHTML = '<p class="small text-secondary mb-0">Nessun partito disponibile.</p>';
            return;
          }
          const selectedIds = coalition?.parties || [];
          container.innerHTML = `<div class="d-flex flex-column gap-2">${parties.map(p => `
    <div class="form-check">
      <input class="form-check-input coalition-party-checkbox" type="checkbox" value="${p.id}" id="coalitionParty-${p.id}" ${selectedIds.includes(p.id) ? 'checked' : ''}>
      <label class="form-check-label" for="coalitionParty-${p.id}">${escapeHtml(p.name)}</label>
    </div>
  `).join('')}</div>`;
        }

        function openCoalitionEditor(coalitionId = '') {
          const coalition = state.coalitions.find(item => item.id === coalitionId);
          editingCoalitionId = coalition?.id || null;
          document.getElementById('coalitionForm').reset();
          document.getElementById('coalitionName').value = coalition?.name || '';
          document.getElementById('coalitionStatus').value = coalition?.status || 'attiva';
          renderCoalitionFields(coalition);
          renderCoalitionParties(coalition);
          renderCoalitionHistory(coalition);
          document.querySelector('#coalitionModal .modal-title').textContent = coalition ? 'Modifica coalizione' : 'Nuova coalizione';
          document.querySelector('#coalitionModal button[type="submit"]').textContent = coalition ? 'Salva modifiche' : 'Salva coalizione';
          bootstrap.Modal.getOrCreateInstance(document.getElementById('coalitionModal')).show();
        }

        function saveCoalition(event) {
          event.preventDefault();
          const name = document.getElementById('coalitionName').value.trim();
          if (!name) { showToast('Inserisci il nome della coalizione.'); return; }
          const fields = Object.fromEntries([...document.querySelectorAll('.coalition-field-input')].map(input => [input.dataset.fieldId, input.value.trim()]));
          if (Object.values(fields).some(value => !value)) { showToast('Compila tutte le informazioni minime configurate.'); return; }
          const status = document.getElementById('coalitionStatus').value;
          const selectedParties = [...document.querySelectorAll('.coalition-party-checkbox:checked')].map(cb => cb.value);
          const existingCoalition = state.coalitions.find(item => item.id === editingCoalitionId);
          const history = existingCoalition?.history ? [...existingCoalition.history] : [];
          if (existingCoalition) {
            state.coalitionFields.forEach(field => { const from = existingCoalition.fields?.[field.id] || ''; const to = fields[field.id] || ''; if (from !== to) history.push({ label: field.name, from, to, at: new Date().toISOString() }); });
            if (existingCoalition.status !== status) history.push({ label: 'Status', from: statusLabel(existingCoalition.status), to: statusLabel(status), at: new Date().toISOString() });

            const oldParties = existingCoalition.parties || [];
            const added = selectedParties.filter(id => !oldParties.includes(id));
            const removed = oldParties.filter(id => !selectedParties.includes(id));
            if (added.length > 0) {
              const addedNames = added.map(id => state.parties.find(p => p.id === id)?.name).filter(Boolean);
              if (addedNames.length > 0) history.push({ label: 'Partiti aggiunti', from: '', to: addedNames.join(', '), at: new Date().toISOString() });
            }
            if (removed.length > 0) {
              const removedNames = removed.map(id => state.parties.find(p => p.id === id)?.name).filter(Boolean);
              if (removedNames.length > 0) history.push({ label: 'Partiti rimossi', from: removedNames.join(', '), to: '', at: new Date().toISOString() });
            }
          }
          const record = { id: editingCoalitionId || crypto.randomUUID(), name, status, fields, parties: selectedParties, history, createdAt: existingCoalition?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
          if (existingCoalition) state.coalitions[state.coalitions.indexOf(existingCoalition)] = record;
          else state.coalitions.unshift(record);
          writeStorage(STORAGE_KEYS.coalitions, state.coalitions);
          bootstrap.Modal.getOrCreateInstance(document.getElementById('coalitionModal')).hide();
          editingCoalitionId = null;
          renderCoalitions();
          showToast(existingCoalition ? 'Coalizione aggiornata.' : 'Coalizione salvata.');
        }

        function openDocumentModal(templateId = '', forcedCategory = '') {
          editingDocumentId = null;
          activeGoogleDocumentId = null;
          const template = state.templates.find(item => item.id === templateId);
          document.getElementById('documentForm').reset();
          refreshCategoryOptions();
          document.getElementById('documentCategory').value = forcedCategory || template?.category || categoryNames()[0];
          setGoogleDocumentEditorState('', '');
          refreshDocumentTemplateOptions(document.getElementById('documentCategory').value);
          ensureGoogleOpenListener();
          document.getElementById('documentDate').value = today();
          document.getElementById('documentTemplate').value = templateId;
          document.getElementById('documentNumber').value = nextNumber(template?.category || document.getElementById('documentCategory').value);
          document.getElementById('odgStatus').value = 'da valutare';
          syncOdgStatusField();
          applyPageMargins();
          document.querySelector('#documentModal .modal-title').textContent = 'Nuovo documento';
          document.querySelector('#documentModal button[type="submit"]').textContent = 'Salva documento';
          showEditorScreen('documentModal');
          updateTemplateSelectionHints();
        }

        function openDocumentEditor(documentId) {
          const documentRecord = state.documents.find(item => item.id === documentId);
          if (!documentRecord) return;
          if (documentRecord.googleDocumentId) { openGoogleDocument(documentRecord.googleDocumentId, documentRecord.category === 'ODG' ? 'odg.open_google' : 'documents.open_google'); return; }
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
          applyPageMargins();
          document.querySelector('#documentModal .modal-title').textContent = 'Modifica documento';
          document.querySelector('#documentModal button[type="submit"]').textContent = 'Salva modifiche';
          showEditorScreen('documentModal');
          updateTemplateSelectionHints();
        }

        async function saveDocument(event) {
          event.preventDefault();
          try {
            const category = document.getElementById('documentCategory').value.trim();
            const template = state.templates.find(item => item.id === document.getElementById('documentTemplate').value);
            const date = document.getElementById('documentDate').value;
            const rawNumber = document.getElementById('documentNumber').value.trim();
            if (!/^\d+$/.test(rawNumber) || numericValue(rawNumber) < 1) { showToast('Il numero deve contenere solo cifre.'); return; }
            const number = padNumber(rawNumber);
            const existingDocument = state.documents.find(item => item.id === editingDocumentId);
            const title = document.getElementById('documentTitle').value.trim();
            if (!title) { showToast('Inserisci il titolo del documento.'); return; }
            const googleDocGiaCreato = Boolean(existingDocument?.googleDocumentId || activeGoogleDocumentId);
            const templateSenzaGoogleDoc = Boolean(template && !template.googleDocumentId);
            const sourceTemplateDocumentId = template?.googleDocumentId || '';
            const googleScope = category === 'ODG' ? 'odg' : 'documents';
            const googleDocumentId = existingDocument?.googleDocumentId || activeGoogleDocumentId || (await createGoogleDocument(title, googleScope, sourceTemplateDocumentId)).id;
            // Titolo cambiato dal sito: va riportato anche su Drive, altrimenti il
            // riallineamento successivo rimetterebbe il nome vecchio.
            let effectiveTitle = title;
            if (existingDocument?.googleDocumentId && existingDocument.title !== title) {
              effectiveTitle = (await renameGoogleDocument(googleDocumentId, title, googleScope)) || title;
            }
            const documentRecord = { id: editingDocumentId || crypto.randomUUID(), title: effectiveTitle, category, number, year: date.slice(0, 4), date, templateName: template?.name || '', googleDocumentId, googleDocumentName: effectiveTitle, status: category === 'ODG' ? document.getElementById('odgStatus').value : '', publicationStatus: existingDocument?.publicationStatus || 'non pubblicato', createdAt: existingDocument?.createdAt || new Date().toISOString() };
            if (existingDocument) state.documents[state.documents.indexOf(existingDocument)] = documentRecord;
            else state.documents.unshift(documentRecord);
            advanceCounter(category, number);
            writeStorage(STORAGE_KEYS.documents, state.documents); writeStorage(STORAGE_KEYS.counters, state.counters);
            // Persisti prima di aprire Google: al ritorno, la sincronizzazione Drive non
            // deve poter rileggere dal server uno stato precedente e far sparire la sentenza.
            if (remoteMode) {
              clearTimeout(remoteSaveTimer);
              await saveRemoteState('documents');
            }
            editingDocumentId = null;
            activeGoogleDocumentId = null;
            closeEditorScreen();
            renderDocuments();
            if (category === 'ODG') renderOdg();
            setGoogleDocumentEditorState(googleDocumentId, effectiveTitle);
            openGoogleDocument(googleDocumentId, googleScope === 'odg' ? 'odg.open_google' : 'documents.open_google');
            // Il template va comunicato per quello che è realmente riuscito a fare:
            // i casi in cui non è applicabile non devono più passare in silenzio.
            if (templateSenzaGoogleDoc) showToast(`Documento salvato, ma il template «${template.name}» non ha un documento Google associato: il documento è stato creato vuoto. Aprilo dalla sezione Template per scriverne il contenuto.`);
            else if (googleDocGiaCreato && template) showToast(`Documento salvato, ma il Google Doc era già stato creato prima della scelta del template: il template «${template.name}» non è stato applicato.`);
            else showToast('Documento salvato nell’archivio.');
          } catch (error) {
            showToast('Salvataggio non riuscito: ' + error.message);
          }
        }

        async function saveTemplate(event) {
          event.preventDefault();
          try {
            const existingTemplate = state.templates.find(item => item.id === editingTemplateId);
            const category = document.getElementById('templateCategory').value.trim();
            const name = document.getElementById('templateName').value.trim();
            if (!name || !category) { showToast('Inserisci nome e categoria del template.'); return; }
            const googleDocumentId = existingTemplate?.googleDocumentId || (await createGoogleDocument(name, 'templates')).id;
            // Anche i template seguono il nome del file: rinominare qui aggiorna Drive.
            let effectiveName = name;
            if (existingTemplate?.googleDocumentId && existingTemplate.name !== name) {
              effectiveName = (await renameGoogleDocument(googleDocumentId, name, 'templates')) || name;
            }
            const template = { id: editingTemplateId || crypto.randomUUID(), name: effectiveName, category, body: '', image: '', googleDocumentId, googleDocumentName: effectiveName };
            if (existingTemplate) state.templates[state.templates.indexOf(existingTemplate)] = template;
            else state.templates.push(template);
            writeStorage(STORAGE_KEYS.templates, state.templates);
            editingTemplateId = null;
            closeEditorScreen();
            document.getElementById('templateForm').reset(); refreshCategoryOptions(); refreshDocumentTemplateOptions(); renderTemplates(); renderDocuments(); showToast(existingTemplate ? 'Template aggiornato.' : 'Template salvato.');
            openGoogleDocument(googleDocumentId, 'templates.open_google');
          } catch (error) {
            showToast('Salvataggio template non riuscito: ' + error.message);
          }
        }

        function openTemplateEditor(templateId = '') {
          const template = state.templates.find(item => item.id === templateId);
          if (template?.googleDocumentId) { openGoogleDocument(template.googleDocumentId, 'templates.open_google'); return; }
          editingTemplateId = template?.id || null;
          document.getElementById('templateForm').reset();
          refreshCategoryOptions();
          document.getElementById('templateName').value = template?.name || '';
          document.getElementById('templateCategory').value = template?.category || categoryNames()[0];
          applyPageMargins();
          document.querySelector('#templateModal .modal-title').textContent = template ? 'Modifica template' : 'Nuovo template';
          document.querySelector('#templateModal button[type="submit"]').textContent = template ? 'Salva modifiche' : 'Salva template';
          showEditorScreen('templateModal');
        }

        function printDocument(id) {
          if (!capable('documents.print')) { showToast('Non hai il permesso di stampare documenti.'); return; }
          const documentRecord = state.documents.find(item => item.id === id); if (!documentRecord) return;
          const margins = normalizePageMargins(state.pageMargins);
          const printWindow = window.open('', '_blank');
          const parser = new DOMParser();
          const printableBody = parser.parseFromString(sanitizeRichHtml(documentRecord.body), 'text/html');
          printableBody.querySelectorAll('.page-break').forEach(pageBreak => {
            pageBreak.textContent = '';
            pageBreak.style.cssText = 'page-break-before: always; break-before: page; height: 0; min-height: 0; margin: 0; border: 0; background: none; color: transparent;';
          });
          printWindow.document.write(`<html lang="it"><head><title>${escapeHtml(documentRecord.title)}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/pinyon-script@5.1.1/400.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/raleway@5.1.1/400.css"><style>@page{size:A4;margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm}body{margin:0;color:#17202a;font-family:Georgia,'Times New Roman',serif;font-size:12pt}h1{font-size:28px}.body{line-height:1.7}.body img{max-width:100%;max-height:220px;display:block;margin:0 0 20px}.body table{max-width:100%;border-collapse:collapse}.body td{border:1px solid #aeb7bf;padding:.5rem}.body .page-break::before{content:none!important}</style></head><body><h1>${escapeHtml(documentRecord.title)}</h1>${documentRecord.image ? `<img src="${escapeHtml(documentRecord.image)}" alt="">` : ''}<div class="body">${printableBody.body.innerHTML}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
          printWindow.document.close();
        }

        function pxToMm(value = 0) {
          const numeric = Number.parseFloat(value);
          if (!Number.isFinite(numeric)) return 0;
          return Math.max(0, numeric * 25.4 / 96);
        }

        function normalizeEditorImageGeometryForPdf(body = '') {
          const parser = new DOMParser();
          const template = parser.parseFromString(body, 'text/html');
          template.querySelectorAll('img.editor-image').forEach(image => {
            const left = Number.parseFloat(image.style.left || '0');
            const top = Number.parseFloat(image.style.top || '0');
            const ratio = Number.parseFloat(image.style.width || image.getAttribute('width') || '0');
            const width = Number.isFinite(ratio) ? ratio : 0;
            if (image.style.position) image.style.position = 'absolute';
            image.style.left = `${pxToMm(left)}mm`;
            image.style.top = `${pxToMm(top)}mm`;
            image.style.width = `${pxToMm(width)}mm`;
            image.style.height = 'auto';
            image.style.maxWidth = '100%';
            image.style.display = 'block';
            image.style.margin = '0';
          });
          return template.body.innerHTML;
        }

        async function downloadRichPdf({ body = '', filename = 'documento.pdf', image = '' } = {}) {
          if (!capable('documents.download_pdf')) { showToast('Non hai il permesso di scaricare PDF.'); return; }
          if (typeof window.googleDocsExport !== 'function') { showToast('L’esportazione PDF è disponibile tramite Google Documenti.'); return; }

          const margins = normalizePageMargins(state.pageMargins);

          // 1. AREA STAMPABILE CON PICCOLA TOLLERANZA ANTITAGLIO
          // Sottraiamo i margini utente e aggiungiamo un cuscinetto di sicurezza di 4mm per evitare il taglio millimetrico a destra.
          const printableWidthMm = 210 - (Number(margins.left) + Number(margins.right)) - 6;

          const source = document.createElement('article');
          source.className = 'pdf-export-source';
          source.style.cssText = [
            `width: ${printableWidthMm}mm`,
            'box-sizing: border-box',
            'position: relative',
            'background: #fff',
            'color: #17202a',
            'font-family: Georgia, "Times New Roman", serif',
            'font-size: 12pt',
            'line-height: 1.55',
            'overflow: visible',
            'margin: 0',
            'padding: 0'
          ].join(';');

          const content = document.createElement('div');
          content.className = 'pdf-export-content';
          content.style.cssText = [
            'position: relative',
            'z-index: 1',
            'width: 100%',
            'box-sizing: border-box',
            'overflow: visible'
          ].join(';');

          content.innerHTML = body;

          content.querySelectorAll('.page-break').forEach(pageBreak => {
            pageBreak.textContent = '';
            pageBreak.style.cssText = 'page-break-before: always; break-before: page; height: 0; min-height: 0; margin: 0; border: 0; background: none; color: transparent;';
          });

          // Pulizia elementi di interfaccia
          content.querySelectorAll('button, .btn, a, input[type="button"], input[type="submit"], [data-print-document], [data-download-pdf], .print-button').forEach(item => item.remove());

          // Gestione immagine/intestazione
          if (image && !body.includes(image)) {
            const docImage = document.createElement('img');
            docImage.className = 'pdf-export-background';
            docImage.src = image;
            docImage.alt = '';
            docImage.style.cssText = [
              'max-width: 100%',
              'height: auto',
              'display: block',
              'margin: 0 auto 20px'
            ].join(';');
            content.insertBefore(docImage, content.firstChild);
          }

          // Preservazione millimetrica di posizioni e dimensioni delle immagini dell'editor
          content.querySelectorAll('img').forEach(img => {
            img.style.boxSizing = 'border-box';
            if (!img.style.maxWidth) img.style.maxWidth = '100%';

            if (img.hasAttribute('width') && !img.style.width) {
              img.style.width = img.getAttribute('width') + 'px';
            }
            if (img.hasAttribute('height') && !img.style.height) {
              img.style.height = img.getAttribute('height') + 'px';
            }
          });

          // 2. BLINDATURA DI SICUREZZA PER TUTTI GLI ELEMENTI INTERNI
          content.querySelectorAll('*').forEach(el => {
            el.style.boxSizing = 'border-box';
            el.style.overflowWrap = 'break-word';
            el.style.wordBreak = 'normal'; // Evita che le lettere vengano tagliate singolarmente

            // Se un elemento nidificato ha una larghezza fissa in pixel ereditata dall'editor 
            // che supera lo spazio del foglio, la limitiamo al 100% per farlo andare a capo
            if (el.style.width && el.style.width.includes('px')) {
              el.style.maxWidth = '100%';
            }

            // REGOLA SALVAVITA PER IL TESTO ALLINEATO A DESTRA:
            // Aggiungiamo un micro-padding destro solo agli elementi di testo allineati a destra o giustificati.
            // Questo sposta le firme leggermente verso l'interno di qualche pixel, salvandole dal taglio della canvas.
            const textAlign = window.getComputedStyle(el).textAlign;
            if (textAlign === 'right' || textAlign === 'justify') {
              el.style.paddingRight = '8px';
            }
          });

          source.appendChild(content);
          document.body.appendChild(source);

          try {
            if (document.fonts?.load) {
              await Promise.all([
                document.fonts.load('16px Georgia'),
                document.fonts.load('16px Raleway'),
                document.fonts.load('16px "Pinyon Script"')
              ]).catch(() => undefined);
            }

            // Attendi il rendering completo delle immagini
            await Promise.all([...source.querySelectorAll('img')].map(img => {
              if (img.complete) return Promise.resolve();
              return new Promise(resolve => { img.onload = img.onerror = resolve; });
            }));

            // 3. APPLICAZIONE DEI MARGINI E COMPENSAZIONE LATERALE
            await window.googleDocsExport().set({
              // Aggiungiamo +2mm di sicurezza ai margini del PDF per compensare la riduzione di printableWidthMm
              margin: [margins.top, Number(margins.left) + 2, margins.bottom, Number(margins.right) + 2],
              filename: String(filename || 'documento.pdf').replace(/[\\/:*?"<>|]+/g, '-'),
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false
              },
              pagebreak: {
                mode: ['css', 'legacy'],
                before: ['.page-break'],
                avoid: ['table', 'blockquote', 'tr', 'img', 'p'] // Esteso anche ai paragrafi <p> per evitare tagli orizzontali
              },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).from(source).save();

            showToast('PDF scaricato.');
          } catch (error) {
            showToast('Impossibile generare il PDF.');
            console.error(error);
          } finally {
            source.remove();
          }
        }

        function downloadDocumentPdf(id) {
          const documentRecord = state.documents.find(item => item.id === id);
          if (!documentRecord?.googleDocumentId) return;
          return downloadGooglePdf(documentRecord.googleDocumentId, `${documentRecord.category}-${documentRecord.number}-${documentRecord.year}.pdf`, documentRecord.category === 'ODG' ? 'odg' : 'documents');
        }

        function downloadTemplatePdf(id) {
          const template = state.templates.find(item => item.id === id);
          if (!template?.googleDocumentId) return;
          return downloadGooglePdf(template.googleDocumentId, `template-${template.category}-${template.name}.pdf`, 'templates');
        }

        function downloadPartyStatutePdf(id) {
          const party = state.parties.find(item => item.id === id);
          const docId = party?.googleStatuteDocumentId || (party?.googleUrl ? extractGoogleDocId(party.googleUrl) : null) || (party?.statuteUrl ? extractGoogleDocId(party.statuteUrl) : null);
          if (!docId) { showToast('Nessun documento Google collegato allo statuto.'); return; }
          return downloadGooglePdf(docId, `statuto-${party.name}.pdf`, 'party_statutes');
        }

        function downloadCompanyRegulationPdf(id) {
          const company = state.companies.find(item => item.id === id);
          const docId = company?.googleRegulationDocumentId || (company?.googleUrl ? extractGoogleDocId(company.googleUrl) : null) || (company?.regulationUrl ? extractGoogleDocId(company.regulationUrl) : null);
          if (!docId) { showToast('Nessun documento Google collegato al regolamento.'); return; }
          return downloadGooglePdf(docId, `regolamento-${company.name}.pdf`, 'company_regulations');
        }


        function seedTestMandate() {
          if (state.testMandateSeeded) return;
          if (state.parliaments.length) {
            state.testMandateSeeded = true;
            writeStorage(STORAGE_KEYS.testMandateSeeded, state.testMandateSeeded);
            return;
          }
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
          state.testMandateSeeded = true;
          writeStorage(STORAGE_KEYS.parliaments, state.parliaments);
          writeStorage(STORAGE_KEYS.testMandateSeeded, state.testMandateSeeded);
        }

        async function initialize() {
          await loadRemoteState();
          ensureAuthModals();
          ensureCredentialModal();
          bindResponsiveModalScrolling();
          document.addEventListener('submit', enforceFormPermissions, true);
          ensureOdgCategory();
          ensureInstitutionViews();
          ensureInterpretationView();
          ensureOdgView();
          ensureTrashView();
          ensureSettingsSubnav();
          ensureArchiveSearch('templatesView', 'templateSearch', 'Cerca template per nome o categoria', 'templateGrid');
          ensureArchiveSearch('partiesView', 'partySearch', 'Cerca partiti per nome, stato o valore', 'partyGrid');
          ensureArchiveSearch('companiesView', 'companySearch', 'Cerca aziende per nome o regolamento', 'companyGrid');
          ensureArchiveSearch('parliamentView', 'parliamentSearch', 'Cerca mandati, parlamentari o partiti', 'parliamentGrid');
          ensureArchiveSearch('odgView', 'odgSearch', 'Cerca ODG per titolo, numero o stato', 'odgGrid');
          ensureArchiveSearch('interpretationsView', 'interpretationSearch', 'Cerca interpretazioni per nome, testo o valore', 'interpretationGrid');
          ensureArchiveSearch('governmentView', 'governmentSearch', 'Cerca periodi o componenti del Governo', 'governmentGrid');
          ensureArchiveSearch('compositionView', 'compositionSearch', 'Cerca periodi o componenti della Corte', 'compositionGrid');
          renderGoogleConnectionSettings();
          applyPermissions();
          bindInstitutionEvents();
          document.getElementById('loginForm').addEventListener('submit', submitLogin);
          document.getElementById('logoutButton').addEventListener('click', async () => { if (remoteMode) { try { clearTimeout(remoteSaveTimer); await saveRemoteState(); await apiRequest('logout', { method: 'POST', body: '{}' }); } catch { /* fallback locale */ } } localStorage.removeItem(STORAGE_KEYS.session); localStorage.removeItem('cz_local_user'); location.reload(); });
          document.getElementById('requestRegistrationButton').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(document.getElementById('registrationRequestModal')).show());
          document.getElementById('requestRecoveryButton').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(document.getElementById('recoveryRequestModal')).show());
          document.getElementById('registrationRequestForm').addEventListener('submit', submitRegistrationRequest);
          document.getElementById('recoveryRequestForm').addEventListener('submit', submitRecoveryRequest);
          document.getElementById('credentialChangeForm').addEventListener('submit', saveFirstAccessCredentials);
          document.getElementById('refreshUsersButton')?.addEventListener('click', refreshUserManagement);
          document.getElementById('disconnectGoogleButton')?.addEventListener('click', disconnectGoogleAccount);
          // Legato qui e non con onclick: la CSP del sito vieta gli handler inline.
          document.getElementById('syncGoogleLinksButton')?.addEventListener('click', () => rehydrateGoogleLinks());
          document.addEventListener('change', event => { const roleSelect = event.target.closest('.user-role-select'); if (roleSelect) userManagementAction('change_user_role', { userId: roleSelect.dataset.userId, roleId: roleSelect.value }, 'Ruolo aggiornato.'); });
          document.addEventListener('click', event => { const deleteUser = event.target.closest('.delete-user-button'); if (deleteUser) { event.stopImmediatePropagation(); if (confirm('Spostare questo utente nel cestino? Potrà essere ripristinato o eliminato definitivamente dalla sezione Utenti e permessi.')) userManagementAction('delete_user', { userId: deleteUser.dataset.userId }, 'Utente spostato nel cestino.'); } });
          document.addEventListener('click', event => {
            const createRoleButton = event.target.closest('#createRoleButton');
            if (createRoleButton) userManagementAction('create_role', { name: document.getElementById('newRoleName').value }, 'Ruolo creato.');
            const deleteRoleButton = event.target.closest('.delete-role-button');
            if (deleteRoleButton && confirm(`Eliminare il ruolo “${deleteRoleButton.dataset.roleName}”?`)) userManagementAction('delete_role', { roleId: deleteRoleButton.dataset.roleId }, 'Ruolo eliminato.');
            const bulkButton = event.target.closest('.select-role-capabilities, .clear-role-capabilities');
            if (bulkButton) document.querySelectorAll(`.role-capability[data-role-id="${bulkButton.dataset.roleId}"]`).forEach(input => { input.checked = bulkButton.classList.contains('select-role-capabilities'); });
            const saveButton = event.target.closest('.save-role-capabilities');
            if (saveButton) {
              const capabilities = [...document.querySelectorAll(`.role-capability[data-role-id="${saveButton.dataset.roleId}"]:checked`)].map(input => input.value);
              userManagementAction('save_role_capabilities', { roleId: saveButton.dataset.roleId, capabilities }, 'Capacità del ruolo salvate.');
            }
          });
          document.addEventListener('click', event => { const deleteButton = event.target.closest('.delete-user-button'); if (deleteButton && confirm('Eliminare definitivamente l’accesso di questo utente?')) userManagementAction('delete_user', { userId: deleteButton.dataset.userId }, 'Utente eliminato.'); const approveRegistration = event.target.closest('.approve-registration-button'); if (approveRegistration) { const roleId = document.querySelector(`.registration-role[data-request-id="${approveRegistration.dataset.requestId}"]`).value; userManagementAction('approve_registration', { requestId: approveRegistration.dataset.requestId, roleId }, 'Registrazione autorizzata.'); } const rejectRegistration = event.target.closest('.reject-registration-button'); if (rejectRegistration) userManagementAction('reject_registration', { requestId: rejectRegistration.dataset.requestId }, 'Richiesta rifiutata.'); const approveReset = event.target.closest('.approve-reset-button'); if (approveReset) userManagementAction('approve_password_reset', { requestId: approveReset.dataset.requestId }, 'Richiesta approvata. Ora l’utente può scegliere la nuova password.'); });
          document.addEventListener('click', event => {
            const restoreUser = event.target.closest('.restore-user-button');
            if (restoreUser) { event.stopImmediatePropagation(); userManagementAction('restore_user', { userId: restoreUser.dataset.userId }, 'Utente ripristinato.'); return; }
            const purgeUser = event.target.closest('.purge-user-button');
            if (purgeUser) { event.stopImmediatePropagation(); if (confirm('Eliminare definitivamente questo utente? L’account e i relativi dati di accesso non potranno essere ripristinati.')) userManagementAction('purge_user', { userId: purgeUser.dataset.userId }, 'Utente eliminato definitivamente.'); return; }
            const trashButton = event.target.closest('[data-trash-item]');
            if (trashButton) { event.stopImmediatePropagation(); moveToTrash(trashButton.dataset.trashItem, trashButton.dataset.entityId, trashButton.dataset.parentId || ''); return; }
            const restoreTrash = event.target.closest('[data-restore-trash]');
            if (restoreTrash) { event.stopImmediatePropagation(); restoreTrashItem(restoreTrash.dataset.restoreTrash); return; }
            const purgeTrash = event.target.closest('[data-purge-trash]');
            if (purgeTrash) { event.stopImmediatePropagation(); permanentlyDeleteTrashItem(purgeTrash.dataset.purgeTrash); return; }
            const togglePublicationStatus = event.target.closest('[data-toggle-publication-status]');
            if (togglePublicationStatus) {
              event.stopImmediatePropagation();
              const documentRecord = state.documents.find(item => item.id === togglePublicationStatus.dataset.togglePublicationStatus);
              if (documentRecord && capable(documentRecord.category === 'ODG' ? 'odg.change_publication' : 'documents.change_publication')) {
                documentRecord.publicationStatus = documentRecord.publicationStatus === 'pubblicato' ? 'non pubblicato' : 'pubblicato';
                documentRecord.updatedAt = new Date().toISOString();
                writeStorage(STORAGE_KEYS.documents, state.documents);
                renderDocuments();
                if (documentRecord.category === 'ODG') renderOdg();
                showToast(`Documento ${documentRecord.publicationStatus}.`);
              }
              return;
            }
            const toggleOdgStatus = event.target.closest('[data-toggle-odg-status]');
            if (toggleOdgStatus) {
              event.stopImmediatePropagation();
              if (!capable('odg.change_evaluation')) { showToast('Non hai il permesso di cambiare lo stato di valutazione.'); return; }
              const documentRecord = state.documents.find(item => item.id === toggleOdgStatus.dataset.toggleOdgStatus);
              if (documentRecord) {
                documentRecord.status = documentRecord.status === 'valutato' ? 'da valutare' : 'valutato';
                documentRecord.updatedAt = new Date().toISOString();
                writeStorage(STORAGE_KEYS.documents, state.documents);
                renderOdg();
                renderDocuments();
                showToast('Stato ODG aggiornato.');
              }
              return;
            }
          });
          document.querySelectorAll('[data-view-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); setView(link.dataset.viewLink); }));
          document.getElementById('newOdgButton').addEventListener('click', () => openDocumentModal('', 'ODG'));
          document.getElementById('interpretationForm').addEventListener('submit', saveInterpretation);
          document.getElementById('newInterpretationButton').addEventListener('click', () => openInterpretationEditor());
          document.getElementById('closeInterpretationEditor').addEventListener('click', () => { document.getElementById('interpretationEditor').classList.add('d-none'); setView('interpretations'); });
          document.getElementById('cancelInterpretationEditor').addEventListener('click', () => { document.getElementById('interpretationEditor').classList.add('d-none'); setView('interpretations'); });
          document.getElementById('interpretationFieldForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('interpretationFieldName').value.trim(); if (!name) return; if (state.interpretationSettings.fields.some(field => field.name.toLowerCase() === name.toLowerCase())) { showToast('Questo valore base esiste già.'); return; } state.interpretationSettings.fields.push({ id: crypto.randomUUID(), name }); writeStorage(STORAGE_KEYS.interpretationSettings, state.interpretationSettings); document.getElementById('interpretationFieldForm').reset(); renderInterpretationSettings(); showToast('Valore base aggiunto.'); });
          document.getElementById('interpretationFieldList').addEventListener('click', event => { const button = event.target.closest('[data-remove-interpretation-field]'); if (!button) return; if (!capable('interpretations.configuration.fields_delete')) { showToast('Non hai il permesso di eliminare valori base.'); return; } state.interpretationSettings.fields = state.interpretationSettings.fields.filter(field => field.id !== button.dataset.removeInterpretationField); writeStorage(STORAGE_KEYS.interpretationSettings, state.interpretationSettings); renderInterpretationSettings(); showToast('Valore base rimosso.'); });
          document.addEventListener('click', event => { const button = event.target.closest('[data-open-interpretation]'); if (button) { event.stopPropagation(); openInterpretationEditor(button.dataset.openInterpretation); } });
          document.getElementById('documentSearch').addEventListener('input', renderDocuments);
          document.getElementById('usefulLinkSearch').addEventListener('input', renderUsefulLinks);
          document.getElementById('securityLogSearch').addEventListener('input', () => drawSecurityLogs(securityLogsCache || []));
          document.getElementById('refreshSecurityLogsButton').addEventListener('click', () => renderSecurityLogs(true));
          document.getElementById('usefulLinkForm').addEventListener('submit', saveUsefulLink);
          document.getElementById('newUsefulLinkButton').addEventListener('click', () => openUsefulLinkModal());
          document.addEventListener('input', event => { const search = event.target.closest('[data-archive-search]'); if (!search) return; const view = search.dataset.archiveSearch; if (view === 'templatesView') renderTemplates(); if (view === 'partiesView') renderParties(); if (view === 'coalitionsView') renderCoalitions(); if (view === 'companiesView') renderCompanies(); if (view === 'parliamentView') renderParliaments(); if (view === 'odgView') renderOdg(); if (view === 'interpretationsView') renderInterpretations(); if (view === 'governmentView') renderInstitution('government'); if (view === 'compositionView') renderInstitution('composition'); if (view === 'trashView') renderTrash(); });
          document.addEventListener('input', event => { const search = event.target.closest('[data-member-search]'); if (!search) return; if (search.id === 'parliamentMemberSearch') { const mandate = state.parliaments.find(item => item.id === editingParliamentId); if (mandate) renderParliamentMembers(mandate); } if (search.id === 'governmentMemberSearch') { const record = state.governments.find(item => item.id === window.editinggovernmentId); if (record) renderInstitutionMembers('government', record); } if (search.id === 'compositionMemberSearch') { const record = state.courtCompositions.find(item => item.id === window.editingcompositionId); if (record) renderInstitutionMembers('composition', record); } });
          document.getElementById('documentForm').addEventListener('submit', saveDocument);
          document.getElementById('templateForm').addEventListener('submit', saveTemplate);
          document.getElementById('partyForm').addEventListener('submit', saveParty);
          document.getElementById('coalitionForm').addEventListener('submit', saveCoalition);
          document.getElementById('companyForm').addEventListener('submit', saveCompany);
          document.getElementById('parliamentForm').addEventListener('submit', saveParliament);
          document.getElementById('memberForm').addEventListener('submit', saveMember);
          document.getElementById('undoResignationButton').addEventListener('click', event => undoMemberResignation(event.currentTarget.dataset.memberId));
          document.getElementById('memberParty').addEventListener('change', syncMemberCoalitionFromParty);
          document.getElementById('partyStatuteForm').addEventListener('submit', savePartyStatute);
          document.getElementById('companyRegulationForm').addEventListener('submit', saveCompanyRegulation);
          document.getElementById('closePartyStatuteEditor').addEventListener('click', closePartyStatuteEditor);
          document.getElementById('cancelPartyStatuteEditor')?.addEventListener('click', closePartyStatuteEditor);
          document.getElementById('newPartyButton').addEventListener('click', () => openPartyEditor());
          document.getElementById('newCoalitionButton').addEventListener('click', () => openCoalitionEditor());
          document.getElementById('newCompanyButton').addEventListener('click', () => openCompanyEditor());
          document.getElementById('newParliamentButton').addEventListener('click', openNewParliament);
          document.getElementById('addMemberButton').addEventListener('click', () => openMemberEditor());
          document.getElementById('cancelParliamentEditor').addEventListener('click', closeParliamentEditor);
          document.getElementById('closeCompanyRegulationEditor').addEventListener('click', closeCompanyRegulationEditor);
          document.getElementById('cancelCompanyRegulationEditor')?.addEventListener('click', closeCompanyRegulationEditor);
          document.getElementById('categoryForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('categoryName').value.trim(); if (!name) return; if (categoryNames().some(category => category.toLowerCase() === name.toLowerCase())) { showToast('Questa categoria esiste già.'); return; } state.categories.push({ name }); state.counters[name] = 1; writeStorage(STORAGE_KEYS.categories, state.categories); writeStorage(STORAGE_KEYS.counters, state.counters); document.getElementById('categoryForm').reset(); refreshCategoryOptions(); renderSettings(); showToast('Categoria creata.'); });
          document.getElementById('categoryList').addEventListener('click', event => { const button = event.target.closest('[data-delete-category]'); if (!button) return; event.stopPropagation(); deleteCategory(button.dataset.deleteCategory); });
          document.addEventListener('click', event => { const coalitionBtn = event.target.closest('[data-open-coalition]'); if (coalitionBtn) { event.stopPropagation(); openCoalitionEditor(coalitionBtn.dataset.openCoalition); } });
          document.getElementById('partyFieldForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('partyFieldName').value.trim(); if (!name) return; if (state.partyFields.some(field => field.name.toLowerCase() === name.toLowerCase())) { showToast('Questo campo esiste già.'); return; } state.partyFields.push({ id: crypto.randomUUID(), name }); writeStorage(STORAGE_KEYS.partyFields, state.partyFields); document.getElementById('partyFieldForm').reset(); renderSettings(); renderParties(); showToast('Informazione minima aggiunta.'); });
          document.getElementById('partyFieldList').addEventListener('click', event => { const button = event.target.closest('[data-remove-party-field]'); if (!button) return; if (!capable('settings.party_fields.delete')) { showToast('Non hai il permesso di eliminare campi dei partiti.'); return; } const fieldId = button.dataset.removePartyField; state.partyFields = state.partyFields.filter(field => field.id !== fieldId); writeStorage(STORAGE_KEYS.partyFields, state.partyFields); renderSettings(); renderParties(); showToast('Informazione minima rimossa.'); });
          const coalitionFieldForm = document.getElementById('coalitionFieldForm');
          if (coalitionFieldForm) coalitionFieldForm.addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('coalitionFieldName').value.trim(); if (!name) return; if (state.coalitionFields.some(field => field.name.toLowerCase() === name.toLowerCase())) { showToast('Questo campo esiste già.'); return; } state.coalitionFields.push({ id: crypto.randomUUID(), name }); writeStorage(STORAGE_KEYS.coalitionFields, state.coalitionFields); coalitionFieldForm.reset(); renderSettings(); renderCoalitions(); showToast('Informazione minima aggiunta.'); });
          const coalitionFieldList = document.getElementById('coalitionFieldList');
          if (coalitionFieldList) coalitionFieldList.addEventListener('click', event => { const button = event.target.closest('[data-remove-coalition-field]'); if (!button) return; if (!capable('settings.coalition_fields.delete')) { showToast('Non hai il permesso di eliminare campi delle coalizioni.'); return; } const fieldId = button.dataset.removeCoalitionField; state.coalitionFields = state.coalitionFields.filter(field => field.id !== fieldId); writeStorage(STORAGE_KEYS.coalitionFields, state.coalitionFields); renderSettings(); renderCoalitions(); showToast('Informazione minima rimossa.'); });
          document.getElementById('googleDriveFoldersForm')?.addEventListener('submit', async event => {
            event.preventDefault();
            const input = document.getElementById('googleDocumentsFolderId') || document.getElementById('googleDriveFolderId');
            const documents = input ? input.value.trim() : '';
            if (!/^[a-zA-Z0-9_-]{5,}$/.test(documents)) { showToast('Inserisci un ID di cartella Drive valido.'); return; }
            const folders = { documents };
            try {
              if (remoteMode) await apiRequest('google_validate_folders', { method: 'POST', body: JSON.stringify({ folders }) });
              state.googleDriveFolders = folders;
              writeStorage(STORAGE_KEYS.googleDriveFolders, folders);
              if (remoteMode) { clearTimeout(remoteSaveTimer); await saveRemoteState('settings'); }
              showToast('Cartella Google verificata e salvata.');
            } catch (error) { showToast(error.message || 'Impossibile verificare la cartella Google.'); }
        });
        document.getElementById('numberingForm').addEventListener('submit', event => {
          event.preventDefault();
          const inputs = [...document.querySelectorAll('.counter-input')];
          if (inputs.some(input => !/^\d+$/.test(input.value.trim()) || numericValue(input.value) < 1)) { showToast('Inserisci solo numeri positivi, ad esempio 1 o 00001.'); return; }
          const paddingInput = document.getElementById('numberPaddingInput');
          const requestedPadding = Number.parseInt(paddingInput?.value, 10);
          if (paddingInput && (!Number.isFinite(requestedPadding) || requestedPadding < 1 || requestedPadding > 12)) { showToast('Le cifre del progressivo devono essere un numero da 1 a 12.'); return; }
          if (paddingInput) { state.numberPadding = requestedPadding; writeStorage(STORAGE_KEYS.numberPadding, state.numberPadding); }
          // I nuovi valori valgono solo per le prossime creazioni.
          inputs.forEach(input => { state.counters[input.dataset.category] = padNumber(input.value.trim()); });
          normalizeStoredNumbers();
          writeStorage(STORAGE_KEYS.counters, state.counters);
          renderSettings();
          renderDocuments();
          renderOdg();
          showToast('Numerazione aggiornata.');
        });
        const pageMarginsForm = document.getElementById('pageMarginsForm');
        if (pageMarginsForm) {
          pageMarginsForm.addEventListener('submit', event => {
            event.preventDefault();
            const margins = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, document.getElementById(`pageMargin${side[0].toUpperCase()}${side.slice(1)}`).value]));
            state.pageMargins = normalizePageMargins(margins);
            writeStorage(STORAGE_KEYS.pageMargins, state.pageMargins);
            applyPageMargins();
            renderSettings();
            showToast('Margini pagina aggiornati.');
          });
        }
        document.getElementById('partyFieldForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('partyFieldName').value.trim(); if (!name) return; if (state.partyFields.some(field => field.name.toLowerCase() === name.toLowerCase())) { showToast('Questo campo esiste già.'); return; } state.partyFields.push({ id: crypto.randomUUID(), name }); writeStorage(STORAGE_KEYS.partyFields, state.partyFields); document.getElementById('partyFieldForm').reset(); renderSettings(); renderParties(); showToast('Informazione minima aggiunta.'); });
        document.getElementById('partyFieldList').addEventListener('click', event => { const button = event.target.closest('[data-remove-party-field]'); if (!button) return; if (!capable('settings.party_fields.delete')) { showToast('Non hai il permesso di eliminare campi dei partiti.'); return; } const fieldId = button.dataset.removePartyField; state.partyFields = state.partyFields.filter(field => field.id !== fieldId); writeStorage(STORAGE_KEYS.partyFields, state.partyFields); renderSettings(); renderParties(); showToast('Informazione minima rimossa.'); });
        document.getElementById('parliamentSettingsForm').addEventListener('submit', event => { event.preventDefault(); const roles = [...document.querySelectorAll('.parliament-role-setting')].map(row => ({ id: row.dataset.roleId, name: row.querySelector('.parliament-role-name').value.trim(), limit: Math.max(0, Number.parseInt(row.querySelector('.parliament-role-limit').value, 10) || 0) })).filter(role => role.name); if (!roles.length || new Set(roles.map(role => role.name.toLowerCase())).size !== roles.length) { showToast('Inserisci nomi di ruolo univoci.'); return; } state.parliamentSettings.roles = roles; writeStorage(STORAGE_KEYS.parliamentSettings, state.parliamentSettings); renderSettings(); renderParliaments(); showToast('Configurazione Parlamento salvata.'); });
        document.getElementById('parliamentSettingsForm').addEventListener('click', event => { const addButton = event.target.closest('#addParliamentRole'); if (addButton) { if (!capable('parliament.configuration.roles_create')) { showToast('Non hai il permesso di creare ruoli parlamentari.'); return; } const roleId = crypto.randomUUID(); document.getElementById('parliamentRoleSettings').insertAdjacentHTML('beforeend', `<div class="row g-2 align-items-end parliament-role-setting" data-role-id="${roleId}"><div class="col"><label class="form-label">Nome ruolo</label><input class="form-control parliament-role-name" value="" placeholder="Es. Presidente" required></div><div class="col-auto"><label class="form-label">Numero</label><input class="form-control parliament-role-limit" type="number" min="0" value="1" required></div><div class="col-auto"><button type="button" class="btn btn-outline-danger remove-parliament-role" data-role-id="${roleId}">Rimuovi</button></div></div>`); document.querySelector('#parliamentRoleSettings .parliament-role-setting:last-child .parliament-role-name')?.focus(); return; } const removeButton = event.target.closest('.remove-parliament-role'); if (!removeButton) return; if (!capable('parliament.configuration.roles_delete')) { showToast('Non hai il permesso di eliminare ruoli parlamentari.'); return; } const rows = document.querySelectorAll('.parliament-role-setting'); if (rows.length <= 1) return; const hasMembers = state.parliaments.some(mandate => mandate.members.some(member => member.role === removeButton.dataset.roleId)); if (hasMembers) { showToast('Non puoi rimuovere un ruolo già usato nello storico.'); return; } removeButton.closest('.parliament-role-setting').remove(); });
        document.getElementById('parliamentFieldForm').addEventListener('submit', event => { event.preventDefault(); const name = document.getElementById('parliamentFieldName').value.trim(); if (!name) return; if (state.parliamentSettings.fields.some(field => field.name.toLowerCase() === name.toLowerCase())) { showToast('Questo campo esiste già.'); return; } state.parliamentSettings.fields.push({ id: crypto.randomUUID(), name }); writeStorage(STORAGE_KEYS.parliamentSettings, state.parliamentSettings); document.getElementById('parliamentFieldForm').reset(); renderSettings(); showToast('Informazione parlamentare aggiunta.'); });
        document.getElementById('parliamentFieldList').addEventListener('click', event => { const button = event.target.closest('[data-remove-parliament-field]'); if (!button) return; if (!capable('parliament.configuration.fields_delete')) { showToast('Non hai il permesso di eliminare campi parlamentari.'); return; } state.parliamentSettings.fields = state.parliamentSettings.fields.filter(field => field.id !== button.dataset.removeParliamentField); writeStorage(STORAGE_KEYS.parliamentSettings, state.parliamentSettings); renderSettings(); showToast('Informazione parlamentare rimossa.'); });
        const newTemplateButton = document.querySelector('[data-bs-target="#templateModal"], #newTemplateButton');
        document.querySelectorAll('[data-bs-target="#documentModal"], [data-bs-target="#templateModal"]').forEach(button => { button.removeAttribute('data-bs-toggle'); button.removeAttribute('data-bs-target'); });
        document.getElementById('newDocumentButton').addEventListener('click', () => openDocumentModal());
        newTemplateButton?.addEventListener('click', () => openTemplateEditor());
        document.getElementById('documentTemplate').addEventListener('change', updateTemplateSelectionHints);
        document.getElementById('documentCategory').addEventListener('change', event => { refreshDocumentTemplateOptions(event.target.value); document.getElementById('documentNumber').value = nextNumber(event.target.value); syncOdgStatusField(); updateTemplateSelectionHints(); });
        document.querySelectorAll('#documentModal [data-bs-dismiss="modal"], #templateModal [data-bs-dismiss="modal"]').forEach(button => { button.removeAttribute('data-bs-dismiss'); button.addEventListener('click', closeEditorScreen); });
        document.querySelectorAll('.rich-editor').forEach(editor => {
          editor.style.border = '1px solid var(--line)';
          editor.style.borderRadius = '.375rem';
          editor.style.width = '100%';
        });
        document.addEventListener('click', event => {
          const numberButton = event.target.closest('[data-edit-document-number]');
          if (numberButton) {
            event.stopPropagation();
            editDocumentNumber(numberButton.dataset.editDocumentNumber);
            return;
          }
          const clearPartyHistoryBtn = event.target.closest('#clearPartyHistoryButton');
          if (clearPartyHistoryBtn) {
            event.stopPropagation();
            clearPartyHistory(clearPartyHistoryBtn.dataset.partyId || editingPartyId);
            return;
          }
          const deletePartyHistoryBtn = event.target.closest('[data-delete-party-history]');
          if (deletePartyHistoryBtn) {
            event.stopPropagation();
            deletePartyHistoryItem(deletePartyHistoryBtn.dataset.deletePartyHistory, deletePartyHistoryBtn.dataset.historyIndex);
            return;
          }
          const clearCoalitionHistoryBtn = event.target.closest('#clearCoalitionHistoryButton');
          if (clearCoalitionHistoryBtn) {
            event.stopPropagation();
            clearCoalitionHistory(clearCoalitionHistoryBtn.dataset.coalitionId || editingCoalitionId);
            return;
          }
          const deleteCoalitionHistoryBtn = event.target.closest('[data-delete-coalition-history]');
          if (deleteCoalitionHistoryBtn) {
            event.stopPropagation();
            deleteCoalitionHistoryItem(deleteCoalitionHistoryBtn.dataset.deleteCoalitionHistory, deleteCoalitionHistoryBtn.dataset.historyIndex);
            return;
          }
          const clearCompanyHistoryBtn = event.target.closest('#clearCompanyHistoryButton');
          if (clearCompanyHistoryBtn) {
            event.stopPropagation();
            clearCompanyHistory(clearCompanyHistoryBtn.dataset.companyId || editingCompanyId);
            return;
          }
          const deleteCompanyHistoryBtn = event.target.closest('[data-delete-company-history]');
          if (deleteCompanyHistoryBtn) {
            event.stopPropagation();
            deleteCompanyHistoryItem(deleteCompanyHistoryBtn.dataset.deleteCompanyHistory, deleteCompanyHistoryBtn.dataset.historyIndex);
            return;
          }
          const usefulLinkEdit = event.target.closest('[data-edit-useful-link]');
          if (usefulLinkEdit) {
            event.stopPropagation();
            openUsefulLinkModal(usefulLinkEdit.dataset.editUsefulLink);
            return;
          } const usefulLinkRow = event.target.closest('[data-open-useful-link]'); if (usefulLinkRow && !event.target.closest('button')) { openUsefulLink(usefulLinkRow.dataset.openUsefulLink); return; } const editTemplateButton = event.target.closest('[data-edit-template]'); if (editTemplateButton) { event.stopPropagation(); openTemplateEditor(editTemplateButton.dataset.editTemplate); return; } const deleteTemplateButton = event.target.closest('[data-delete-template]'); if (deleteTemplateButton) { event.stopPropagation(); deleteTemplate(deleteTemplateButton.dataset.deleteTemplate); return; } const downloadButton = event.target.closest('[data-download-pdf]'); if (downloadButton) { event.stopPropagation(); downloadDocumentPdf(downloadButton.dataset.downloadPdf); return; } const downloadTemplateButton = event.target.closest('[data-download-template-pdf]'); if (downloadTemplateButton) { event.stopPropagation(); downloadTemplatePdf(downloadTemplateButton.dataset.downloadTemplatePdf); return; } const downloadStatuteButton = event.target.closest('[data-download-statute-pdf]'); if (downloadStatuteButton) { event.stopPropagation(); downloadPartyStatutePdf(downloadStatuteButton.dataset.downloadStatutePdf); return; } const downloadRegulationButton = event.target.closest('[data-download-regulation-pdf]'); if (downloadRegulationButton) { event.stopPropagation(); downloadCompanyRegulationPdf(downloadRegulationButton.dataset.downloadRegulationPdf); return; } const printButton = event.target.closest('[data-print-document]'); if (printButton) { event.stopPropagation(); printDocument(printButton.dataset.printDocument); return; } const useButton = event.target.closest('[data-use-template]'); if (useButton) { openDocumentModal(useButton.dataset.useTemplate); return; } const companyHistoryEntry = event.target.closest('[data-open-company-history]'); if (companyHistoryEntry) { event.stopPropagation(); openCompanyHistory(companyHistoryEntry.dataset.openCompanyHistory, companyHistoryEntry.dataset.historyIndex); return; } const historyEntry = event.target.closest('[data-open-statute-history]'); if (historyEntry) { event.stopPropagation(); openStatuteHistory(historyEntry.dataset.openStatuteHistory, historyEntry.dataset.historyIndex); return; } const relinkCompanyRegulationButton = event.target.closest('[data-relink-company-regulation]'); if (relinkCompanyRegulationButton) { event.stopImmediatePropagation(); openCompanyRegulationEditor(relinkCompanyRegulationButton.dataset.relinkCompanyRegulation, true); return; } const companyRegulationButton = event.target.closest('[data-open-company-regulation]'); if (companyRegulationButton) { event.stopPropagation(); openCompanyRegulationEditor(companyRegulationButton.dataset.openCompanyRegulation); return; } const companyCard = event.target.closest('[data-open-company]'); if (companyCard) { openCompanyEditor(companyCard.dataset.openCompany); return; } const parliamentAction = event.target.closest('[data-open-parliament-action]'); if (parliamentAction) { event.stopPropagation(); openParliamentEditor(parliamentAction.dataset.openParliamentAction); return; } const parliamentCard = event.target.closest('[data-open-parliament]'); if (parliamentCard) { openParliamentEditor(parliamentCard.dataset.openParliament); return; } const resignButton = event.target.closest('[data-resign-member]'); if (resignButton) { event.stopPropagation(); resignMember(resignButton.dataset.resignMember); return; } const editMemberButton = event.target.closest('[data-edit-member]'); if (editMemberButton) { event.stopPropagation(); openMemberEditor(editMemberButton.dataset.editMember); return; } const nominationButton = event.target.closest('[data-new-nomination]'); if (nominationButton) { event.stopPropagation(); openMemberEditor('', nominationButton.dataset.newNomination); return; } const relinkPartyStatuteButton = event.target.closest('[data-relink-party-statute]'); if (relinkPartyStatuteButton) { event.stopImmediatePropagation(); openPartyStatuteEditor(relinkPartyStatuteButton.dataset.relinkPartyStatute, true); return; } const partyStatuteButton = event.target.closest('[data-open-party-statute]'); if (partyStatuteButton) { event.stopPropagation(); openPartyStatuteEditor(partyStatuteButton.dataset.openPartyStatute); return; } const partyCard = event.target.closest('[data-open-party]'); if (partyCard) { openPartyEditor(partyCard.dataset.openParty); return; } const row = event.target.closest('[data-open-document]'); if (row) openDocumentEditor(row.dataset.openDocument);
        });
        document.addEventListener('keydown', event => { const usefulLinkRow = event.target.closest('[data-open-useful-link]'); if (usefulLinkRow && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openUsefulLink(usefulLinkRow.dataset.openUsefulLink); return; } const parliamentCard = event.target.closest('[data-open-parliament]'); if (parliamentCard && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openParliamentEditor(parliamentCard.dataset.openParliament); return; } const companyHistoryEntry = event.target.closest('[data-open-company-history]'); if (companyHistoryEntry && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openCompanyHistory(companyHistoryEntry.dataset.openCompanyHistory, companyHistoryEntry.dataset.historyIndex); return; } const historyEntry = event.target.closest('[data-open-statute-history]'); if (historyEntry && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openStatuteHistory(historyEntry.dataset.openStatuteHistory, historyEntry.dataset.historyIndex); return; } const companyCard = event.target.closest('[data-open-company]'); if (companyCard && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openCompanyEditor(companyCard.dataset.openCompany); return; } const partyCard = event.target.closest('[data-open-party]'); if (partyCard && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openPartyEditor(partyCard.dataset.openParty); return; } const row = event.target.closest('[data-open-document]'); if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDocumentEditor(row.dataset.openDocument); } });
        document.getElementById('documentDate').value = today();
        document.querySelectorAll('#documentModal, #templateModal, #parliamentModal').forEach(element => { element.classList.remove('modal', 'fade'); element.classList.add('editor-page', 'd-none'); });
        organizeDocumentEditor();
        organizeTemplateEditor();
        refreshCategoryOptions();
        refreshDocumentTemplateOptions();
        populateFontMenus();
        // Sessione ancora valida: remota se il backend risponde, altrimenti si prova
        // a ripristinare quella locale salvata al precedente accesso.
        const sessionValid = remoteMode ? localStorage.getItem(STORAGE_KEYS.session) === 'active' : restoreLocalSession();
        if (sessionValid) {
          scheduleSessionExpiryWarning();
          document.getElementById('loginView').classList.add('d-none');
          document.getElementById('appView').classList.remove('d-none');
          const initialView = currentHashView();
          setView(initialView, false);
        } else {
          document.getElementById('loginView').classList.remove('d-none');
        }

        const loader = document.getElementById('loadingOverlay');
        if (loader) loader.classList.add('d-none');

        startGoogleNameWatcher();

        window.addEventListener('popstate', (event) => {
          if (localStorage.getItem(STORAGE_KEYS.session) !== 'active') return;
          const view = event.state?.view || currentHashView();
          setView(view, false);
          document.querySelectorAll('.editor-page').forEach(el => el.classList.add('d-none'));
        });
      }

/**
 * Tiene i nomi allineati mentre il sito resta aperto: chi rinomina un Google Doc
 * in un'altra scheda ritrova il titolo nuovo senza dover ricaricare la pagina.
 * Si controlla solo a scheda visibile, per non sprecare quota API in sottofondo.
 */
function startGoogleNameWatcher() {
        if (googleNameWatcher) return;
        const tick = () => {
          if (document.hidden) return;
          if (!remoteMode || !googleConnection.connected) return;
          if (localStorage.getItem(STORAGE_KEYS.session) !== 'active') return;
          if (document.querySelector('.editor-page:not(.d-none)')) return; // Non si interrompe una modifica in corso.
          rehydrateGoogleLinks({ silent: true });
        };
        googleNameWatcher = setInterval(tick, GOOGLE_NAME_REFRESH_MS);
        // Tornando sulla scheda si verifica subito: è il momento in cui l'utente
        // rientra dopo aver rinominato il file dentro Google Documenti.
        document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
        window.addEventListener('focus', tick);
      }

      document.addEventListener('DOMContentLoaded', initialize);
      } catch (error) { console.error(error); }
    }
  }
}
