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
 */

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

function cz_asset_cache_public_manifest(string $root): array
{
    $realRoot = realpath($root);
    if ($realRoot === false) {
        return [];
    }

    $realRoot = str_replace('\\', '/', rtrim($realRoot, DIRECTORY_SEPARATOR));
    $allowedExtensions = array_fill_keys([
        'css', 'js', 'mjs', 'html', 'htm', 'json', 'webmanifest',
        'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'txt', 'xml',
        'woff', 'woff2', 'ttf', 'otf', 'eot', 'map'
    ], true);
    $excludedDirectories = array_fill_keys(['private', '.git', 'node_modules', 'vendor'], true);
    $manifest = [];

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

        $hash = @hash_file('sha256', $absolute);
        if (!is_string($hash) || $hash === '') {
            $hash = hash('sha256', $relative . '|' . (string) $file->getMTime() . '|' . (string) $file->getSize());
        }

        $manifest[$relative] = [
            'version' => substr($hash, 0, 16),
            'mtime' => $file->getMTime(),
            'size' => $file->getSize(),
        ];
    }

    ksort($manifest, SORT_NATURAL);
    return $manifest;
}

function cz_asset_cache_manifest_version(array $manifest): string
{
    return substr(hash('sha256', json_encode($manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: ''), 0, 16);
}

function cz_asset_cache_headers(string $contentType = 'application/javascript; charset=utf-8'): void
{
    header('Content-Type: ' . $contentType);
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-Content-Type-Options: nosniff');
    // Non elimina cookie o localStorage: chiede al browser di svuotare solo la
    // cache HTTP dell'origine, così le risorse locali vengono sempre rilette.
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

  const config = __CZ_ASSET_CACHE_CONFIG__;
  const manifest = config.assets || {};
  const manifestVersion = String(config.version || Date.now());
  const storageKey = config.storageKey || 'cz_asset_cache_manifest_v2';
  const reloadParam = config.reloadParam || 'cz_cache_v';
  const currentScript = document.currentScript;
  const rootBaseUrl = new URL(config.rootBase || './', currentScript ? currentScript.src : document.baseURI);

  function normalizePath(path) {
    try { path = decodeURIComponent(String(path || '')); } catch { path = String(path || ''); }
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
  }

  function manifestPathForUrl(value) {
    let url;
    try { url = new URL(value, document.baseURI); } catch { return ''; }
    if (url.origin !== rootBaseUrl.origin) return '';
    const rootPath = rootBaseUrl.pathname.endsWith('/') ? rootBaseUrl.pathname : `${rootBaseUrl.pathname}/`;
    if (!url.pathname.startsWith(rootPath)) return '';
    return normalizePath(url.pathname.slice(rootPath.length));
  }

  function versionedAssetUrl(value) {
    const original = String(value || '');
    if (!original || original.startsWith('#') || /^(?:data|blob|mailto|tel):/i.test(original)) return original;

    let url;
    try { url = new URL(original, document.baseURI); } catch { return original; }

    const assetPath = manifestPathForUrl(url.href);
    const assetVersion = manifest[assetPath];
    if (!assetVersion) return original;

    url.searchParams.set('v', assetVersion);
    url.searchParams.set('appv', manifestVersion);
    return url.href;
  }

  function versionAttribute(selector, attribute) {
    document.querySelectorAll(selector).forEach(element => {
      const value = element.getAttribute(attribute);
      const updated = versionedAssetUrl(value);
      if (updated && updated !== value) element.setAttribute(attribute, updated);
    });
  }

  function applyVersionedUrls() {
    versionAttribute('link[href]', 'href');
    versionAttribute('a[href]', 'href');
    versionAttribute('img[src]', 'src');
    versionAttribute('iframe[src]', 'src');
    versionAttribute('source[src]', 'src');
    versionAttribute('video[poster]', 'poster');
  }

  function clearRuntimeCaches() {
    const jobs = [];

    if ('caches' in window && typeof caches.keys === 'function') {
      jobs.push(
        caches.keys()
          .then(keys => Promise.all(keys.map(key => caches.delete(key))))
          .catch(() => undefined)
      );
    }

    if ('serviceWorker' in navigator && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
      jobs.push(
        navigator.serviceWorker.getRegistrations()
          .then(registrations => Promise.all(registrations.map(registration => registration.update().catch(() => undefined))))
          .catch(() => undefined)
      );
    }

    if (!jobs.length) return Promise.resolve();
    return Promise.allSettled(jobs).then(() => undefined);
  }

  function storeCurrentManifest() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: manifestVersion, assets: manifest, savedAt: Date.now() }));
    } catch { /* localStorage può essere disabilitato: il parametro URL evita comunque loop. */ }
  }

  function reloadWithFreshHtml() {
    let destination;
    try {
      destination = new URL(window.location.href);
      destination.searchParams.set(reloadParam, manifestVersion);
    } catch {
      window.location.reload();
      return;
    }

    let reloaded = false;
    const go = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.replace(destination.href);
    };

    Promise.race([
      clearRuntimeCaches(),
      new Promise(resolve => setTimeout(resolve, 900))
    ]).finally(go);
  }

  function currentDocumentManifestPath() {
    const path = manifestPathForUrl(window.location.href);
    if (path) return path;

    try {
      const url = new URL(window.location.href);
      const rootPath = rootBaseUrl.pathname.endsWith('/') ? rootBaseUrl.pathname : `${rootBaseUrl.pathname}/`;
      if (url.origin === rootBaseUrl.origin && url.pathname === rootPath && manifest['index.html']) return 'index.html';
    } catch { /* ignora URL non standard. */ }

    return '';
  }

  function currentDocumentIsFresh(currentUrl) {
    const documentPath = currentDocumentManifestPath();
    const documentVersion = documentPath ? manifest[documentPath] : '';
    if (!documentVersion) return true;

    return currentUrl.searchParams.get(reloadParam) === manifestVersion
      || (currentUrl.searchParams.get('v') === documentVersion && currentUrl.searchParams.get('appv') === manifestVersion);
  }

  function writeEntryScript() {
    if (!config.entrySrc) return;
    const entryUrl = new URL(config.entrySrc, currentScript ? currentScript.src : document.baseURI).href;
    const src = versionedAssetUrl(entryUrl);
    const escapedSrc = String(src).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    if (document.readyState === 'loading') {
      document.write('<script src="' + escapedSrc + '"><\/script>');
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.head.appendChild(script);
  }

  const currentUrl = new URL(window.location.href);
  const documentIsFresh = currentDocumentIsFresh(currentUrl);

  window.czAssetManifest = manifest;
  window.czAssetManifestVersion = manifestVersion;
  window.czVersionedAssetUrl = versionedAssetUrl;
  window.czRefreshAssetUrls = applyVersionedUrls;

  storeCurrentManifest();
  applyVersionedUrls();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersionedUrls, { once: true });
  }

  if (!documentIsFresh) {
    reloadWithFreshHtml();
    return;
  }

  clearRuntimeCaches();
  writeEntryScript();
}());
JS
    );
}
