<?php
declare(strict_types=1);

require_once __DIR__ . '/private/asset_cache.php';

$manifest = cz_asset_cache_public_manifest(__DIR__);
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
