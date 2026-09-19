'use strict';

/*
 * Sezione "Tools" del casellario.
 *
 * Questo file è volutamente separato da app.js: contiene solo la logica della
 * scheda Tools. Viene caricato da tools/app-tools-loader.php, che aggiunge
 * automaticamente una versione basata sulla data di modifica del file: a ogni
 * modifica cambia l'URL e il browser scarica la copia nuova senza dover mai
 * svuotare la cache a mano (stesso meccanismo usato per app.js).
 *
 * Per aggiungere un nuovo tool: crea la pagina HTML nella cartella tools e
 * aggiungi una riga all'elenco TOOLS_CATALOG qui sotto.
 */

// Una voce per ogni file HTML presente nella cartella tools.
const TOOLS_CATALOG = [
  { id: 'formattazione', name: 'Formattatore normativo TXT', description: 'Converte un file TXT in un documento normativo formattato (titoli, articoli e commi).', file: 'tools/formattazione.html' },
];

// Percorsi consentiti: solo pagine HTML dentro la cartella tools, senza
// attraversamenti di directory o URL esterni.
function normalizeToolPath(value) {
  const path = String(value || '');
  return /^tools\/[a-zA-Z0-9_-]+\.html$/.test(path) ? path : '';
}

function openTool(id) {
  // Stessi controlli delle altre sezioni: capacità dedicata e sessione attiva.
  if (typeof capable === 'function' && !capable('tools.open')) { showToast('Non hai il permesso di aprire i tools.'); return; }
  if (localStorage.getItem('cz_session') !== 'active') { showToast('Sessione non attiva. Effettua nuovamente il login.'); return; }
  const tool = TOOLS_CATALOG.find(item => item.id === id);
  const url = normalizeToolPath(tool?.file);
  if (!url) { showToast('Tool non valido.'); return; }
  window.location.href = url;
}

function renderTools() {
  const body = document.getElementById('toolsTableBody');
  if (!body) return;
  const query = typeof archiveSearchValue === 'function' ? archiveSearchValue('toolSearch') : '';
  const canView = typeof capable !== 'function' || capable('tools.view');
  const tools = canView ? TOOLS_CATALOG.filter(item => matchesArchiveSearch([item.name, item.description, item.file], query)) : [];
  body.innerHTML = tools.map(item => `<tr class="document-row" data-open-tool="${escapeHtml(item.id)}" tabindex="0" role="link"><td class="ps-4 fw-semibold">${escapeHtml(item.name)}</td><td><span class="text-secondary">${escapeHtml(item.description)}</span></td><td class="text-end pe-4"><div class="d-flex justify-content-end gap-2"><button type="button" class="btn btn-sm btn-primary" data-open-tool-button="${escapeHtml(item.id)}">Apri tool</button></div></td></tr>`).join('');
  document.getElementById('emptyTools')?.classList.toggle('d-none', tools.length > 0);
}

// Esposto ad app.js, che lo invoca quando la vista "tools" diventa attiva.
window.renderTools = renderTools;

document.addEventListener('DOMContentLoaded', () => {
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
});
