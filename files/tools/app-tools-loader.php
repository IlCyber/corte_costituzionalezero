<?php
declare(strict_types=1);

// Stesso meccanismo di files/app-loader.php: l'endpoint viene sempre
// riconvalidato e rimanda ad app_tools.js con una versione ricavata dalla data
// di modifica del file. Quando app_tools.js cambia, cambia anche l'URL e il
// browser non può riusare la vecchia cache: non serve mai svuotarla a mano.
$asset = __DIR__ . '/app_tools.js';
$version = is_file($asset) ? (string) filemtime($asset) : (string) time();

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
header('Location: app_tools.js?v=' . rawurlencode($version), true, 302);
exit;
