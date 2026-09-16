<?php
declare(strict_types=1);

// Questo endpoint viene sempre riconvalidato e rimanda al file JavaScript con
// una versione ricavata automaticamente dalla sua data di modifica. Quando
// app.js cambia, cambia anche l'URL e il browser non può riusare la vecchia cache.
$asset = __DIR__ . '/app.js';
$version = is_file($asset) ? (string) filemtime($asset) : (string) time();

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
header('Location: app.js?v=' . rawurlencode($version), true, 302);
exit;
