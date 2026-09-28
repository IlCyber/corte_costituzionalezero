<?php
declare(strict_types=1);

/**
 * Utility condivise dai loader pubblici degli asset.
 *
 * Lo scopo è evitare che browser, proxy o eventuali Cache Storage conservino
 * vecchie copie di CSS, JavaScript e pagine HTML: ogni risorsa pubblica riceve
 * una versione calcolata dal contenuto del file e i loader, che non vengono mai
 * memorizzati in cache, possono forzare il refresh dell'intera interfaccia
 * quando cambia anche un solo asset.
 *
 * Ottimizzazioni (velocità):
 * - Il manifest non viene ricalcolato da zero a ogni richiesta: si conserva su
 *   file (private/asset-manifest.cache.json) insieme a una "firma" ottenuta
 *   soltanto da dimensione e mtime dei file. Se la firma non cambia si riusa il
 *   manifest precedente; se cambia si ricalcolano gli hash soltanto dei file
 *   realmente modificati. Il costo normale di una richiesta è quindi una
 *   lettura di directory, non la lettura e l'hashing di tutti i file.
 * - `Clear-Site-Data` NON viene più inviato a ogni risposta (svuotava la cache
 *   dell'intera origine a ogni pagina, azzerando ogni beneficio). È riservato
 *   all'endpoint di manutenzione app-loader.php?flush=1.
 */

/**
 * Secondi per cui un manifest in cache viene considerato valido senza nemmeno
 * rileggere le directory. Le tre richieste di loader della stessa pagina
 * (CSS + loader principale + loader tools) diventano così praticamente gratis.
 */
function cz_asset_cache_micro_ttl(): int
{
    $value = defined('CZ_ASSET_CACHE_TTL') ? (int) constant('CZ_ASSET_CACHE_TTL') : 3;
    return $value >= 0 ? $value : 3;
}

function cz_asset_cache_normalize_public_path(string $path): string
{
    $path = str_replace('\\', '/', trim($path));
    $path = preg_replace('#/+#', '/', $path) ?? $path;
    $parts = [];

    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') {
            continue;
        }
        if ($part === '..') {
            return '';
        }
        $parts[] = $part;
    }

    return implode('/', $parts);
}

/**
 * Percorso del file di cache del manifest (dentro private/, mai pubblico).
 */
function cz_asset_cache_store_path(string $root): string
{
    $realRoot = realpath($root);
    $base = $realRoot !== false ? $realRoot : rtrim($root, '/\\');
    return $base . '/private/asset-manifest.cache.json';
}

/**
 * Legge la struttura dei file pubblici (solo stat: percorso, mtime, dimensione)
 * e restituisce la firma complessiva più l'elenco dei file.
 *
 * @return array{signature:string, files:array<string, array{mtime:int, size:int}>}
 */
function cz_asset_cache_scan(string $realRoot): array
{
    // Le stat di PHP sono cached per richiesta: azzerandole si evita di
    // confrontare firme basate su dati letti prima di una modifica.
    clearstatcache();
    $realRoot = str_replace('\\', '/', rtrim($realRoot, DIRECTORY_SEPARATOR));
    $allowedExtensions = array_fill_keys([
        'css', 'js', 'mjs', 'html', 'htm', 'json', 'webmanifest',
        'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'txt', 'xml',
        'woff', 'woff2', 'ttf', 'otf', 'eot', 'map'
    ], true);
    $excludedDirectories = array_fill_keys(['private', '.git', 'node_modules', 'vendor'], true);
    $files = [];

    $directory = new RecursiveDirectoryIterator($realRoot, FilesystemIterator::SKIP_DOTS);
    $filter = new RecursiveCallbackFilterIterator(
        $directory,
        static function (SplFileInfo $current) use ($allowedExtensions, $excludedDirectories): bool {
            $name = $current->getFilename();
            if ($current->isDir()) {
                return !isset($excludedDirectories[$name]) && ($name === '' || $name[0] !== '.');
            }
            if (!$current->isFile()) {
                return false;
            }
            $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
            return isset($allowedExtensions[$extension]);
        }
    );

    foreach (new RecursiveIteratorIterator($filter) as $file) {
        /** @var SplFileInfo $file */
        $absolute = str_replace('\\', '/', $file->getPathname());
        $relative = cz_asset_cache_normalize_public_path(substr($absolute, strlen($realRoot) + 1));
        if ($relative === '') {
            continue;
        }
        $files[$relative] = ['mtime' => (int) $file->getMTime(), 'size' => (int) $file->getSize()];
    }

    ksort($files, SORT_NATURAL);
    $signature = hash('sha256', json_encode($files, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '');
    return ['signature' => $signature, 'files' => $files];
}

/**
 * Manifest pubblico: percorso => [version (hash contenuto), mtime, size].
 *
 * Con cache su file: se la firma delle stat non cambia si restituisce il
 * manifest già calcolato; altrimenti si aggiornano soltanto i file cambiati.
 */
function cz_asset_cache_manifest(string $root, bool $forceRefresh = false): array
{
    static $memo = [];
    $realRoot = realpath($root);
    if ($realRoot === false) {
        return [];
    }
    $cacheKey = $realRoot . ($forceRefresh ? '|refresh' : '');
    if (isset($memo[$cacheKey])) {
        return $memo[$cacheKey];
    }

    $storePath = cz_asset_cache_store_path($root);

    // Livello 1 (opzionale, se APCu è disponibile): memoria condivisa.
    $apcuKey = 'cz_asset_manifest_v3:' . $realRoot;
    if (!$forceRefresh && function_exists('apcu_enabled') && apcu_enabled()) {
        $cached = apcu_fetch($apcuKey);
        if (is_array($cached) && isset($cached['assets'], $cached['signature'])) {
            return $memo[$cacheKey] = $cached['assets'];
        }
    }

    // Livello 2: cache su file con micro-TTL (copre le richieste ravvicinate
    // della stessa pagina: redirect CSS + loader principale + loader tools).
    $stored = null;
    if (!$forceRefresh && is_file($storePath) && cz_asset_cache_micro_ttl() > 0) {
        $age = time() - (int) filemtime($storePath);
        if ($age >= 0 && $age < cz_asset_cache_micro_ttl()) {
            $stored = json_decode((string) @file_get_contents($storePath), true);
            if (!is_array($stored) || !isset($stored['signature'], $stored['assets'])) {
                $stored = null;
            }
        }
    }

    // Livello 3: confronto della firma delle stat (nessun hashing dei contenuti
    // finché nessun file cambia).
    $scan = cz_asset_cache_scan($realRoot);
    if ($stored === null && !$forceRefresh) {
        if (is_file($storePath)) {
            $stored = json_decode((string) @file_get_contents($storePath), true);
            if (!is_array($stored) || !isset($stored['signature'], $stored['assets'])) {
                $stored = null;
            }
        }
    }
    if ($stored !== null && hash_equals((string) $stored['signature'], $scan['signature'])) {
        $assets = is_array($stored['assets']) ? $stored['assets'] : [];
        if (function_exists('apcu_enabled') && apcu_enabled()) {
            apcu_store($apcuKey, ['signature' => $scan['signature'], 'assets' => $assets], max(30, cz_asset_cache_micro_ttl() * 2));
        }
        return $memo[$cacheKey] = $assets;
    }

    // Ricalcolo: si riusano gli hash dei file rimasti identici (mtime+size).
    $previous = is_array($stored['assets'] ?? null) ? $stored['assets'] : [];
    $assets = [];
    foreach ($scan['files'] as $relative => $stat) {
        $old = is_array($previous[$relative] ?? null) ? $previous[$relative] : null;
        if ($old !== null
            && (int) ($old['mtime'] ?? -1) === $stat['mtime']
            && (int) ($old['size'] ?? -1) === $stat['size']
            && is_string($old['version'] ?? null)
            && $old['version'] !== '') {
            $version = (string) $old['version'];
        } else {
            $hash = @hash_file('sha256', $realRoot . '/' . $relative);
            $version = is_string($hash) && $hash !== ''
                ? substr($hash, 0, 16)
                : substr(hash('sha256', $relative . '|' . (string) $stat['mtime'] . '|' . (string) $stat['size']), 0, 16);
        }
        $assets[$relative] = [
            'version' => $version,
            'mtime' => $stat['mtime'],
            'size' => $stat['size'],
        ];
    }
    ksort($assets, SORT_NATURAL);

    // Scrittura atomica (tmp + rename): richieste parallele non si corrompono.
    $payload = json_encode(['signature' => $scan['signature'], 'assets' => $assets], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (is_string($payload)) {
        $temporary = $storePath . '.' . getmypid() . '.tmp';
        if (@file_put_contents($temporary, $payload, LOCK_EX) !== false) {
            if (!@rename($temporary, $storePath)) {
                @unlink($temporary);
            }
        }
    }
    if (function_exists('apcu_enabled') && apcu_enabled()) {
        apcu_store($apcuKey, ['signature' => $scan['signature'], 'assets' => $assets], max(30, cz_asset_cache_micro_ttl() * 2));
    }

    return $memo[$cacheKey] = $assets;
}

/**
 * Compatibilità con le versioni precedenti del loader.
 */
function cz_asset_cache_public_manifest(string $root): array
{
    return cz_asset_cache_manifest($root);
}

function cz_asset_cache_manifest_version(array $manifest): string
{
    return substr(hash('sha256', json_encode($manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: ''), 0, 16);
}

function cz_asset_cache_headers(string $contentType = 'application/javascript; charset=utf-8'): void
{
    header('Content-Type: ' . $contentType);
    // I loader devono sempre essere letti freschi: sono piccoli e cambiano la
    // versione degli asset. NOTA: niente Clear-Site-Data qui: svuotare la cache
    // dell'origine a ogni risposta annullava ogni cache e rallentava il sito.
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-Content-Type-Options: nosniff');
}

/**
 * Header dell'endpoint di manutenzione ?flush=1: qui, e solo qui, si chiede al
 * browser di svuotare la cache HTTP dell'origine (cookie e storage restano).
 */
function cz_asset_cache_flush_headers(string $contentType = 'application/javascript; charset=utf-8'): void
{
    cz_asset_cache_headers($contentType);
    header('Clear-Site-Data: "cache"');
}

function cz_asset_cache_versions(array $manifest): array
{
    $versions = [];
    foreach ($manifest as $path => $asset) {
        $versions[$path] = (string) $asset['version'];
    }
    return $versions;
}

function cz_asset_cache_redirect(string $asset, array $manifest, string $manifestVersion): void
{
    $asset = cz_asset_cache_normalize_public_path($asset);
    if ($asset === '' || !isset($manifest[$asset])) {
        http_response_code(404);
        cz_asset_cache_headers('text/plain; charset=utf-8');
        echo 'Asset non trovato.';
        return;
    }

    $separator = strpos($asset, '?') !== false ? '&' : '?';
    $location = $asset
        . $separator . 'v=' . rawurlencode((string) $manifest[$asset]['version'])
        . '&appv=' . rawurlencode($manifestVersion);

    cz_asset_cache_headers('text/plain; charset=utf-8');
    header('Location: ' . $location, true, 302);
}

function cz_asset_cache_loader_script(array $config): string
{
    $jsonOptions = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
    $payload = json_encode($config, $jsonOptions);
    if (!is_string($payload)) {
        $payload = '{}';
    }

    return str_replace('__CZ_ASSET_CACHE_CONFIG__', $payload, <<<'JS'
(function () {
  'use strict';

  // Nota sulla compatibilità: questo script gira su browser mobili anche datati
  // (WebView Android, iOS vecchi). Non si usano Promise.allSettled, finally,
  // async/await, document.write o altre API che sui WebView vecchi lanciano
  // eccezioni e lascerebbero la pagina in caricamento perpetuo.

  var config = __CZ_ASSET_CACHE_CONFIG__;
  var manifest = config.assets || {};
  var manifestVersion = String(config.version || Date.now());
  var storageKey = config.storageKey || 'cz_asset_cache_manifest_v2';
  var reloadParam = config.reloadParam || 'cz_cache_v';
  var reloadGuardKey = storageKey + '_reload_guard';
  var entrySrc = config.entrySrc || '';
  var currentScript = document.currentScript || null;
  var scriptBaseUrl = (currentScript && currentScript.src) ? currentScript.src : document.baseURI;

  function normalizePath(path) {
    try { path = decodeURIComponent(String(path || '')); } catch (error) { path = String(path || ''); }
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
  }

  var rootBaseUrl;
  try { rootBaseUrl = new URL(config.rootBase || './', scriptBaseUrl); } catch (error) { rootBaseUrl = null; }

  function manifestPathForUrl(value) {
    if (!rootBaseUrl) return '';
    var url;
    try { url = new URL(value, document.baseURI); } catch (error) { return ''; }
    if (url.origin !== rootBaseUrl.origin) return '';
    var rootPath = rootBaseUrl.pathname.endsWith('/') ? rootBaseUrl.pathname : rootBaseUrl.pathname + '/';
    if (url.pathname.indexOf(rootPath) !== 0) return '';
    return normalizePath(url.pathname.slice(rootPath.length));
  }

  function versionedAssetUrl(value) {
    var original = String(value || '');
    if (!original || original.charAt(0) === '#') return original;
    if (/^(?:data|blob|mailto|tel|javascript):/i.test(original)) return original;

    var url;
    try { url = new URL(original, document.baseURI); } catch (error) { return original; }

    var assetPath = manifestPathForUrl(url.href);
    var assetVersion = assetPath ? manifest[assetPath] : '';
    if (!assetVersion) return original;

    try {
      url.searchParams.set('v', assetVersion);
      url.searchParams.set('appv', manifestVersion);
      return url.href;
    } catch (error) { return original; }
  }

  function versionAttribute(selector, attribute) {
    var elements;
    try { elements = document.querySelectorAll(selector); } catch (error) { return; }
    for (var i = 0; i < elements.length; i++) {
      var value = elements[i].getAttribute(attribute);
      if (!value) continue;
      var updated = versionedAssetUrl(value);
      if (updated && updated !== value) {
        try { elements[i].setAttribute(attribute, updated); } catch (error) { /* ignora */ }
      }
    }
  }

  function applyVersionedUrls() {
    versionAttribute('link[href]', 'href');
    versionAttribute('a[href]', 'href');
    versionAttribute('img[src]', 'src');
    versionAttribute('iframe[src]', 'src');
    versionAttribute('source[src]', 'src');
    versionAttribute('video[poster]', 'poster');
  }

  function readStoredVersion() {
    try {
      var raw = localStorage.getItem(storageKey);
      if (!raw) return '';
      var parsed = JSON.parse(raw);
      return parsed && parsed.version ? String(parsed.version) : '';
    } catch (error) { return ''; }
  }

  function storeCurrentManifest() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: manifestVersion, assets: manifest, savedAt: Date.now() }));
    } catch (error) { /* localStorage può essere disabilitato: la prosecuzione resta valida. */ }
  }

  // Svuota Cache Storage e aggiorna eventuali service worker. Viene eseguita
  // SOLO quando la versione cambia rispetto all'ultima visita (una volta per
  // aggiornamento), mai a ogni caricamento: prima azzerava la cache del sito a
  // ogni pagina. Fire-and-forget: non blocca mai il caricamento.
  function clearRuntimeCaches() {
    try {
      if (window.caches && typeof window.caches.keys === 'function') {
        window.caches.keys().then(function (keys) {
          for (var i = 0; i < keys.length; i++) window.caches.delete(keys[i]);
        }).catch(function () {});
      }
    } catch (error) { /* ignora */ }
    try {
      if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
          for (var i = 0; i < registrations.length; i++) registrations[i].update().catch(function () {});
        }).catch(function () {});
      }
    } catch (error) { /* ignora */ }
  }

  function currentDocumentManifestPath() {
    var path = manifestPathForUrl(window.location.href);
    if (path) return path;

    try {
      var url = new URL(window.location.href);
      if (rootBaseUrl && url.origin === rootBaseUrl.origin) {
        var rootPath = rootBaseUrl.pathname.endsWith('/') ? rootBaseUrl.pathname : rootBaseUrl.pathname + '/';
        if (url.pathname === rootPath && manifest['index.html']) return 'index.html';
      }
    } catch (error) { /* ignora URL non standard. */ }

    return '';
  }

  function currentDocumentIsFresh() {
    var documentPath = currentDocumentManifestPath();
    var documentVersion = documentPath ? manifest[documentPath] : '';
    if (!documentVersion) return true;

    var currentUrl;
    try { currentUrl = new URL(window.location.href); } catch (error) { return true; }
    try {
      if (currentUrl.searchParams.get(reloadParam) === manifestVersion) return true;
      return currentUrl.searchParams.get('v') === documentVersion && currentUrl.searchParams.get('appv') === manifestVersion;
    } catch (error) { return true; }
  }

  // Al massimo UN ricaricamento per versione del manifest, registrato in
  // sessionStorage: se il parametro venisse perso (redirect strani, browser
  // che ripristinano la scheda) non si entra mai in un ciclo infinito. Se
  // sessionStorage non è disponibile non si ricarica affatto: si prosegue con
  // gli asset versionati, che comunque sono sempre freschi.
  function reloadOnceForFreshness() {
    var guard = '';
    var sessionStorageOk = true;
    try { guard = sessionStorage.getItem(reloadGuardKey) || ''; } catch (error) { sessionStorageOk = false; }
    if (!sessionStorageOk) return false;
    if (guard === manifestVersion) return false;
    try { sessionStorage.setItem(reloadGuardKey, manifestVersion); } catch (error) { return false; }

    try {
      var destination = new URL(window.location.href);
      destination.searchParams.set(reloadParam, manifestVersion);
      window.location.replace(destination.href);
    } catch (error) {
      try { window.location.reload(); } catch (ignored) { return false; }
    }
    return true;
  }

  function writeEntryScript() {
    if (!entrySrc) return;
    var src = entrySrc;
    try { src = versionedAssetUrl(new URL(entrySrc, scriptBaseUrl).href); } catch (error) { src = entrySrc; }

    var script = document.createElement('script');
    script.src = src;
    script.async = false;
    var retried = false;
    script.onerror = function () {
      // L'URL versionato non è raggiungibile (deploy a metà, cache incoerente):
      // un solo tentativo con l'URL semplice, poi interviene il watchdog.
      if (retried) return;
      retried = true;
      var fallback = document.createElement('script');
      fallback.src = entrySrc;
      fallback.async = false;
      (document.head || document.documentElement).appendChild(fallback);
    };
    (document.head || document.documentElement).appendChild(script);
  }

  var storedVersion = readStoredVersion();
  var versionChanged = storedVersion !== '' && storedVersion !== manifestVersion;

  try {
    window.czAssetManifest = manifest;
    window.czAssetManifestVersion = manifestVersion;
    window.czVersionedAssetUrl = versionedAssetUrl;
    window.czRefreshAssetUrls = applyVersionedUrls;
    window.czAssetLoaderReady = true;
  } catch (error) { /* ignora */ }

  storeCurrentManifest();
  applyVersionedUrls();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersionedUrls);
  }

  if (versionChanged) clearRuntimeCaches();

  if (!currentDocumentIsFresh()) {
    if (reloadOnceForFreshness()) return;
    // Guardia già scattata: si prosegue senza ricaricare, con gli asset freschi.
  }

  writeEntryScript();
}());
JS
    );
}

/**
 * Script dell'endpoint di manutenzione ?flush=1: svuota la copia locale del
 * manifest e ricarica la pagina, così il browser riparte da zero.
 */
function cz_asset_cache_flush_script(array $config): string
{
    $jsonOptions = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
    $payload = json_encode(['storageKey' => $config['storageKey'] ?? 'cz_asset_cache_manifest_v2'], $jsonOptions);
    if (!is_string($payload)) {
        $payload = '{}';
    }

    return str_replace('__CZ_ASSET_CACHE_CONFIG__', $payload, <<<'JS'
(function () {
  'use strict';
  var config = __CZ_ASSET_CACHE_CONFIG__;
  try { localStorage.removeItem(config.storageKey || 'cz_asset_cache_manifest_v2'); } catch (error) {}
  try { sessionStorage.removeItem((config.storageKey || 'cz_asset_cache_manifest_v2') + '_reload_guard'); } catch (error) {}
  window.location.replace(window.location.pathname.replace(/[^/]*$/, '') + (config.entry || 'index.html'));
}());
JS
    );
}
