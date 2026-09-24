<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/private/asset_cache.php';

$root = dirname(__DIR__);
$manifest = cz_asset_cache_public_manifest($root);
$manifestVersion = cz_asset_cache_manifest_version($manifest);

// Anche il loader dei tools partecipa allo stesso sistema di cache-busting del
// loader principale: quando cambia qualunque asset pubblico (CSS, JS o HTML),
// la pagina viene ricaricata con una versione nuova e app_tools.js viene servito
// con l'hash del contenuto corrente.
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
