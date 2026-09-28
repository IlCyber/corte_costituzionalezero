<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/private/asset_cache.php';

$root = dirname(__DIR__);

// Manutenzione: app-tools-loader.php?flush=1 svuota la cache del browser e
// riporta alla pagina del formattatore (voce di default dei tools).
if (isset($_GET['flush'])) {
    $manifest = cz_asset_cache_manifest($root, true);
    cz_asset_cache_flush_headers();
    echo cz_asset_cache_flush_script([
        'storageKey' => 'cz_asset_cache_manifest_v2',
        'flushEntry' => 'tools/formattazione.html',
    ]);
    exit;
}

// Anche il loader dei tools partecipa allo stesso sistema di cache-busting del
// loader principale: quando cambia qualunque asset pubblico (CSS, JS o HTML),
// gli script ricevono l'hash del contenuto corrente e la pagina al massimo si
// ricarica una volta per versione (guardia in sessionStorage).
$manifest = cz_asset_cache_manifest($root, isset($_GET['refresh']));
$manifestVersion = cz_asset_cache_manifest_version($manifest);

cz_asset_cache_headers();

echo cz_asset_cache_loader_script([
    'assets' => cz_asset_cache_versions($manifest),
    'version' => $manifestVersion,
    'storageKey' => 'cz_asset_cache_manifest_v2',
    'reloadParam' => 'cz_cache_v',
    'rootBase' => '../',
    'entrySrc' => 'app_tools.js',
]);
exit;
