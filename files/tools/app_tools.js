'use strict';

/* ============================================================
   app_tools.js — JavaScript dedicato alla sezione Tools
   ------------------------------------------------------------
   Questo file è separato da app.js e contiene TUTTO il codice
   JavaScript della funzionalità Tools:

   1. La logica della scheda "Tools" del casellario (index.html):
      una riga per ogni file HTML presente nella cartella tools/,
      con ricerca e apertura del tool selezionato.
   2. La guardia di sessione e permessi delle pagine dei tool
      (formattazione.html e simili): senza login valido, sessione
      scaduta o senza il permesso tools.view la pagina resta
      bloccata e si torna al casellario, esattamente come avviene
      per le altre sezioni del sito.
   3. La logica di funzionamento di ogni tool, registrata nella
      mappa toolInitializers in base all'attributo data-tool del
      <body> della pagina.

   Il file viene servito tramite tools/app-tools-loader.php, che
   gli assegna una versione ricavata dalla data di modifica: quando
   app_tools.js cambia cambia anche l'URL, quindi il browser non
   può riusare la copia in cache (stesso meccanismo di app-loader.php
   per app.js, nessuna necessità di svuotare la cache).
   ============================================================ */

/* ============================================================
   1. SCHEDA TOOLS (index.html)
   In modalità remota l'elenco arriva da api.php (action
   tools_list), che legge la cartella tools/ sul server; senza
   backend, o finché la risposta non arriva, si usa l'elenco
   minimo dei tool pubblicati con il sito.
   ============================================================ */

const DEFAULT_TOOLS = [
  { file: 'formattazione.html', title: 'Formattatore normativo TXT', description: 'Trasforma un testo normativo in TXT in un documento formattato, con titoli, articoli e commi numerati.' }
];
let toolsCatalog = DEFAULT_TOOLS.slice();

// Helper locali: non si dipende da app.js, così il file resta
// autonomo anche sulle pagine dei tool dove app.js non è caricato.
function escapeToolText(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}
function toolSearchValue() {
  return (document.getElementById('toolSearch')?.value || '').trim().toLowerCase();
}
function toolMatchesSearch(values, query) {
  return !query || values.filter(Boolean).join(' ').toLowerCase().includes(query);
}

async function loadToolsCatalog() {
  // La scheda esiste solo in index.html, dove apiRequest/remoteMode
  // provengono da app.js; se mancano non c'è nulla da caricare.
  if (typeof apiRequest !== 'function') return;
  if (typeof remoteMode !== 'undefined' && !remoteMode) return;
  // Senza permesso di visualizzazione non si interroga il backend:
  // evita di riempire il log di sicurezza con rifiuti ripetuti.
  if (typeof capable === 'function' && !capable('tools.view') && typeof can === 'function' && !can('tools', 'view')) return;
  try {
    const payload = await apiRequest('tools_list');
    if (Array.isArray(payload.tools)) toolsCatalog = payload.tools;
  } catch { /* Backend momentaneamente non raggiungibile: si mantiene l'elenco già noto. */ }
  const toolsView = document.getElementById('toolsView');
  if (toolsView && !toolsView.classList.contains('d-none')) renderTools();
}

function renderTools() {
  const tableBody = document.getElementById('toolsTableBody');
  if (!tableBody) return;
  const query = toolSearchValue();
  const tools = toolsCatalog.filter(tool => toolMatchesSearch([tool.title, tool.description, tool.file], query));
  const canOpen = typeof capable === 'function' ? capable('tools.open') : true;
  tableBody.innerHTML = tools.map(tool => `<tr class="document-row" data-open-tool="${escapeToolText(tool.file)}" tabindex="0" role="link"><td class="ps-4"><strong>${escapeToolText(tool.title)}</strong>${tool.description ? `<small class="d-block text-secondary">${escapeToolText(tool.description)}</small>` : ''}</td><td><span class="text-secondary useful-link-url">${escapeToolText(tool.file)}</span></td><td class="text-end pe-4">${canOpen ? `<button type="button" class="btn btn-sm btn-primary" data-open-tool="${escapeToolText(tool.file)}">Apri</button>` : ''}</td></tr>`).join('');
  const emptyState = document.getElementById('emptyTools');
  if (emptyState) emptyState.classList.toggle('d-none', tools.length > 0);
}

function openTool(file) {
  if (typeof capable === 'function' && !capable('tools.open')) {
    if (typeof showToast === 'function') showToast('Non hai il permesso di aprire i tools.');
    return;
  }
  const tool = toolsCatalog.find(item => item.file === file);
  if (!tool) {
    if (typeof showToast === 'function') showToast('Tool non trovato.');
    return;
  }
  window.location.href = 'tools/' + encodeURIComponent(tool.file);
}

function bindToolsTab() {
  const search = document.getElementById('toolSearch');
  if (search) search.addEventListener('input', renderTools);
  // Apertura con clic sulla riga o sul pulsante "Apri".
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-open-tool]');
    if (control) openTool(control.dataset.openTool || '');
  });
  // Apertura da tastiera (Invio/Spazio) quando la riga ha il focus.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const control = event.target.closest('[data-open-tool]');
    if (control) { event.preventDefault(); openTool(control.dataset.openTool || ''); }
  });
}

/* ============================================================
   2. GUARDIA DI SESSIONE E PERMESSI DELLE PAGINE DEI TOOL
   Ogni pagina nella cartella tools/ dichiara
   <body data-tool-page="true">: all'avvio si riconvalida la
   sessione PHP tramite api.php (action tools_list, che richiede
   il permesso tools.view e rinnova il timeout di inattività).
   Senza sessione valida si torna al casellario per effettuare il
   login; senza permesso la pagina resta bloccata con un messaggio.
   Se il backend non è raggiungibile si ripiega sulla sessione
   locale del browser, come fa il resto del sito.
   ============================================================ */

const TOOL_SESSION_CHECK_MS = 5 * 60 * 1000; // riconvalida periodica della sessione
let toolSessionTimer = null;
let toolCsrfToken = '';
let toolPageUnlocked = false;

function toolApiUrl(action) {
  // Le pagine dei tool vivono in tools/: api.php sta nella cartella superiore.
  return '../api.php?action=' + encodeURIComponent(action);
}

async function fetchToolSession() {
  let response;
  try {
    response = await fetch(toolApiUrl('tools_list'), { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' });
  } catch {
    return { status: 'unavailable' };
  }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!contentType.includes('application/json') || (payload && payload.error === 'BACKEND_UNAVAILABLE')) return { status: 'unavailable' };
  if (response.status === 401) return { status: 'unauthenticated' };
  if (response.status === 403) return { status: 'forbidden', message: (payload && payload.error) || 'Non hai il permesso di visualizzare i tools.' };
  if (!response.ok || !payload || payload.error || !payload.user) return { status: 'unavailable' };
  return { status: 'ok', user: payload.user, csrfToken: payload.csrfToken || payload.user.csrfToken || '' };
}

function readLocalToolJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

// Sessione locale del browser, usata quando api.php non è raggiungibile:
// è la stessa usata dal casellario per il login senza backend.
function localToolSessionUser() {
  if (localStorage.getItem('cz_session') !== 'active') return null;
  const stored = readLocalToolJson('cz_local_user', null);
  const users = readLocalToolJson('cz_local_users', []);
  const user = Array.isArray(users) ? users.find(item => item && item.id === stored?.id && !item.deletedAt) : null;
  if (!user) return null;
  const roles = readLocalToolJson('cz_local_roles', []);
  const role = (Array.isArray(roles) ? roles : []).find(item => item && (item.id === user.roleId || item.roleKey === user.role)) || {};
  return {
    username: user.username,
    displayName: user.displayName || user.username,
    mustChangeCredentials: Boolean(user.mustChangeCredentials),
    isPrimaryAdmin: Boolean(user.isPrimaryAdmin),
    capabilities: user.isPrimaryAdmin ? ['*'] : (Array.isArray(role.capabilities) ? role.capabilities : []),
    permissions: user.isPrimaryAdmin ? { '*': { view: true } } : ((role.permissions && typeof role.permissions === 'object') ? role.permissions : {})
  };
}

function localUserCanUseTools(user) {
  if (!user) return false;
  if (user.isPrimaryAdmin) return true;
  const capabilities = Array.isArray(user.capabilities) ? user.capabilities : [];
  if (capabilities.includes('*') || capabilities.includes('tools.view') || capabilities.includes('tools.open')) return true;
  const permissions = user.permissions || {};
  return Boolean((permissions['*'] && permissions['*'].view) || (permissions.tools && permissions.tools.view));
}

function unlockToolPage(user) {
  const guard = document.getElementById('toolGuard');
  if (guard) guard.remove();
  const content = document.getElementById('toolContent');
  if (content) content.hidden = false;
  const badge = document.getElementById('toolUserBadge');
  if (badge && user) badge.textContent = user.displayName ? `Autenticato: ${user.displayName}` : '';
  const logoutButton = document.getElementById('toolLogoutButton');
  if (logoutButton && !logoutButton.dataset.bound) {
    logoutButton.dataset.bound = 'true';
    logoutButton.addEventListener('click', () => {
      logoutButton.disabled = true;
      logoutButton.textContent = 'Uscita…';
      logoutFromToolPage();
    });
  }
  toolPageUnlocked = true;
}

function lockToolPage(message) {
  const spinner = document.getElementById('toolGuardSpinner');
  if (spinner) spinner.classList.add('tool-guard-hidden');
  const title = document.getElementById('toolGuardTitle');
  if (title) title.textContent = 'Accesso non consentito';
  const text = document.getElementById('toolGuardMessage');
  if (text) text.textContent = message;
  toolPageUnlocked = false;
}

async function logoutFromToolPage() {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (toolCsrfToken) headers['X-CSRF-Token'] = toolCsrfToken;
    await fetch(toolApiUrl('logout'), { method: 'POST', headers, body: '{}' , credentials: 'same-origin' });
  } catch { /* Anche senza backend si pulisce la sessione locale, come nel casellario. */ }
  localStorage.removeItem('cz_session');
  localStorage.removeItem('cz_local_user');
  window.location.replace('../index.html');
}

async function revalidateToolSession() {
  if (!toolPageUnlocked) return;
  const outcome = await fetchToolSession();
  if (outcome.status === 'unauthenticated') { window.location.replace('../index.html'); return; }
  if (outcome.status === 'forbidden') { lockToolPage(outcome.message); return; }
  // Sessione riconvalidata: la richiesta stessa rinnova il timeout
  // di inattività lato server, come ogni chiamata autenticata del sito.
  if (outcome.status === 'ok' && outcome.user && outcome.user.mustChangeCredentials) window.location.replace('../index.html');
}

function startToolSessionWatch() {
  clearInterval(toolSessionTimer);
  toolSessionTimer = setInterval(revalidateToolSession, TOOL_SESSION_CHECK_MS);
  // Riaprendo la scheda del browser si riconvalida subito, così una
  // sessione scaduta nel frattempo non lascia usare il tool.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revalidateToolSession(); });
}

async function guardToolPage() {
  const guard = document.getElementById('toolGuard');
  if (!guard) return;
  const outcome = await fetchToolSession();
  if (outcome.status === 'ok') {
    // Il cambio credenziali obbligatorio si completa nel casellario.
    if (outcome.user && outcome.user.mustChangeCredentials) { window.location.replace('../index.html'); return; }
    toolCsrfToken = outcome.csrfToken;
    unlockToolPage(outcome.user);
    startToolSessionWatch();
    return;
  }
  if (outcome.status === 'unauthenticated') { window.location.replace('../index.html'); return; }
  if (outcome.status === 'forbidden') { lockToolPage(outcome.message); return; }
  // Backend non raggiungibile: fallback sulla sessione locale del browser.
  const localUser = localToolSessionUser();
  if (localUser) {
    if (localUser.mustChangeCredentials) { window.location.replace('../index.html'); return; }
    if (localUserCanUseTools(localUser)) { unlockToolPage(localUser); return; }
    lockToolPage('Non hai il permesso di visualizzare i tools.');
    return;
  }
  lockToolPage('Il server non è raggiungibile o non è configurato correttamente: verifica che api.php venga eseguito da PHP e che private/config.php contenga i dati del database MySQL. Torna al casellario e accedi prima di usare i tools.');
}

/* ============================================================
   3. LOGICA DEI SINGOLI TOOL
   Ogni tool registra la propria funzione di avvio qui sotto: la
   pagina la attiva con <body data-tool="chiave">. Tutto il codice
   JavaScript del tool vive in questo file, fuori dal HTML.
   ============================================================ */

function initFormattazioneTool() {

/* ============================================================
   STATO
   ============================================================ */

let testoOriginale = "";

const idsRegole = [
    "font",
    "dimensione",
    "stileNormale",
    "giustificato",
    "interlinea",
    "spaziatura",
    "titoliGrassetto",
    "articoliGrassetto",
    "commiRomani",
    "numeriGrassetto",
    "separaTitolo",
    "separaArticoli",
    "separaCommi",
    "trattini",
    "suddivisioneLogica",
    "mantieniCommi"
];

const byId = id => document.getElementById(id);

const documento = byId("documento");
const statusEl = byId("status");


/* ============================================================
   CONFIGURAZIONE
   ============================================================ */

function leggiRegole() {
    const regole = {};

    idsRegole.forEach(id => {
        regole[id] = byId(id).checked;
    });

    regole.modalita = byId("modalita").value;

    const max = Number(byId("maxParole").value);

    regole.maxParole = Number.isFinite(max)
        ? Math.max(20, Math.min(1000, max))
        : 120;

    return regole;
}

function applicaStili(regole) {

    const root = documento;

    root.style.fontFamily = regole.font
        ? '"Raleway", sans-serif'
        : 'Arial, sans-serif';

    root.style.fontSize = regole.dimensione
        ? "12pt"
        : "initial";

    root.style.fontStyle = regole.stileNormale
        ? "normal"
        : "";

    root.style.fontWeight = "400";

    root.style.textAlign = regole.giustificato
        ? "justify"
        : "left";

    root.style.lineHeight = regole.interlinea
        ? "1.15"
        : "normal";

    root.querySelectorAll("p").forEach(p => {
        p.style.marginTop = regole.spaziatura ? "0" : "";
        p.style.marginBottom = regole.spaziatura ? "0" : "";
    });

    root.querySelectorAll(".titolo").forEach(el => {
        el.style.fontWeight = regole.titoliGrassetto ? "700" : "400";
    });

    root.querySelectorAll(".articolo").forEach(el => {
        el.style.fontWeight = regole.articoliGrassetto ? "700" : "400";
    });

    root.querySelectorAll(".numero-comma").forEach(el => {
        el.style.fontWeight = regole.numeriGrassetto ? "700" : "400";
    });
}


/* ============================================================
   PULIZIA E RICONOSCIMENTO
   ============================================================ */

function pulisci(testo) {
    return testo
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .split("\n")
        .map(r => r.trim())
        .join("\n")
        .trim();
}

function eTitolo(riga) {
    return /^Titolo\s+[IVXLCDM]+(?:\s*[–—-].*)?$/i.test(riga)
        || /^TITOLO\s+[IVXLCDM]+/i.test(riga);
}

function eArticolo(riga) {
    return /^(?:Art\.|Articolo)\s*\d+/i.test(riga);
}

function eCommaEsplicito(riga) {
    return /^\s*(?:[IVXLCDM]+\.|\d+\.)\s+/.test(riga);
}

function parole(testo) {
    return testo.trim().split(/\s+/).filter(Boolean).length;
}

function escapeHTML(testo) {
    return String(testo)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* ============================================================
   NUMERI ROMANI
   ============================================================ */

function romano(numero) {

    const valori = [
        [1000, "M"],
        [900, "CM"],
        [500, "D"],
        [400, "CD"],
        [100, "C"],
        [90, "XC"],
        [50, "L"],
        [40, "XL"],
        [10, "X"],
        [9, "IX"],
        [5, "V"],
        [4, "IV"],
        [1, "I"]
    ];

    let risultato = "";

    for (const [valore, simbolo] of valori) {
        while (numero >= valore) {
            risultato += simbolo;
            numero -= valore;
        }
    }

    return risultato;
}


/* ============================================================
   SUDDIVISIONE LOGICA
   ============================================================ */

function dividiFrasi(testo) {
    return testo
        .replace(/\s+/g, " ")
        .match(/[^.!?]+(?:[.!?]+|$)/g)
        ?.map(f => f.trim())
        .filter(Boolean) || [];
}

function indicatoriCambio(modalita) {

    const base = [
        "inoltre",
        "altresì",
        "tuttavia",
        "peraltro",
        "in ogni caso",
        "resta fermo",
        "spetta",
        "compete",
        "è istituito",
        "sono istituiti",
        "si applica",
        "si applicano",
        "è vietato",
        "sono vietati",
        "è consentito",
        "sono consentiti",
        "è riconosciuto",
        "sono riconosciuti",
        "è garantito",
        "sono garantiti"
    ];

    if (modalita === "conservativa") {
        return base;
    }

    if (modalita === "bilanciata") {
        return base.concat([
            "la presente legge",
            "il presente regolamento",
            "l'autorità",
            "le autorità",
            "il governo",
            "il parlamento",
            "il presidente",
            "la regione",
            "le regioni",
            "i comuni",
            "gli enti",
            "ai fini",
            "nell'ambito",
            "in materia di"
        ]);
    }

    return base.concat([
        "la presente legge",
        "il presente regolamento",
        "l'autorità",
        "le autorità",
        "il governo",
        "il parlamento",
        "il presidente",
        "la regione",
        "le regioni",
        "i comuni",
        "gli enti",
        "ai fini",
        "nell'ambito",
        "in materia di",
        "è fatto obbligo",
        "è fatto divieto",
        "sono previste",
        "sono previsti",
        "sono disciplinate",
        "sono disciplinati",
        "si dispone",
        "si stabilisce"
    ]);
}

function cambiaArgomento(precedente, successiva, regole) {

    const next = successiva.toLowerCase().trim();

    return indicatoriCambio(regole.modalita)
        .some(indicatore => next.startsWith(indicatore));
}

function suddividiCommi(testo, regole) {

    const righe = testo
        .split("\n")
        .map(r => r.trim())
        .filter(Boolean);

    if (
        regole.mantieniCommi &&
        righe.filter(eCommaEsplicito).length >= 2
    ) {

        const commi = [];
        let corrente = "";

        for (const riga of righe) {

            if (eCommaEsplicito(riga)) {

                if (corrente) {
                    commi.push(corrente.trim());
                }

                corrente = riga.replace(
                    /^\s*(?:[IVXLCDM]+\.|\d+\.)\s+/,
                    ""
                );

            } else {
                corrente += " " + riga;
            }
        }

        if (corrente) {
            commi.push(corrente.trim());
        }

        return commi;
    }

    if (!regole.suddivisioneLogica) {
        return [righe.join(" ").trim()].filter(Boolean);
    }

    const frasi = dividiFrasi(testo);

    if (!frasi.length) {
        return [];
    }

    const commi = [];
    let corrente = "";
    let nParole = 0;

    for (let i = 0; i < frasi.length; i++) {

        const frase = frasi[i];
        const n = parole(frase);

        if (!corrente) {
            corrente = frase;
            nParole = n;
            continue;
        }

        const cambio = cambiaArgomento(
            frasi[i - 1],
            frase,
            regole
        );

        /*
         * In modalità conservativa, si divide solo quando
         * esiste un indicatore esplicito di cambio.
         *
         * Nelle altre modalità, il limite di lunghezza
         * costituisce un ulteriore punto di divisione.
         */

        const superaLimite = nParole >= regole.maxParole;

        if (
            cambio &&
            nParole >= 18
        ) {

            commi.push(corrente.trim());
            corrente = frase;
            nParole = n;

        } else if (
            superaLimite &&
            regole.modalita !== "conservativa"
        ) {

            commi.push(corrente.trim());
            corrente = frase;
            nParole = n;

        } else {

            corrente += " " + frase;
            nParole += n;
        }
    }

    if (corrente) {
        commi.push(corrente.trim());
    }

    return commi;
}


/* ============================================================
   ANALISI DEL DOCUMENTO
   ============================================================ */

function analizza(testo) {

    const righe = pulisci(testo)
        .split("\n");

    const sezioni = [];

    let titolo = null;
    let articolo = null;
    let contenuto = [];

    function salva() {

        if (!articolo) {
            return;
        }

        sezioni.push({
            titolo,
            articolo,
            contenuto: contenuto.join("\n")
        });

        articolo = null;
        contenuto = [];
    }

    for (const riga of righe) {

        if (!riga) {
            continue;
        }

        if (eTitolo(riga)) {
            salva();
            titolo = riga;
            continue;
        }

        if (eArticolo(riga)) {
            salva();
            articolo = riga;
            continue;
        }

        if (articolo) {
            contenuto.push(riga);
        }
    }

    salva();

    return sezioni;
}


/* ============================================================
   GENERAZIONE DEL RISULTATO
   ============================================================ */

function genera(sezioni, regole) {

    let html = "";
    let ultimoTitolo = null;
    let primoArticolo = true;

    sezioni.forEach(sezione => {

        if (
            sezione.titolo &&
            sezione.titolo !== ultimoTitolo
        ) {

            if (html && regole.separaArticoli) {
                html += '<div class="separatore"></div>';
            }

            html += `
        <p class="titolo">
            ${escapeHTML(sezione.titolo)}
        </p>
    `;

            if (regole.separaTitolo) {
                html += '<div class="separatore"></div>';
            }

            ultimoTitolo = sezione.titolo;
        }

        if (!primoArticolo && regole.separaArticoli) {
            html += '<div class="separatore"></div>';
        }

        primoArticolo = false;

        html += `
    <p class="articolo">
        ${escapeHTML(sezione.articolo)}
    </p>
`;

        const commi = suddividiCommi(
            sezione.contenuto,
            regole
        );

        commi.forEach((testoComma, i) => {

            if (i > 0 && regole.separaCommi) {
                html += '<div class="separatore"></div>';
            }

            const numero = regole.commiRomani
                ? romano(i + 1) + "."
                : String(i + 1) + ".";

            const numeroHTML = `
        <span class="numero-comma">
            ${escapeHTML(numero)}
        </span>
    `;

            html += `
        <p class="comma">
            ${numeroHTML}
            ${escapeHTML(testoComma)}
        </p>
    `;
        });
    });

    return html;
}


/* ============================================================
   ELABORAZIONE
   ============================================================ */

function elabora() {

    if (!testoOriginale) {
        statusEl.textContent = "Carica prima un file TXT.";
        return;
    }

    const regole = leggiRegole();
    const sezioni = analizza(testoOriginale);

    if (!sezioni.length) {

        documento.innerHTML = `
    <p>
        Nessun Articolo riconosciuto nel file.
    </p>
`;

        applicaStili(regole);
        statusEl.textContent = "Nessun articolo riconosciuto.";
        return;
    }

    documento.innerHTML = genera(sezioni, regole);

    applicaStili(regole);

    statusEl.textContent =
        "Elaborazione completata: " +
        sezioni.length +
        " articoli riconosciuti.";
}


/* ============================================================
   CARICAMENTO FILE
   ============================================================ */

byId("fileInput").addEventListener("change", function () {

    const file = this.files[0];

    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.onload = function (event) {

        testoOriginale = event.target.result;

        elabora();
    };

    reader.readAsText(file, "UTF-8");
});


/* ============================================================
   EVENTI
   ============================================================ */

byId("elaboraBtn").addEventListener("click", elabora);

byId("resetBtn").addEventListener("click", function () {

    idsRegole.forEach(id => {
        byId(id).checked = true;
    });

    byId("modalita").value = "conservativa";
    byId("maxParole").value = 120;

    elabora();
});


byId("stampaBtn").addEventListener("click", function () {
    window.print();
});


/* ============================================================
   ESPORTAZIONE HTML
   ============================================================ */

function creaDocumentoHTML() {

    const regole = leggiRegole();

    const font = regole.font
        ? '"Raleway", sans-serif'
        : 'Arial, sans-serif';

    const fontSize = regole.dimensione
        ? "12pt"
        : "initial";

    const weight = regole.stileNormale
        ? "400"
        : "normal";

    const align = regole.giustificato
        ? "justify"
        : "left";

    const lineHeight = regole.interlinea
        ? "1.15"
        : "normal";

    const margin = regole.spaziatura
        ? "0"
        : "initial";

    const html = `
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>Documento normativo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;700&display=swap" rel="stylesheet">
<style>
body {
    font-family: ${font};
    font-size: ${fontSize};
    font-weight: ${weight};
    line-height: ${lineHeight};
    text-align: ${align};
}
p {
    margin-top: ${margin};
    margin-bottom: ${margin};
}
.titolo {
    font-weight: ${regole.titoliGrassetto ? "700" : "400"};
}
.articolo {
    font-weight: ${regole.articoliGrassetto ? "700" : "400"};
}
.numero-comma {
    font-weight: ${regole.numeriGrassetto ? "700" : "400"};
}
.separatore {
    height: 1.15em;
}
</style>
</head>
<body>
${documento.innerHTML}
</body>
</html>
`;

    return html;
}

byId("copiaBtn").addEventListener("click", async function () {

    const html = creaDocumentoHTML();

    try {
        await navigator.clipboard.writeText(html);
        statusEl.textContent = "HTML copiato negli appunti.";
    } catch (error) {
        statusEl.textContent =
            "Copia automatica non disponibile. Usa il download HTML.";
    }
});


byId("scaricaBtn").addEventListener("click", function () {

    const html = creaDocumentoHTML();

    const blob = new Blob(
        [html],
        { type: "text/html;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "documento_formattato.html";

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    statusEl.textContent = "File HTML generato.";
});

}


// Registro dei tool pubblicati: la chiave corrisponde all'attributo
// data-tool del <body> della pagina HTML del tool.
const toolInitializers = {
  formattazione: initFormattazioneTool
};

function bootAppTools() {
  const body = document.body;
  if (!body) return;
  // Pagine dei tool: guardia di sessione e permessi.
  if (body.dataset.toolPage === 'true') guardToolPage();
  // Casellario (index.html): scheda Tools.
  if (document.getElementById('toolsTableBody')) bindToolsTab();
  // Avvio del tool dichiarato dalla pagina.
  const toolKey = body.dataset.tool || '';
  if (toolKey && typeof toolInitializers[toolKey] === 'function') toolInitializers[toolKey]();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAppTools);
else bootAppTools();
