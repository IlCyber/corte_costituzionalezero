<?php
declare(strict_types=1);

// Controparte di app-loader.php per il JavaScript dedicato ai tool: anche qui
// l'endpoint viene sempre riconvalidato e rimanda al file con una versione
// ricavata automaticamente dalla sua data di modifica. Quando app_tools.js
// cambia, cambia anche l'URL e il browser non può riusare la vecchia cache.
$asset = __DIR__ . '/app_tools.js';
$version = is_file($asset) ? (string) filemtime($asset) : (string) time();

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
header('Location: app_tools.js?v=' . rawurlencode($version), true, 302);
exit;
