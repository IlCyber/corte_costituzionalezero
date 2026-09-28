<?php
declare(strict_types=1);

require_once __DIR__ . '/private/asset_cache.php';

// Manutenzione: app-loader.php?flush=1 svuota la cache del browser per questa
// origine (Clear-Site-Data), dimentica il manifest locale e ricarica l'app.
// Da usare a mano quando qualcosa resta bloccato su una versione vecchia.
if (isset($_GET['flush'])) {
    $manifest = cz_asset_cache_manifest(__DIR__, true);
    cz_asset_cache_flush_headers();
    echo cz_asset_cache_flush_script([
        'storageKey' => 'cz_asset_cache_manifest_v2',
        'flushEntry' => 'index.html',
    ]);
    exit;
}

// refresh=1 ignora la cache del manifest (dopo un upload di file nuovi).
$forceRefresh = isset($_GET['refresh']);
$manifest = cz_asset_cache_manifest(__DIR__, $forceRefresh);
$manifestVersion = cz_asset_cache_manifest_version($manifest);

// Modalità redirect generica: app-loader.php?asset=styles.css rimanda sempre
// alla risorsa locale con una versione basata sul contenuto del file. Può essere
// usata per CSS, pagine HTML, immagini o altri asset pubblici presenti nel
// manifest, senza esporre la cartella private/.
if (isset($_GET['asset'])) {
    cz_asset_cache_redirect((string) $_GET['asset'], $manifest, $manifestVersion);
    exit;
}

cz_asset_cache_headers();

echo cz_asset_cache_loader_script([
    'assets' => cz_asset_cache_versions($manifest),
    'version' => $manifestVersion,
    'storageKey' => 'cz_asset_cache_manifest_v2',
    'reloadParam' => 'cz_cache_v',
    'rootBase' => './',
    'entrySrc' => 'app.js',
]);
exit;
