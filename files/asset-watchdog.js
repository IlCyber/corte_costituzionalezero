'use strict';

/*
 * Watchdog di avvio (rete di sicurezza del sistema di cache).
 *
 * Viene caricato come normale file statico dopo i due loader PHP. Se per
 * qualunque motivo il loader non riesce a iniettare lo script principale
 * (browser molto vecchio, errore JavaScript, risposta mancante, cache
 * inconsistente), il watchdog lo inserisce con l'indirizzo semplice e, se
 * nemmeno quello arriva, mostra un avviso visibile invece di lasciare la
 * pagina nella schermata di caricamento perpetua.
 *
 * Uso: <script src="asset-watchdog.js" data-entry="app.js" data-boot-flag="czAppBooted"></script>
 * Nelle pagine della cartella tools: <script src="../asset-watchdog.js"
 * data-entry="tools/app_tools.js" data-boot-flag="czToolsBooted"></script>
 * Il percorso di data-entry è relativo alla radice del sito (dove si trova
 * questo file), non alla pagina corrente.
 */
(function () {
  var current = document.currentScript || null;
  var entry = current ? String(current.getAttribute('data-entry') || '') : '';
  var bootFlag = current ? String(current.getAttribute('data-boot-flag') || '') : '';
  if (!entry) return;

  var warnAfterMs = 8000;   // dopo N millisecondi senza avvio si mostra l'avviso
  var giveUpAfterMs = 30000; // dopo N ms si suggerisce di ricaricare
  var startedAt = Date.now();
  var injected = false;
  var banner = null;

  function scriptUrlBase() {
    var base = '';
    try {
      var url = new URL((current && current.src) || '', document.baseURI);
      base = url.pathname.replace(/[^/]*$/, '');
    } catch (error) {
      base = '/';
    }
    return base;
  }

  function entryAlreadyPresent() {
    var target = scriptUrlBase() + entry;
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src');
      if (!src) continue;
      try {
        var resolved = new URL(src, document.baseURI);
        if (resolved.pathname === target || resolved.pathname.slice(-(entry.length + 1)) === '/' + entry) return true;
      } catch (error) {
        if (src.indexOf(entry) !== -1) return true;
      }
    }
    return false;
  }

  function injectEntry() {
    if (injected || entryAlreadyPresent()) return;
    injected = true;
    var script = document.createElement('script');
    script.src = scriptUrlBase() + entry;
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  }

  function showBanner(kind) {
    if (banner) return;
    banner = document.createElement('div');
    banner.setAttribute('role', 'alert');
    banner.style.cssText = 'position:fixed;z-index:99999;bottom:1rem;left:1rem;right:1rem;max-width:32rem;margin:0 auto;padding:.85rem 1rem;border-radius:.5rem;background:#842029;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 .5rem 1rem rgba(0,0,0,.3);display:flex;gap:.75rem;align-items:center;justify-content:space-between;';
    var text = document.createElement('span');
    text.textContent = kind === 'slow'
      ? 'Il caricamento sta richiedendo più tempo del previsto: attendi qualche istante.'
      : 'L’applicazione non si è avviata. Verifica la connessione e riprova.';
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Ricarica';
    button.style.cssText = 'flex:0 0 auto;border:0;border-radius:.4rem;padding:.4rem .8rem;font-weight:600;background:#fff;color:#842029;cursor:pointer;';
    button.addEventListener('click', function () { window.location.reload(); });
    banner.appendChild(text);
    banner.appendChild(button);
    (document.body || document.documentElement).appendChild(banner);
  }

  function booted() {
    try { return bootFlag ? Boolean(window[bootFlag]) : true; } catch (error) { return true; }
  }

  function tick() {
    if (booted()) {
      if (banner) banner.parentNode.removeChild(banner);
      return;
    }
    var elapsed = Date.now() - startedAt;
    if (elapsed >= giveUpAfterMs) {
      injectEntry();
      showBanner('error');
      return; // resta l'avviso con il pulsante Ricarica
    }
    if (elapsed >= warnAfterMs) {
      injectEntry();
      showBanner('slow');
    }
    window.setTimeout(tick, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { window.setTimeout(tick, 1500); });
  } else {
    window.setTimeout(tick, 1500);
  }
}());
