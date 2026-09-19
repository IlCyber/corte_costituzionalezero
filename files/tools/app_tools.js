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
    return testo
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .split('\n')
      .map(r => r.trim())
      .join('\n')
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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
    return testo
      .replace(/\s+/g, ' ')
      .match(/[^.!?]+(?:[.!?]+|$)/g)
      ?.map(f => f.trim())
      .filter(Boolean) || [];
  }

  function indicatoriCambio(modalita) {

    const base = [
      'inoltre',
      'altresì',
      'tuttavia',
      'peraltro',
      'in ogni caso',
      'resta fermo',
      'spetta',
      'compete',
      'è istituito',
      'sono istituiti',
      'si applica',
      'si applicano',
      'è vietato',
      'sono vietati',
      'è consentito',
      'sono consentiti',
      'è riconosciuto',
      'sono riconosciuti',
      'è garantito',
      'sono garantiti'
    ];

    if (modalita === 'conservativa') {
      return base;
    }

    if (modalita === 'bilanciata') {
      return base.concat([
        'la presente legge',
        'il presente regolamento',
        "l'autorità",
        'le autorità',
        'il governo',
        'il parlamento',
        'il presidente',
        'la regione',
        'le regioni',
        'i comuni',
        'gli enti',
        'ai fini',
        "nell'ambito",
        'in materia di'
      ]);
    }

    return base.concat([
      'la presente legge',
      'il presente regolamento',
      "l'autorità",
      'le autorità',
      'il governo',
      'il parlamento',
      'il presidente',
      'la regione',
      'le regioni',
      'i comuni',
      'gli enti',
      'ai fini',
      "nell'ambito",
      'in materia di',
      'è fatto obbligo',
      'è fatto divieto',
      'sono previste',
      'sono previsti',
      'sono disciplinate',
      'sono disciplinati',
      'si dispone',
      'si stabilisce'
    ]);
  }

  function cambiaArgomento(precedente, successiva, regole) {

    const next = successiva.toLowerCase().trim();

    return indicatoriCambio(regole.modalita)
      .some(indicatore => next.startsWith(indicatore));
  }

  function suddividiCommi(testo, regole) {

    const righe = testo
      .split('\n')
      .map(r => r.trim())
      .filter(Boolean);

    if (
      regole.mantieniCommi &&
      righe.filter(eCommaEsplicito).length >= 2
    ) {

      const commi = [];
      let corrente = '';

      for (const riga of righe) {

        if (eCommaEsplicito(riga)) {

          if (corrente) {
            commi.push(corrente.trim());
          }

          corrente = riga.replace(
            /^\s*(?:[IVXLCDM]+\.|\d+\.)\s+/,
            ''
          );

        } else {
          corrente += ' ' + riga;
        }
      }

      if (corrente) {
        commi.push(corrente.trim());
      }

      return commi;
    }

    if (!regole.suddivisioneLogica) {
      return [righe.join(' ').trim()].filter(Boolean);
    }

    const frasi = dividiFrasi(testo);

    if (!frasi.length) {
      return [];
    }

    const commi = [];
    let corrente = '';
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
        regole.modalita !== 'conservativa'
      ) {

        commi.push(corrente.trim());
        corrente = frase;
        nParole = n;

      } else {

        corrente += ' ' + frase;
        nParole += n;
      }
    }

    if (corrente) {
      commi.push(corrente.trim());
    }

    return commi;
  }

  /* ── Analisi del documento ─────────────────────────────── */

  function analizza(testo) {

    const righe = pulisci(testo)
      .split('\n');

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
        contenuto: contenuto.join('\n')
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

  /* ── Generazione del risultato ─────────────────────────── */

  function genera(sezioni, regole) {

    let html = '';
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
                    ${escapeHTML(testoComma)}
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

    statusEl.textContent =
      'Elaborazione completata: ' +
      sezioni.length +
      ' articoli riconosciuti.';
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
    $('modalita').value = 'conservativa';
    $('maxParole').value = 120;

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
