'use strict';

/*
 * Logica JavaScript della sezione "Tools" del casellario.
 *
 * Questo file è volutamente separato da app.js e contiene TUTTA la logica dei
 * tools: sia la scheda "Tools" dentro index.html, sia le singole pagine della
 * cartella tools (es. formattazione.html), che restano puro HTML come index.
 *
 * Viene caricato da tools/app-tools-loader.php, che aggiunge automaticamente
 * una versione basata sulla data di modifica del file: a ogni modifica cambia
 * l'URL e il browser scarica la copia nuova senza dover mai svuotare la cache
 * a mano (stesso meccanismo usato per app.js).
 *
 * Per aggiungere un nuovo tool: crea la pagina HTML nella cartella tools,
 * includi <script src="app-tools-loader.php"></script> e aggiungi una riga
 * all'elenco TOOLS_CATALOG qui sotto.
 */

/* ============================================================
   REGISTRO DEI TOOLS
   Una voce per ogni file HTML presente nella cartella tools.
   ============================================================ */

const TOOLS_CATALOG = [
  { id: 'formattazione', name: 'Formattatore normativo TXT', description: 'Converte un file TXT in un documento normativo formattato (titoli, articoli e commi).', file: 'tools/formattazione.html' },
];

/* ============================================================
   COSTANTI E HELPER CONDIVISI
   Le pagine dei tools non caricano app.js: dove serve, si usano
   fallback locali equivalenti alle funzioni del file principale.
   ============================================================ */

const TOOLS_SESSION_KEY = 'cz_session';
const TOOLS_SESSION_IDLE_LIFETIME_MS = 150 * 60 * 1000;
const TOOLS_SESSION_EXPIRY_WARNING_MS = 30 * 1000;
let toolsSessionExpiryWarningTimer = null;

// Vero solo dentro una pagina della cartella tools (es. formattazione.html).
function isToolPage() {
  return Boolean(document.getElementById('toolView'));
}

function toolsShowToast(message) {
  if (typeof showToast === 'function') { showToast(message); return; }
  const toast = document.getElementById('appToast');
  if (!toast) { window.alert(message); return; }
  toast.querySelector('.toast-body').textContent = message;
  bootstrap.Toast.getOrCreateInstance(toast).show();
}

function toolsEscapeHtml(value = '') {
  if (typeof escapeHtml === 'function') return escapeHtml(value);
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

function toolsScheduleSessionExpiryWarning() {
  clearTimeout(toolsSessionExpiryWarningTimer);
  if (localStorage.getItem(TOOLS_SESSION_KEY) !== 'active') return;
  toolsSessionExpiryWarningTimer = setTimeout(() => {
    window.alert('La sessione scadrà tra 30 secondi per inattività. Torna al casellario ed esegui un’azione per mantenerla attiva.');
  }, TOOLS_SESSION_IDLE_LIFETIME_MS - TOOLS_SESSION_EXPIRY_WARNING_MS);
}

/* ============================================================
   SCHEDA "TOOLS" DENTRO INDEX.HTML
   Stessa impostazione della sezione "Link utili": una riga per
   tool, click sulla riga per aprire la pagina.
   ============================================================ */

// Percorsi consentiti: solo pagine HTML dentro la cartella tools, senza
// attraversamenti di directory o URL esterni.
function normalizeToolPath(value) {
  const path = String(value || '');
  return /^tools\/[a-zA-Z0-9_-]+\.html$/.test(path) ? path : '';
}

function openTool(id) {
  // Stessi controlli delle altre sezioni: capacità dedicata e sessione attiva.
  if (typeof capable === 'function' && !capable('tools.open')) { toolsShowToast('Non hai il permesso di aprire i tools.'); return; }
  if (localStorage.getItem(TOOLS_SESSION_KEY) !== 'active') { toolsShowToast('Sessione non attiva. Effettua nuovamente il login.'); return; }
  const tool = TOOLS_CATALOG.find(item => item.id === id);
  const url = normalizeToolPath(tool?.file);
  if (!url) { toolsShowToast('Tool non valido.'); return; }
  window.location.href = url;
}

function renderTools() {
  const body = document.getElementById('toolsTableBody');
  if (!body) return;
  const query = typeof archiveSearchValue === 'function' ? archiveSearchValue('toolSearch') : '';
  const canView = typeof capable !== 'function' || capable('tools.view');
  const matches = values => typeof matchesArchiveSearch === 'function' ? matchesArchiveSearch(values, query) : true;
  const tools = canView ? TOOLS_CATALOG.filter(item => matches([item.name, item.description, item.file])) : [];
  body.innerHTML = tools.map(item => `<tr class="document-row" data-open-tool="${toolsEscapeHtml(item.id)}" tabindex="0" role="link"><td class="ps-4 fw-semibold">${toolsEscapeHtml(item.name)}</td><td><span class="text-secondary">${toolsEscapeHtml(item.description)}</span></td><td class="text-end pe-4"><div class="d-flex justify-content-end gap-2"><button type="button" class="btn btn-sm btn-primary" data-open-tool-button="${toolsEscapeHtml(item.id)}">Apri tool</button></div></td></tr>`).join('');
  document.getElementById('emptyTools')?.classList.toggle('d-none', tools.length > 0);
}

// Esposto ad app.js, che lo invoca quando la vista "tools" diventa attiva.
window.renderTools = renderTools;

function bindToolsListEvents() {
  document.getElementById('toolSearch')?.addEventListener('input', renderTools);
  document.addEventListener('click', event => {
    const toolButton = event.target.closest('[data-open-tool-button]');
    if (toolButton) { event.stopPropagation(); openTool(toolButton.dataset.openToolButton); return; }
    const toolRow = event.target.closest('[data-open-tool]');
    if (toolRow && !event.target.closest('button')) openTool(toolRow.dataset.openTool);
  });
  document.addEventListener('keydown', event => {
    const toolRow = event.target.closest('[data-open-tool]');
    if (toolRow && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openTool(toolRow.dataset.openTool); }
  });
}

/* ============================================================
   CONTROLLI DI SICUREZZA E SESSIONE DELLE PAGINE TOOL
   Gli stessi controlli del resto del sito: sessione attiva nel
   browser, verifica lato server (api.php?action=state, che
   rinnova e valida la sessione PHP, controlla IP/user agent e
   scadenza per inattività) e capacità dedicata tools.open.
   ============================================================ */

function toolsDenyAccess(message) {
  window.alert(message);
  window.location.replace('../index.html');
}

async function toolsEnforceAccess() {
  // Nessuna sessione nel browser: si torna alla pagina di accesso.
  if (localStorage.getItem(TOOLS_SESSION_KEY) !== 'active') {
    toolsDenyAccess('Accedi al casellario per usare i tools.');
    return false;
  }
  try {
    const response = await fetch('../api.php?action=state', { credentials: 'same-origin' });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('backend non raggiungibile');
    if (response.status === 401) {
      // Sessione scaduta o non valida lato server: stessa pulizia di app.js.
      localStorage.removeItem(TOOLS_SESSION_KEY);
      localStorage.removeItem('cz_local_user');
      toolsDenyAccess('Sessione scaduta. Effettua nuovamente il login.');
      return false;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || 'backend non raggiungibile');
    const user = payload.user || {};
    const capabilities = Array.isArray(user.capabilities) ? user.capabilities : [];
    if (!(user.isPrimaryAdmin || capabilities.includes('*') || capabilities.includes('tools.open'))) {
      toolsDenyAccess('Non hai il permesso di aprire i tools.');
      return false;
    }
  } catch {
    // Backend non raggiungibile: come nel resto del sito vale la sessione
    // locale già attiva in questo browser (modalità locale).
  }
  toolsScheduleSessionExpiryWarning();
  return true;
}

async function bootstrapToolPage() {
  const allowed = await toolsEnforceAccess();
  if (!allowed) return false;
  document.getElementById('toolView').classList.remove('d-none');
  document.getElementById('loadingOverlay')?.classList.add('d-none');
  return true;
}

/* ============================================================
   TOOL: FORMATTATORE NORMATIVO TXT (formattazione.html)
   ============================================================ */

function initFormattazioneTool() {
  const $ = id => document.getElementById(id);
  const documento = $('documento');
  if (!documento) return; // La pagina aperta non è il formattatore.

  const statusEl = $('status');
  let testoOriginale = '';

  const idsRegole = [
    'font',
    'dimensione',
    'stileNormale',
    'giustificato',
    'interlinea',
    'spaziatura',
    'titoliGrassetto',
    'articoliGrassetto',
    'commiRomani',
    'numeriGrassetto',
    'separaTitolo',
    'separaArticoli',
    'separaCommi',
    'trattini',
    'suddivisioneLogica',
    'mantieniCommi'
  ];

  /* ── Configurazione ────────────────────────────────────── */

  function leggiRegole() {
    const regole = {};

    idsRegole.forEach(id => {
      regole[id] = $(id).checked;
    });

    regole.modalita = $('modalita').value;

    const max = Number($('maxParole').value);

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
      ? '12pt'
      : 'initial';

    root.style.fontStyle = regole.stileNormale
      ? 'normal'
      : '';

    root.style.fontWeight = '400';

    root.style.textAlign = regole.giustificato
      ? 'justify'
      : 'left';

    root.style.lineHeight = regole.interlinea
      ? '1.15'
      : 'normal';

    root.querySelectorAll('p').forEach(p => {
      p.style.marginTop = regole.spaziatura ? '0' : '';
      p.style.marginBottom = regole.spaziatura ? '0' : '';
    });

    root.querySelectorAll('.titolo').forEach(el => {
      el.style.fontWeight = regole.titoliGrassetto ? '700' : '400';
    });

    root.querySelectorAll('.articolo').forEach(el => {
      el.style.fontWeight = regole.articoliGrassetto ? '700' : '400';
    });

    root.querySelectorAll('.numero-comma').forEach(el => {
      el.style.fontWeight = regole.numeriGrassetto ? '700' : '400';
    });
  }

  /* ── Pulizia e riconoscimento ──────────────────────────── */

  function pulisci(testo) {
    const intestazione = '(?:LIBRO|PARTE|TITOLO|CAPO|SEZIONE|SOTTOSEZIONE)\\s+(?:[IVXLCDM]+|\\d+[°º]?|UNIC[OA]|PRIM[OA]|SECOND[OA]|TERZ[OA]|QUART[OA]|QUINT[OA]|SEST[OA]|SETTIM[OA]|OTTAV[OA]|NON[OA]|DECIM[OA])|(?:Art\\.?|Articolo)\\s*\\d+';

    return testo
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00a0/g, ' ')
      // Alcune esportazioni TXT usano «#-» come marcatore di paragrafo.
      // Se introduce un Titolo o un Articolo è un confine strutturale; negli
      // altri casi è solo rumore di esportazione e non deve finire nel testo.
      .replace(new RegExp(`[ \\t]*#-[ \\t]*(?=${intestazione})`, 'gi'), '\n')
      .replace(new RegExp(`([.!?])[ \\t]+(?=${intestazione})`, 'gi'), '$1\n')
      .replace(/[ \t]*#-[ \t]*/g, ' ')
      // Rimuove il cancelletto Markdown davanti alle intestazioni senza
      // eliminare eventuali trattini appartenenti al contenuto.
      .replace(/^\s*#{1,6}\s*(?=(?:LIBRO|PARTE|TITOLO|CAPO|SEZIONE|SOTTOSEZIONE|Art\.?|Articolo)\b)/gim, '')
      .replace(/[ \t]+/g, ' ')
      .split('\n')
      .map(r => r.trim())
      .join('\n')
      .trim();
  }

  // Riconosce i livelli strutturali normalmente usati nei testi normativi.
  // Prima veniva accettato soltanto «Titolo» seguito da un numero romano:
  // CAPO, PARTE, LIBRO, SEZIONE, numeri arabi e ordinali restavano nel testo.
  function eTitolo(riga) {
    const livello = '(?:LIBRO|PARTE|TITOLO|CAPO|SEZIONE|SOTTOSEZIONE)';
    const numero = '(?:[IVXLCDM]+|\\d+[°º]?|UNIC[OA]|PRIM[OA]|SECOND[OA]|TERZ[OA]|QUART[OA]|QUINT[OA]|SEST[OA]|SETTIM[OA]|OTTAV[OA]|NON[OA]|DECIM[OA])';
    return new RegExp(`^${livello}\\s+${numero}(?:\\s*[–—:.-]\\s*.*)?$`, 'i').test(riga)
      || /^(?:PREAMBOLO|DISPOSIZIONI\s+(?:GENERALI|FINALI|TRANSITORIE|ATTUATIVE))(?:\s*[–—:.-]\s*.*)?$/i.test(riga);
  }

  function eArticolo(riga) {
    // Gestisce anche «Art. 3-bis», «ARTICOLO 4 ter» e l'eventuale rubrica
    // presente sulla stessa riga.
    return /^(?:Art\.?|Articolo)\s*\d+(?:[\s.-]*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?\b/i.test(riga);
  }

  function separaArticoloEContenuto(riga) {
    const match = riga.match(/^((?:Art\.?|Articolo)\s*\d+(?:[\s.-]*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)(?:\s*[–—-]\s*(.*))?$/i);
    if (!match || !match[2]) return { intestazione: riga, contenuto: '' };

    const prefisso = match[1].trim();
    const resto = match[2].trim();
    const paroleRubrica = Array.from(resto.matchAll(/\S+/g));
    const iniziPeriodo = /^(?:Il|Lo|La|I|Gli|Le|Un|Una|È|Sono|Si|Ogni|Ciascun[oa]?|Chiunque|Rinascita|Sarà|Viene|In\s+caso|Sino\s+al)\b/i;

    // Nelle esportazioni compattate la rubrica e il primo periodo possono
    // trovarsi sulla stessa riga: «Art. 3 - Principi Fondanti Il partito...».
    // Dopo almeno due parole di rubrica cerchiamo un tipico inizio di periodo.
    for (let i = 2; i < paroleRubrica.length; i++) {
      const indice = paroleRubrica[i].index;
      const possibileContenuto = resto.slice(indice);
      if (!iniziPeriodo.test(possibileContenuto)) continue;
      const rubrica = resto.slice(0, indice).trim();
      return { intestazione: `${prefisso} - ${rubrica}`, contenuto: possibileContenuto.trim() };
    }

    return { intestazione: `${prefisso} - ${resto}`, contenuto: '' };
  }

  function estraiCommaEsplicito(riga) {
    const match = String(riga).match(/^\s*((?:\d+(?:[.-]?(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?|[IVXLCDM]+)[.)])(?:\s+|$)(.*)$/i);
    return match ? { numero: match[1], testo: match[2].trim() } : null;
  }

  function eCommaEsplicito(riga) {
    return Boolean(estraiCommaEsplicito(riga));
  }

  function eSottotitolo(riga) {
    const testo = riga.replace(/^\((.*)\)$/, '$1').trim();
    if (!testo || testo.length > 140 || eTitolo(testo) || eArticolo(testo) || eCommaEsplicito(testo)) return false;
    // Rubriche fra parentesi oppure brevi intestazioni tutte maiuscole.
    return /^\(.+\)$/.test(riga) || (testo === testo.toLocaleUpperCase('it-IT') && /[A-ZÀ-ÖØ-Ý]/.test(testo) && !/[.;!?]$/.test(testo));
  }

  function unisciIntestazione(base, dettaglio) {
    const pulito = dettaglio.replace(/^\((.*)\)$/, '$1').trim();
    return pulito ? `${base} – ${pulito}` : base;
  }

  function livelloTitolo(riga) {
    const tipo = riga.trim().split(/\s+/, 1)[0].toLocaleUpperCase('it-IT');
    return { LIBRO: 0, PARTE: 1, TITOLO: 2, CAPO: 3, SEZIONE: 4, SOTTOSEZIONE: 5 }[tipo] ?? 2;
  }

  function parole(testo) {
    return testo.trim().split(/\s+/).filter(Boolean).length;
  }

  function escapeHTML(testo) {
    return String(testo)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formattaTestoComma(testo, regole) {
    if (!regole.trattini) return escapeHTML(testo);
    const posizioneDuePunti = testo.indexOf(':');
    if (posizioneDuePunti < 0) return escapeHTML(testo);

    const introduzione = testo.slice(0, posizioneDuePunti + 1);
    const elementi = testo.slice(posizioneDuePunti + 1).split(';').map(item => item.trim()).filter(Boolean);
    if (elementi.length < 2) return escapeHTML(testo);

    return `${escapeHTML(introduzione)}<br>${elementi.map(item => `- ${escapeHTML(item)}`).join(';<br>')}`;
  }

  /* ── Numeri romani ─────────────────────────────────────── */

  function romano(numero) {

    const valori = [
      [1000, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I']
    ];

    let risultato = '';

    for (const [valore, simbolo] of valori) {
      while (numero >= valore) {
        risultato += simbolo;
        numero -= valore;
      }
    }

    return risultato;
  }

  /* ── Suddivisione logica ───────────────────────────────── */

  function dividiFrasi(testo) {
    const normalizzato = testo.replace(/\s+/g, ' ').trim();
    if (!normalizzato) return [];

    // Si separa solo davanti a un probabile nuovo periodo. In questo modo i
    // punti di «art. 3», «n. 5», iniziali e numeri decimali non producono falsi
    // commi, come accadeva con la precedente espressione regolare.
    const frasi = normalizzato.split(/(?<=[.!?])\s+(?=[«“"'(]*[A-ZÀ-ÖØ-Þ])/u);
    return frasi.map(frase => frase.trim()).filter(Boolean);
  }

  function indicatoriCambio(modalita) {
    const forti = [
      'inoltre', 'altresì', 'tuttavia', 'peraltro', 'in ogni caso',
      'resta fermo', 'restano fermi', 'fatto salvo', 'fatta salva',
      'spetta', 'compete', 'è istituito', 'sono istituiti',
      'si applica', 'si applicano', 'è vietato', 'sono vietati',
      'è consentito', 'sono consentiti', 'è riconosciuto',
      'sono riconosciuti', 'è garantito', 'sono garantiti',
      'è fatto obbligo', 'è fatto divieto'
    ];
    if (modalita === 'conservativa') return forti;

    const medi = [
      'la presente legge', 'il presente regolamento', "l'autorità", 'le autorità',
      'il governo', 'il parlamento', 'il presidente', 'la regione', 'le regioni',
      'il comune', 'i comuni', "l'ente", 'gli enti', 'ai fini', "nell'ambito",
      'in materia di', 'a decorrere', 'entro il termine', 'con decreto',
      'comprende', 'comprendono', 'fanno parte', 'i seguenti', 'le seguenti'
    ];
    if (modalita === 'bilanciata') return forti.concat(medi);

    return forti.concat(medi, [
      'sono previste', 'sono previsti', 'sono disciplinate', 'sono disciplinati',
      'si dispone', 'si stabilisce', 'chiunque', 'ciascuno', 'ciascuna',
      'il soggetto', 'i soggetti', 'la commissione', 'le amministrazioni'
    ]);
  }

  function cambiaArgomento(successiva, regole, paroleCorrenti) {
    const next = successiva.toLocaleLowerCase('it-IT').trim().replace(/^[«“"'(]+/, '');
    if (indicatoriCambio(regole.modalita).some(indicatore => next.startsWith(indicatore))) return true;

    // In modalità estensiva anche un nuovo soggetto normativo è un indizio,
    // ma soltanto dopo un blocco abbastanza consistente per evitare un comma
    // diverso per ogni frase breve.
    return regole.modalita === 'estensiva'
      && paroleCorrenti >= 24
      && /^(?:il|lo|la|i|gli|le|un|una|ciascun|ogni)\s+[a-zà-öø-ÿ'’-]+\s+(?:è|sono|può|possono|deve|devono|provvede|provvedono)\b/i.test(next);
  }

  function blocchiOriginali(testo) {
    const righe = testo.split('\n').map(riga => riga.trim());
    const candidati = [];
    let corrente = [];
    const chiudi = () => {
      const blocco = corrente.join(' ').replace(/\s+/g, ' ').trim();
      if (blocco) candidati.push(blocco);
      corrente = [];
    };

    for (const riga of righe) {
      if (!riga) { chiudi(); continue; }
      corrente.push(riga);
    }
    chiudi();

    // Una riga vuota non implica necessariamente un nuovo comma: nei TXT
    // ottenuti da PDF/Markdown viene spesso inserita anche nel mezzo di una
    // frase («secondo» / «quanto stabilito...»). Si conserva il confine solo
    // quando il blocco precedente è sintatticamente concluso.
    const blocchi = [];
    let elencoAperto = false;
    for (const candidato of candidati) {
      const precedente = blocchi.at(-1);
      const iniziaMinuscolo = /^[a-zà-öø-ÿ]/.test(candidato);
      const voceEtichettata = /^[^.!?;:]{2,90}:\s+/.test(candidato);

      if (precedente && elencoAperto && voceEtichettata) {
        blocchi[blocchi.length - 1] = `${precedente.replace(/[.;]\s*$/, '')}; ${candidato}`;
        continue;
      }
      if (precedente && precedente.endsWith(':') && voceEtichettata) {
        blocchi[blocchi.length - 1] = `${precedente} ${candidato}`;
        elencoAperto = true;
        continue;
      }
      elencoAperto = false;

      if (precedente && (!/[.!?]$/.test(precedente) || iniziaMinuscolo)) {
        blocchi[blocchi.length - 1] = `${precedente} ${candidato}`;
      } else {
        blocchi.push(candidato);
      }
    }

    // Se non esistono righe vuote ma ogni riga è un periodo completo, le righe
    // rappresentano con buona probabilità commi distinti e vengono mantenute.
    const nonVuote = righe.filter(Boolean);
    const righeComplete = nonVuote.filter(riga => /[.!?]$/.test(riga)).length;
    if (candidati.length <= 1 && nonVuote.length >= 2 && righeComplete / nonVuote.length >= 0.75) return nonVuote;
    return blocchi.length ? blocchi : [nonVuote.join(' ')].filter(Boolean);
  }

  function suddividiBlocco(testo, regole) {
    const frasi = dividiFrasi(testo);
    if (!frasi.length) return [];

    const commi = [];
    let corrente = '';
    let nParole = 0;
    const minimoCambio = { conservativa: 32, bilanciata: 20, estensiva: 12 }[regole.modalita] || 20;

    for (const frase of frasi) {
      const n = parole(frase);
      if (!corrente) { corrente = frase; nParole = n; continue; }

      // Il vecchio controllo confrontava soltanto la lunghezza già accumulata:
      // un comma di 119 parole poteva così assorbirne altre 100. Si valuta invece
      // la lunghezza risultante prima di aggiungere la nuova frase.
      const superaLimite = nParole + n > regole.maxParole;
      const cambio = cambiaArgomento(frase, regole, nParole) && nParole >= minimoCambio;

      if (superaLimite || cambio) {
        commi.push(corrente.trim());
        corrente = frase;
        nParole = n;
      } else {
        corrente += ' ' + frase;
        nParole += n;
      }
    }
    if (corrente) commi.push(corrente.trim());
    return commi;
  }

  function suddividiCommi(testo, regole) {
    const righe = testo.split('\n').map(riga => riga.trim());
    const espliciti = righe.filter(Boolean).filter(eCommaEsplicito);

    if (regole.mantieniCommi && espliciti.length >= 1) {
      const commi = [];
      let corrente = '';
      for (const riga of righe) {
        if (!riga) continue;
        const esplicito = estraiCommaEsplicito(riga);
        if (esplicito) {
          if (corrente) commi.push(corrente.trim());
          corrente = esplicito.testo;
        } else {
          corrente += (corrente ? ' ' : '') + riga;
        }
      }
      if (corrente) commi.push(corrente.trim());
      return commi.filter(Boolean);
    }

    const blocchi = blocchiOriginali(testo);
    if (!regole.suddivisioneLogica) return blocchi;
    return blocchi.flatMap(blocco => suddividiBlocco(blocco, regole));
  }

  /* ── Analisi del documento ─────────────────────────────── */

  function analizza(testo) {

    const righe = pulisci(testo)
      .split('\n');

    const sezioni = [];

    let titoli = [];
    let articolo = null;
    let contenuto = [];

    function salva() {
      if (!articolo) return;
      sezioni.push({
        titoli: titoli.map(item => item.testo),
        articolo,
        // Le righe vuote sono significative: delimitano i paragrafi/commi
        // originali e non devono essere eliminate durante l'analisi.
        contenuto: contenuto.join('\n').trim()
      });
      articolo = null;
      contenuto = [];
    }

    for (const riga of righe) {
      if (eTitolo(riga)) {
        salva();
        const livello = livelloTitolo(riga);
        titoli = titoli.filter(item => item.livello < livello);
        titoli.push({ livello, testo: riga });
        continue;
      }

      if (eArticolo(riga)) {
        salva();
        const partiArticolo = separaArticoloEContenuto(riga);
        articolo = partiArticolo.intestazione;
        if (partiArticolo.contenuto) contenuto.push(partiArticolo.contenuto);
        continue;
      }

      // «TITOLO I» seguito da «PRINCIPI GENERALI» e «Art. 1» seguito da
      // «(Oggetto)» sono impaginazioni molto comuni. La seconda riga è una
      // rubrica, non il primo comma dell'articolo.
      if (eSottotitolo(riga)) {
        if (articolo && !contenuto.some(Boolean)) {
          articolo = unisciIntestazione(articolo, riga);
          continue;
        }
        if (!articolo && titoli.length) {
          titoli[titoli.length - 1].testo = unisciIntestazione(titoli[titoli.length - 1].testo, riga);
          continue;
        }
      }

      if (articolo) {
        // Evita sequenze di righe vuote, conservandone comunque una come
        // separatore forte fra due commi del file sorgente.
        if (riga || contenuto.at(-1) !== '') contenuto.push(riga);
      }
    }

    salva();
    return sezioni;
  }

  /* ── Generazione del risultato ─────────────────────────── */

  function genera(sezioni, regole) {

    let html = '';
    let ultimiTitoli = [];
    let primoArticolo = true;

    sezioni.forEach(sezione => {
      const titoli = Array.isArray(sezione.titoli) ? sezione.titoli : [];
      let primoDiverso = 0;
      while (primoDiverso < titoli.length && titoli[primoDiverso] === ultimiTitoli[primoDiverso]) primoDiverso++;
      const nuoviTitoli = titoli.slice(primoDiverso);

      if (nuoviTitoli.length) {
        if (html && regole.separaArticoli) html += '<div class="separatore"></div>';
        nuoviTitoli.forEach(titolo => {
          html += `
                <p class="titolo">
                    ${escapeHTML(titolo)}
                </p>
            `;
        });
        if (regole.separaTitolo) html += '<div class="separatore"></div>';
      }
      ultimiTitoli = titoli;

      if (!primoArticolo && regole.separaArticoli && !nuoviTitoli.length) {
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
          ? romano(i + 1) + '.'
          : String(i + 1) + '.';

        const numeroHTML = `
                <span class="numero-comma">
                    ${escapeHTML(numero)}
                </span>
            `;

        html += `
                <p class="comma">
                    ${numeroHTML}
                    ${formattaTestoComma(testoComma, regole)}
                </p>
            `;
      });
    });

    return html;
  }

  /* ── Elaborazione ──────────────────────────────────────── */

  function elabora() {

    if (!testoOriginale) {
      statusEl.textContent = 'Carica prima un file TXT.';
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
      statusEl.textContent = 'Nessun articolo riconosciuto.';
      return;
    }

    documento.innerHTML = genera(sezioni, regole);

    applicaStili(regole);

    const numeroTitoli = new Set(sezioni.flatMap(sezione => sezione.titoli || [])).size;
    const numeroCommi = documento.querySelectorAll('.comma').length;
    statusEl.textContent = `Elaborazione completata: ${numeroTitoli} titoli, ${sezioni.length} articoli e ${numeroCommi} commi riconosciuti.`;
  }

  /* ── Caricamento file ──────────────────────────────────── */

  $('fileInput').addEventListener('change', function () {

    const file = this.files[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = function (event) {

      testoOriginale = event.target.result;

      elabora();
    };

    reader.readAsText(file, 'UTF-8');
  });

  /* ── Eventi ────────────────────────────────────────────── */

  $('elaboraBtn').addEventListener('click', elabora);

  $('resetBtn').addEventListener('click', function () {

    idsRegole.forEach(id => {
      $(id).checked = true;
    });

    $('separaCommi').checked = false;
    $('modalita').value = 'bilanciata';
    $('maxParole').value = 90;

    elabora();
  });

  $('stampaBtn').addEventListener('click', function () {
    window.print();
  });

  /* ── Esportazione HTML ─────────────────────────────────── */

  function creaDocumentoHTML() {

    const regole = leggiRegole();

    const font = regole.font
      ? '"Raleway", sans-serif'
      : 'Arial, sans-serif';

    const fontSize = regole.dimensione
      ? '12pt'
      : 'initial';

    const weight = regole.stileNormale
      ? '400'
      : 'normal';

    const align = regole.giustificato
      ? 'justify'
      : 'left';

    const lineHeight = regole.interlinea
      ? '1.15'
      : 'normal';

    const margin = regole.spaziatura
      ? '0'
      : 'initial';

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
    font-weight: ${regole.titoliGrassetto ? '700' : '400'};
}
.articolo {
    font-weight: ${regole.articoliGrassetto ? '700' : '400'};
}
.numero-comma {
    font-weight: ${regole.numeriGrassetto ? '700' : '400'};
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

  $('copiaBtn').addEventListener('click', async function () {

    const html = creaDocumentoHTML();

    try {
      await navigator.clipboard.writeText(html);
      statusEl.textContent = 'HTML copiato negli appunti.';
      toolsShowToast('HTML copiato negli appunti.');
    } catch (error) {
      statusEl.textContent =
        'Copia automatica non disponibile. Usa il download HTML.';
    }
  });

  $('scaricaBtn').addEventListener('click', function () {

    const html = creaDocumentoHTML();

    const blob = new Blob(
      [html],
      { type: 'text/html;charset=utf-8' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'documento_formattato.html';

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    statusEl.textContent = 'File HTML generato.';
    toolsShowToast('File HTML generato.');
  });
}

/* ============================================================
   AVVIO
   Dentro index.html si attiva solo la scheda Tools; dentro una
   pagina tool si eseguono prima i controlli di accesso e poi si
   inizializza il tool corrispondente.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  if (isToolPage()) {
    const allowed = await bootstrapToolPage();
    if (!allowed) return;
    initFormattazioneTool();
    return;
  }
  bindToolsListEvents();
});
