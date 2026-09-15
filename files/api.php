<?php
declare(strict_types=1);

/*
 * Il backend risponde sempre in JSON: anche un errore fatale (costante mancante
 * in private/config.php, parse error, timeout PHP, memoria esaurita) deve
 * arrivare al browser come errore JSON leggibile. Senza questa rete di
 * sicurezza il frontend riceve HTML o un corpo vuoto e può solo segnalare un
 * generico "backend non raggiungibile", nascondendo la causa reale.
 */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
$GLOBALS['cz_fatal_error'] = null;
set_error_handler(static function (int $type, string $message): bool {
    // I fatale vanno ricordati appena si presentano: un semplice warning emesso
    // dopo di loro non deve poterli sovrascrivere in error_get_last() prima
    // che lo shutdown li riporti al browser in forma di JSON.
    if (in_array($type, [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) $GLOBALS['cz_fatal_error'] = $message;
    return false; // la gestione standard dell'errore prosegue invariata
});
set_exception_handler(static function (Throwable $error): void {
    error_log('api.php errore non gestito: ' . $error->getMessage());
    if (!headers_sent()) http_response_code(500);
    echo json_encode(['error' => 'Errore interno del server: ' . $error->getMessage()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
});
register_shutdown_function(static function (): void {
    $message = $GLOBALS['cz_fatal_error'];
    if ($message === null) {
        $error = error_get_last();
        if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) $message = (string) $error['message'];
    }
    if ($message === null) return;
    error_log('api.php errore fatale: ' . $message);
    if (!headers_sent()) http_response_code(500);
    echo json_encode(['error' => 'Errore interno del server: ' . $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
});

require_once __DIR__ . '/private/config.php';

session_name(SESSION_NAME);
// La sessione resta valida per due ore in più rispetto ai precedenti 30 minuti.
// Il timeout è per inattività e viene rinnovato a ogni richiesta autenticata.
const SESSION_IDLE_LIFETIME = 9000;
session_set_cookie_params([
    'lifetime' => SESSION_IDLE_LIFETIME,
    'path' => '/',
    'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Lax',
]);
session_start();

$maxLifetime = SESSION_IDLE_LIFETIME;
$currentIp = substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
$currentUa = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200);

if (!empty($_SESSION['user_id'])) {
    if (isset($_SESSION['last_activity']) && (time() - $_SESSION['last_activity'] > $maxLifetime)) {
        session_unset();
        session_destroy();
        http_response_code(401);
        echo json_encode(['error' => 'Sessione scaduta per inattività.'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    
    if (!isset($_SESSION['client_ip'])) {
        $_SESSION['client_ip'] = $currentIp;
        $_SESSION['client_ua'] = $currentUa;
    } else {
        if ($_SESSION['client_ip'] !== $currentIp || $_SESSION['client_ua'] !== $currentUa) {
            session_unset();
            session_destroy();
            http_response_code(401);
            echo json_encode(['error' => 'Rilevato cambio di rete o dispositivo. Effettua nuovamente il login.'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            exit;
        }
    }
    $_SESSION['last_activity'] = time();
    // Rinnova anche la scadenza del cookie, non soltanto quella server-side.
    // In questo modo i 150 minuti decorrono davvero dall'ultima attività.
    setcookie(session_name(), session_id(), [
        'expires' => time() + SESSION_IDLE_LIFETIME,
        'path' => '/',
        'httponly' => true,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Lax',
    ]);
}
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
header("Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
header('Content-Type: application/json; charset=utf-8');

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function requestBody(): array
{
    $raw = file_get_contents('php://input') ?: '{}';
    $payload = json_decode($raw, true);
    return is_array($payload) ? $payload : [];
}

function clientIp(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

function auditLog(PDO $pdo, string $eventType, string $severity = 'info', ?int $userId = null, array $details = []): void
{
    try {
        $query = $pdo->prepare('INSERT INTO security_logs (user_id, event_type, severity, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?, ?)');
        $query->execute([$userId ?? ($_SESSION['user_id'] ?? null), $eventType, $severity, clientIp(), substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500), json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    } catch (Throwable $error) {
        error_log('Security log failure: ' . $error->getMessage());
    }
}

function csrfToken(): string
{
    if (empty($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf_token'];
}

function requireCsrf(PDO $pdo): void
{
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!$provided || empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $provided)) { auditLog($pdo, 'csrf_failed', 'critical'); respond(['error' => 'Richiesta non autorizzata.'], 419); }
}

function rateLimit(PDO $pdo, string $eventType, int $limit = 10): void
{
    $query = $pdo->prepare("SELECT COUNT(*) FROM security_logs WHERE event_type = ? AND ip_address = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 15 MINUTE");
    $query->execute([$eventType, clientIp()]);
    if ((int) $query->fetchColumn() >= $limit) respond(['error' => 'Troppe richieste. Riprova più tardi.'], 429);
}

function sanitizeInlineStyle(string $style): string
{
    $safe = [];
    foreach (explode(';', $style) as $declaration) {
        [$property, $value] = array_pad(explode(':', $declaration, 2), 2, '');
        $property = strtolower(trim($property));
        $value = trim($value);
        if ($property === 'font-size' && preg_match('/^(?:[89]|[1-8][0-9]|9[0-6])px$/', $value)) $safe[] = 'font-size:' . $value;
        if ($property === 'position' && in_array($value, ['absolute', 'relative', 'static'], true)) $safe[] = 'position:' . $value;
        if (($property === 'left' || $property === 'top') && preg_match('/^\d+(?:\.\d+)?px$/', $value)) $safe[] = $property . ':' . $value;
        if ($property === 'position' && in_array($value, ['absolute', 'relative', 'static'], true)) $safe[] = 'position:' . $value;
        if (($property === 'left' || $property === 'top') && preg_match('/^\d+(?:\.\d+)?px$/', $value)) $safe[] = $property . ':' . $value;
        if ($property === 'font-family' && preg_match('/^(Georgia|Raleway|Pinyon Script|Arial|Helvetica|Verdana|Tahoma|Garamond|Impact|"Times New Roman"|\'Times New Roman\'|"Trebuchet MS"|\'Trebuchet MS\'|"Courier New"|\'Courier New\'|"Lucida Console"|\'Lucida Console\'|"Palatino Linotype"|\'Palatino Linotype\'|"Book Antiqua"|\'Book Antiqua\'|"Comic Sans MS"|\'Comic Sans MS\')$/', $value)) $safe[] = 'font-family:' . $value;
        if ($property === 'font-weight' && preg_match('/^(normal|bold|[1-9]00)$/', $value)) $safe[] = 'font-weight:' . $value;
        if ($property === 'font-style' && in_array($value, ['normal', 'italic'], true)) $safe[] = 'font-style:' . $value;
        if ($property === 'text-decoration' && in_array($value, ['none', 'underline', 'line-through'], true)) $safe[] = 'text-decoration:' . $value;
        if ($property === 'text-align' && in_array($value, ['left', 'right', 'center', 'justify'], true)) $safe[] = 'text-align:' . $value;
        if (($property === 'width' || $property === 'max-width') && preg_match('/^(?:\d+(?:\.\d+)?px|100%)$/', $value)) $safe[] = $property . ':' . $value;
        if ($property === 'height' && $value === 'auto') $safe[] = 'height:auto';
        if ($property === 'display' && $value === 'block') $safe[] = 'display:block';
        if ($property === 'z-index' && in_array($value, ['0', '1'], true)) $safe[] = 'z-index:' . $value;
    }
    return implode(';', array_unique($safe));
}

function sanitizeRichHtml(string $html): string
{
    $allowedTags = '<p><strong><b><em><i><u><ol><ul><li><h1><h2><h3><h4><blockquote><table><tbody><tr><td><hr><a><img><span><div><font>';
    $html = strip_tags($html, $allowedTags);
    $html = preg_replace_callback('/\sstyle\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', static function (array $match): string {
        $style = $match[2] ?: ($match[3] ?: $match[4]);
        $safe = sanitizeInlineStyle($style);
        return $safe === '' ? '' : ' style="' . htmlspecialchars($safe, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '"';
    }, $html);
    if (preg_match_all('/\s(on[a-z]+|srcdoc)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', $html, $matches)) $html = preg_replace('/\s(on[a-z]+|srcdoc)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
    $html = preg_replace_callback('/\s(href|src)\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', static function (array $match): string { $url = $match[3] ?: ($match[4] ?: $match[5]); return preg_match('/^(https?:|mailto:|data:image\/)/i', $url) ? ' ' . strtolower($match[1]) . '="' . htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '"' : ''; }, $html);
    return $html;
}

function sanitizeState(array $state): array
{
    // Le cifre scelte nelle impostazioni del sito hanno la precedenza sul valore
    // di config.php, così il backend non riformatta contro la scelta dell'utente.
    $padding = isset($state['numberPadding']) ? (int) $state['numberPadding'] : documentNumberPadding();
    $padding = max(1, min(12, $padding));
    if (isset($state['numberPadding'])) $state['numberPadding'] = $padding;

    foreach ($state['documents'] ?? [] as &$document) {
        if (isset($document['body'])) $document['body'] = sanitizeRichHtml((string) $document['body']);
        // I progressivi sono salvati già con gli zeri iniziali, così l'archivio
        // resta ordinato anche se un vecchio record era stato scritto come "7".
        if (isset($document['number'])) {
            $padded = formatDocumentNumber($document['number'], $padding);
            if ($padded !== '') $document['number'] = $padded;
        }
    }
    unset($document);
    foreach ($state['templates'] ?? [] as &$template) if (isset($template['body'])) $template['body'] = sanitizeRichHtml((string) $template['body']);
    unset($template);
    foreach ($state['parties'] ?? [] as &$party) if (isset($party['statute'])) $party['statute'] = sanitizeRichHtml((string) $party['statute']);
    unset($party);
    foreach ($state['companies'] ?? [] as &$company) if (isset($company['regulation'])) $company['regulation'] = sanitizeRichHtml((string) $company['regulation']);
    unset($company);
    foreach ($state['counters'] ?? [] as $category => $counter) {
        $padded = formatDocumentNumber($counter, $padding);
        if ($padded !== '') $state['counters'][$category] = $padded;
    }
    return $state;
}

function ensureTrashPermissionColumns(PDO $pdo): void
{
    foreach (['can_restore', 'can_purge'] as $column) {
        try {
            $exists = $pdo->query("SHOW COLUMNS FROM role_permissions LIKE '{$column}'")->fetch();
            if (!$exists) $pdo->exec("ALTER TABLE role_permissions ADD COLUMN {$column} TINYINT(1) NOT NULL DEFAULT 0 AFTER can_delete");
        } catch (Throwable $error) {
            error_log('Permission schema migration failure: ' . $error->getMessage());
            respond(['error' => 'Aggiornamento del database necessario: impossibile preparare i permessi del cestino.'], 503);
        }
    }
}

function ensureGoogleConnectionTable(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS google_connections (user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, google_email VARCHAR(190) NOT NULL, refresh_token TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS google_watch_channels (channel_id VARCHAR(190) NOT NULL PRIMARY KEY, resource_id VARCHAR(190) NOT NULL, user_id BIGINT UNSIGNED NOT NULL, document_id VARCHAR(190) NOT NULL, expiration BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_google_watch_document (document_id), CONSTRAINT fk_google_watch_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function ensureApplicationPermissions(PDO $pdo): void
{
    $query = $pdo->prepare("INSERT INTO permissions (permission_key, label, permission_group) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label), permission_group = VALUES(permission_group)");
    $query->execute(['useful_links', 'Link utili', 'contenuti']);
}

function ensurePrimaryAdminFullPermissions(PDO $pdo): void
{
    $pdo->exec("UPDATE users SET role = 'admin', role_id = (SELECT id FROM roles WHERE role_key = 'admin' LIMIT 1), is_active = 1, deleted_at = NULL WHERE is_primary_admin = 1");
    $pdo->exec("INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, can_restore, can_purge, can_approve, can_download) SELECT r.id, p.id, 1, 1, 1, 1, 1, 1, 1, 1 FROM roles r CROSS JOIN permissions p WHERE r.role_key = 'admin' ON DUPLICATE KEY UPDATE can_view = 1, can_create = 1, can_edit = 1, can_delete = 1, can_restore = 1, can_purge = 1, can_approve = 1, can_download = 1");
}

function ensureUserLastLoginColumn(PDO $pdo): void
{
    try {
        $exists = $pdo->query("SHOW COLUMNS FROM users LIKE 'last_login'")->fetch();
        if (!$exists) $pdo->exec("ALTER TABLE users ADD COLUMN last_login DATETIME DEFAULT NULL AFTER must_change_credentials");
    } catch (Throwable $error) {
        error_log('User schema migration failure: ' . $error->getMessage());
    }
}

function database(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    if (str_contains(DB_NAME, 'INSERISCI_')) respond(['error' => 'BACKEND_UNAVAILABLE'], 503);
    try {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASSWORD,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
        ensureTrashPermissionColumns($pdo);
        ensureGoogleConnectionTable($pdo);
        ensureUserLastLoginColumn($pdo);
        ensureApplicationPermissions($pdo);
        ensurePrimaryAdminFullPermissions($pdo);
        return $pdo;
    } catch (Throwable $error) {
        error_log($error->getMessage());
        respond(['error' => 'BACKEND_UNAVAILABLE'], 503);
    }
}

function authenticatedUserId(): int
{
    if (empty($_SESSION['user_id'])) respond(['error' => 'Sessione non valida.'], 401);
    return (int) $_SESSION['user_id'];
}

function rawSiteState(PDO $pdo): ?array
{
    $query = $pdo->query('SELECT state_json FROM site_state WHERE id = 1 LIMIT 1');
    $row = $query->fetch();
    if (!$row) return null;
    $state = json_decode($row['state_json'], true);
    return is_array($state) ? sanitizeState($state) : null;
}

function stateForUser(PDO $pdo, int $userId): ?array
{
    $state = rawSiteState($pdo);
    if (!is_array($state) || !empty($_SESSION['is_primary_admin'])) return $state;
    $permissions = statePermissionMap();
    foreach ($permissions as $key => $permission) if (!hasPermission($pdo, $userId, $permission, 'view')) $state[$key] = is_array($state[$key] ?? null) ? [] : null;
    $state['trash'] = array_values(array_filter(is_array($state['trash'] ?? null) ? $state['trash'] : [], static function (mixed $entry) use ($pdo, $userId): bool {
        if (!is_array($entry)) return false;
        $config = trashEntityConfig((string) ($entry['entityType'] ?? ''));
        return $config && (hasPermission($pdo, $userId, $config['permission'], 'delete') || hasPermission($pdo, $userId, $config['permission'], 'restore') || hasPermission($pdo, $userId, $config['permission'], 'purge'));
    }));
    return $state;
}

function statePermissionMap(): array
{
    return [
        'documents' => 'documents',
        'templates' => 'templates',
        'counters' => 'settings',
        'categories' => 'settings',
        'pageMargins' => 'settings',
        'numberPadding' => 'settings',
        'parties' => 'parties',
        'partyFields' => 'parties',
        'coalitions' => 'parties',
        'coalitionFields' => 'parties',
        'companies' => 'companies',
        'parliaments' => 'parliament',
        'parliamentSettings' => 'parliament',
        'governments' => 'government',
        'governmentSettings' => 'government',
        'courtCompositions' => 'composition',
        'compositionSettings' => 'composition',
        'interpretations' => 'interpretations',
        'interpretationSettings' => 'interpretations',
        'usefulLinks' => 'useful_links'
    ];
}

function validEmail(string $email): bool
{
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false && strlen($email) <= 190;
}

function permissionsForRole(PDO $pdo, ?int $roleId): array
{
    if (!$roleId) return [];
    $query = $pdo->prepare('SELECT p.permission_key, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete, rp.can_restore, rp.can_purge, rp.can_approve, rp.can_download FROM role_permissions rp INNER JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?');
    $query->execute([$roleId]);
    $permissions = [];
    foreach ($query->fetchAll() as $permission) $permissions[$permission['permission_key']] = ['view' => (bool) $permission['can_view'], 'create' => (bool) $permission['can_create'], 'edit' => (bool) $permission['can_edit'], 'delete' => (bool) $permission['can_delete'], 'restore' => (bool) $permission['can_restore'], 'purge' => (bool) $permission['can_purge'], 'approve' => (bool) $permission['can_approve'], 'download' => (bool) $permission['can_download']];
    return $permissions;
}

function userPayload(array $user, PDO $pdo): array
{
    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'displayName' => $user['display_name'],
        'role' => $user['role_name'] ?? $user['role'],
        'roleId' => $user['role_id'] ? (int) $user['role_id'] : null,
        'isPrimaryAdmin' => (bool) $user['is_primary_admin'],
        'mustChangeCredentials' => (bool) ($user['must_change_credentials'] ?? false),
        'deletedAt' => $user['deleted_at'] ?? null,
        'permissions' => (bool) $user['is_primary_admin'] ? ['*' => ['view' => true, 'create' => true, 'edit' => true, 'delete' => true, 'restore' => true, 'purge' => true, 'approve' => true, 'download' => true]] : permissionsForRole($pdo, $user['role_id'] ? (int) $user['role_id'] : null),
        'csrfToken' => csrfToken(),
    ];
}

function requirePrimaryAdmin(): int
{
    if (empty($_SESSION['user_id']) || empty($_SESSION['is_primary_admin'])) respond(['error' => 'Operazione riservata all’amministratore principale.'], 403);
    return (int) $_SESSION['user_id'];
}

function hasPermission(PDO $pdo, int $userId, string $permission, string $action): bool
{
    if (!empty($_SESSION['is_primary_admin'])) return true;
    if (!in_array($action, ['view', 'create', 'edit', 'delete', 'restore', 'purge', 'approve', 'download'], true)) return false;
    $query = $pdo->prepare('SELECT rp.can_view, rp.can_create, rp.can_edit, rp.can_delete, rp.can_restore, rp.can_purge, rp.can_approve, rp.can_download FROM users u INNER JOIN role_permissions rp ON rp.role_id = u.role_id INNER JOIN permissions p ON p.id = rp.permission_id WHERE u.id = ? AND p.permission_key = ? LIMIT 1');
    $query->execute([$userId, $permission]);
    $row = $query->fetch();
    $allowed = $row ? (bool) ($row['can_' . $action] ?? false) : false;
    if (!$allowed) auditLog($pdo, 'permission_denied', 'warning', $userId, ['permission' => $permission, 'action' => $action]);
    return $allowed;
}

function pendingRequestExists(PDO $pdo, string $table, string $email): bool
{
    $query = $pdo->prepare("SELECT id FROM {$table} WHERE email = ? AND status = 'pending' LIMIT 1");
    $query->execute([$email]);
    return (bool) $query->fetchColumn();
}

function trashEntityConfig(string $entityType): ?array
{
    $configs = [
        'documents' => ['state_key' => 'documents', 'permission' => 'documents', 'label' => 'Documento'],
        'templates' => ['state_key' => 'templates', 'permission' => 'templates', 'label' => 'Template'],
        'parties' => ['state_key' => 'parties', 'permission' => 'parties', 'label' => 'Partito'],
        'companies' => ['state_key' => 'companies', 'permission' => 'companies', 'label' => 'Azienda'],
        'parliaments' => ['state_key' => 'parliaments', 'permission' => 'parliament', 'label' => 'Mandato parlamentare'],
        'governments' => ['state_key' => 'governments', 'permission' => 'government', 'label' => 'Scheda Governo'],
        'courtCompositions' => ['state_key' => 'courtCompositions', 'permission' => 'composition', 'label' => 'Composizione della Corte'],
        'interpretations' => ['state_key' => 'interpretations', 'permission' => 'interpretations', 'label' => 'Interpretazione'],
        'usefulLinks' => ['state_key' => 'usefulLinks', 'permission' => 'useful_links', 'label' => 'Link utile'],
        'parliamentMembers' => ['state_key' => 'parliaments', 'permission' => 'parliament', 'label' => 'Nomina parlamentare', 'member_key' => 'members'],
        'governmentMembers' => ['state_key' => 'governments', 'permission' => 'government', 'label' => 'Componente del Governo', 'member_key' => 'members'],
        'compositionMembers' => ['state_key' => 'courtCompositions', 'permission' => 'composition', 'label' => 'Componente della Corte', 'member_key' => 'members'],
    ];
    return $configs[$entityType] ?? null;
}

function stateItemIndex(array $items, string $id): int
{
    foreach ($items as $index => $item) if (is_array($item) && isset($item['id']) && hash_equals((string) $item['id'], $id)) return $index;
    return -1;
}

function stateForTrashMutation(PDO $pdo): array
{
    $state = rawSiteState($pdo) ?: [];
    foreach (['documents', 'templates', 'parties', 'companies', 'parliaments', 'governments', 'courtCompositions', 'interpretations', 'usefulLinks'] as $key) {
        if (!isset($state[$key]) || !is_array($state[$key])) $state[$key] = [];
    }
    if (!isset($state['trash']) || !is_array($state['trash'])) $state['trash'] = [];
    return $state;
}

function saveTrashMutationState(PDO $pdo, int $userId, array $state): void
{
    $state = sanitizeState($state);
    $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($encoded) || strlen($encoded) > maxStateBytes()) respond(['error' => 'Stato del cestino non valido o troppo grande.'], 422);
    $query = $pdo->prepare('INSERT INTO site_state (id, owner_user_id, state_json, updated_at) VALUES (1, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = UTC_TIMESTAMP()');
    $query->execute([$userId, $encoded]);
}

function trashEntryTitle(array $entry): string
{
    $data = is_array($entry['data'] ?? null) ? $entry['data'] : [];
    return substr((string) ($data['title'] ?? $data['name'] ?? $data['legislation'] ?? $data['period'] ?? $entry['label'] ?? 'Elemento'), 0, 160);
}

function googleConfigured(): bool
{
    return !configPlaceholder('GOOGLE_DRIVE_FOLDER_ID') && !configPlaceholder('GOOGLE_CLIENT_ID') && !configPlaceholder('GOOGLE_CLIENT_SECRET') && !configPlaceholder('GOOGLE_REDIRECT_URI');
}

/**
 * Le costanti sotto sono opzionali: gli impianti già installati non hanno un
 * config.php aggiornato, quindi si usano valori predefiniti sensati.
 */
function configPlaceholder(string $name): bool
{
    if (!defined($name)) return true;
    $value = (string) constant($name);
    return $value === '' || $value === 'BOH' || str_contains($value, 'INSERISCI_');
}

function googleApiTimeout(): int
{
    $value = defined('GOOGLE_API_TIMEOUT') ? (int) constant('GOOGLE_API_TIMEOUT') : 20;
    return $value > 0 ? $value : 20;
}

function maxStateBytes(): int
{
    $value = defined('MAX_STATE_BYTES') ? (int) constant('MAX_STATE_BYTES') : 2097152;
    return $value > 0 ? $value : 2097152;
}

function googleSyncMaxLookups(): int
{
    $value = defined('GOOGLE_SYNC_MAX_LOOKUPS') ? (int) constant('GOOGLE_SYNC_MAX_LOOKUPS') : 40;
    return $value > 0 ? $value : 40;
}

function googleNameSyncInterval(): int
{
    return defined('GOOGLE_NAME_SYNC_INTERVAL') ? max(0, (int) constant('GOOGLE_NAME_SYNC_INTERVAL')) : 120;
}

function documentNumberPadding(): int
{
    $value = defined('DOCUMENT_NUMBER_PADDING') ? (int) constant('DOCUMENT_NUMBER_PADDING') : 5;
    return max(1, min(12, $value));
}

/**
 * Normalizza un progressivo aggiungendo gli zeri iniziali (es. 1 -> 00001).
 */
function formatDocumentNumber(mixed $value, ?int $padding = null): string
{
    $digits = preg_replace('/\D+/', '', (string) $value) ?? '';
    if ($digits === '') return '';
    $numeric = ltrim($digits, '0');
    if ($numeric === '') $numeric = '0';
    return str_pad($numeric, $padding ?? documentNumberPadding(), '0', STR_PAD_LEFT);
}

function base64UrlEncode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

/**
 * Restituisce un access token valido, oppure null se non è ottenibile.
 * Il token viene riusato per tutta la durata della richiesta PHP: le
 * sincronizzazioni leggono molti file e un refresh per chiamata sprecherebbe quota.
 */
function googleAccessTokenOrNull(PDO $pdo, int $userId): ?string
{
    static $tokenCache = [];
    if (isset($tokenCache[$userId])) return $tokenCache[$userId];
    if (!googleConfigured()) return null;
    try {
        $query = $pdo->prepare('SELECT refresh_token FROM google_connections WHERE user_id = ? LIMIT 1');
        $query->execute([$userId]);
        $refreshToken = (string) $query->fetchColumn();
    } catch (Throwable $error) {
        return null;
    }
    if ($refreshToken === '') return null;
    $post = http_build_query(['client_id' => GOOGLE_CLIENT_ID, 'client_secret' => GOOGLE_CLIENT_SECRET, 'refresh_token' => $refreshToken, 'grant_type' => 'refresh_token']);
    $context = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/x-www-form-urlencoded\r\n", 'content' => $post, 'timeout' => googleApiTimeout(), 'ignore_errors' => true]]);
    $response = @file_get_contents('https://oauth2.googleapis.com/token', false, $context);
    $payload = json_decode((string) $response, true);
    if (!is_array($payload) || empty($payload['access_token'])) return null;
    $tokenCache[$userId] = (string) $payload['access_token'];
    return $tokenCache[$userId];
}

function googleAccessToken(PDO $pdo, int $userId): string
{
    $token = googleAccessTokenOrNull($pdo, $userId);
    if ($token !== null) return $token;
    if (!googleConfigured()) respond(['error' => 'Google non configurato: completa le credenziali OAuth e l’ID della cartella in private/config.php.'], 503);
    $query = $pdo->prepare('SELECT refresh_token FROM google_connections WHERE user_id = ? LIMIT 1');
    $query->execute([$userId]);
    if ((string) $query->fetchColumn() === '') respond(['error' => 'Collega prima un account Google dalle impostazioni.'], 409);
    respond(['error' => 'La connessione Google è scaduta. Ricollega l’account dalle impostazioni.'], 409);
}

function googleConnectionExists(PDO $pdo, int $userId): bool
{
    try {
        if (!googleConfigured()) return false;
        $query = $pdo->prepare('SELECT refresh_token FROM google_connections WHERE user_id = ? LIMIT 1');
        $query->execute([$userId]);
        return (string) $query->fetchColumn() !== '';
    } catch (Throwable $error) {
        return false;
    }
}

function googleWebhookConfigured(): bool
{
    return !configPlaceholder('GOOGLE_WEBHOOK_URI') && str_starts_with((string) GOOGLE_WEBHOOK_URI, 'https://');
}

function googleRequest(PDO $pdo, int $userId, string $method, string $url, ?array $body = null, bool $binary = false, bool $allowFailure = false): mixed
{
    // Con allowFailure le sincronizzazioni di sfondo non devono interrompere la
    // risposta al browser: se il token manca si rinuncia in silenzio.
    $token = $allowFailure ? googleAccessTokenOrNull($pdo, $userId) : googleAccessToken($pdo, $userId);
    if ($token === null) return null;
    $headers = ['Authorization: Bearer ' . $token, 'Accept: application/json'];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    $curl = curl_init($url);
    curl_setopt_array($curl, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => googleApiTimeout(), CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    $response = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    if ($response === false || $error !== '' || $status < 200 || $status >= 300) {
        $details = json_decode((string) $response, true);
        $message = is_array($details) ? (string) ($details['error']['message'] ?? $details['error_description'] ?? '') : '';
        error_log('Google API failure [' . $status . '] ' . $method . ' ' . $url . ': ' . ($message ?: ($error ?: substr((string) $response, 0, 500))));
        if ($allowFailure) return null;
        respond(['error' => $message !== '' ? 'Google: ' . $message : 'Google ha rifiutato la richiesta.'], 502);
    }
    return $binary ? $response : (json_decode((string) $response, true) ?: []);
}

function googleDocumentTitle(string $title): string
{
    return trim(preg_replace('/[\\/:*?"<>|]+/', '-', $title)) ?: 'Documento senza titolo';
}

function googleStructuralText(array $elements): string
{
    $text = '';
    foreach ($elements as $element) {
        if (isset($element['textRun']['content'])) $text .= (string) $element['textRun']['content'];
        if (isset($element['paragraph']['elements']) && is_array($element['paragraph']['elements'])) $text .= googleStructuralText($element['paragraph']['elements']);
        if (isset($element['table']['tableRows']) && is_array($element['table']['tableRows'])) {
            foreach ($element['table']['tableRows'] as $row) foreach (($row['tableCells'] ?? []) as $cell) $text .= googleStructuralText($cell['content'] ?? []);
        }
    }
    return trim(preg_replace('/\R{3,}/', "\n\n", $text));
}

function googleDocumentSnapshot(PDO $pdo, int $userId, string $documentId): string
{
    $document = googleRequest($pdo, $userId, 'GET', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($documentId));
    return googleStructuralText($document['body']['content'] ?? []);
}

function googleIdsFromStateItem(array $data): array
{
    return array_values(array_unique(array_filter([
        $data['googleDocumentId'] ?? null,
        $data['googleStatuteDocumentId'] ?? null,
        $data['googleRegulationDocumentId'] ?? null,
    ], static fn (mixed $id): bool => is_string($id) && preg_match('/^[a-zA-Z0-9_-]+$/', $id) === 1)));
}

function validGoogleId(mixed $id): string
{
    return is_string($id) && preg_match('/^[a-zA-Z0-9_-]{5,}$/', $id) === 1 ? $id : '';
}

/**
 * Elenca ogni file Google collegato allo stato, indicando dove il nome va riportato.
 *
 * @return array<string, array<int, array{key: string, index: int, field: string}>>
 */
function googleLinkedDocuments(array $state): array
{
    $map = [];
    $collections = [
        ['documents', 'googleDocumentId', 'title'],
        ['templates', 'googleDocumentId', 'name'],
        ['parties', 'googleStatuteDocumentId', 'googleStatuteName'],
        ['companies', 'googleRegulationDocumentId', 'googleRegulationName'],
    ];
    foreach ($collections as [$key, $idField, $nameField]) {
        foreach (($state[$key] ?? []) as $index => $item) {
            if (!is_array($item)) continue;
            $documentId = validGoogleId($item[$idField] ?? null);
            if ($documentId === '') continue;
            $map[$documentId][] = ['key' => $key, 'index' => $index, 'field' => $nameField];
        }
    }
    return $map;
}

/**
 * Recupera in blocco i metadati dei file richiesti: prima con un elenco della
 * cartella configurata (poche chiamate), poi con richieste puntuali per i file
 * spostati altrove. Così la sincronizzazione resta veloce anche con molti documenti.
 *
 * @param array<int, string> $ids
 * @return array<string, array{name: string, trashed: bool, modifiedTime: ?string, webViewLink: ?string, missing: bool}>
 */
function googleFileMetadata(PDO $pdo, int $userId, array $ids, ?int $maxLookups = null): array
{
    $maxLookups ??= googleSyncMaxLookups();
    $wanted = array_values(array_unique(array_filter(array_map(static fn (mixed $id): string => validGoogleId($id), $ids), static fn (string $id): bool => $id !== '')));
    if (empty($wanted)) return [];

    $found = [];
    $pageToken = '';
    $pages = 0;
    do {
        $parameters = [
            'q' => "'" . str_replace("'", "\\'", GOOGLE_DRIVE_FOLDER_ID) . "' in parents",
            'fields' => 'nextPageToken,files(id,name,trashed,modifiedTime,webViewLink)',
            'pageSize' => 1000,
            'supportsAllDrives' => 'true',
            'includeItemsFromAllDrives' => 'true',
        ];
        if ($pageToken !== '') $parameters['pageToken'] = $pageToken;
        $listing = googleRequest($pdo, $userId, 'GET', 'https://www.googleapis.com/drive/v3/files?' . http_build_query($parameters), null, false, true);
        if (!is_array($listing)) break;
        foreach (($listing['files'] ?? []) as $file) {
            $fileId = validGoogleId($file['id'] ?? null);
            if ($fileId === '') continue;
            $found[$fileId] = [
                'name' => trim((string) ($file['name'] ?? '')),
                'trashed' => (bool) ($file['trashed'] ?? false),
                'modifiedTime' => $file['modifiedTime'] ?? null,
                'webViewLink' => $file['webViewLink'] ?? null,
                'missing' => false,
            ];
        }
        $pageToken = (string) ($listing['nextPageToken'] ?? '');
        $pages++;
    } while ($pageToken !== '' && $pages < 10);

    $metadata = [];
    $lookups = 0;
    foreach ($wanted as $documentId) {
        if (isset($found[$documentId])) { $metadata[$documentId] = $found[$documentId]; continue; }
        if ($lookups >= $maxLookups) continue;
        $lookups++;
        $file = googleRequest($pdo, $userId, 'GET', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($documentId) . '?' . http_build_query(['fields' => 'id,name,trashed,modifiedTime,webViewLink', 'supportsAllDrives' => 'true']), null, false, true);
        if (!is_array($file) || !isset($file['id'])) { $metadata[$documentId] = ['name' => '', 'trashed' => false, 'modifiedTime' => null, 'webViewLink' => null, 'missing' => true]; continue; }
        $metadata[$documentId] = [
            'name' => trim((string) ($file['name'] ?? '')),
            'trashed' => (bool) ($file['trashed'] ?? false),
            'modifiedTime' => $file['modifiedTime'] ?? null,
            'webViewLink' => $file['webViewLink'] ?? null,
            'missing' => false,
        ];
    }
    return $metadata;
}

/**
 * Riporta nello stato i nomi correnti dei file Google: il sito mostra sempre il
 * titolo aggiornato su Drive e non conserva più quello vecchio.
 *
 * @param array<string, array{name: string, trashed: bool, modifiedTime: ?string, webViewLink: ?string, missing: bool}> $metadata
 * @return array{changed: bool, renamed: array<int, array{type: string, id: string, from: string, to: string}>, missing: array<int, string>, trashed: array<int, string>}
 */
function applyGoogleNamesToState(array &$state, array $metadata): array
{
    $renamed = [];
    $missing = [];
    $trashed = [];
    $changed = false;
    foreach (googleLinkedDocuments($state) as $documentId => $references) {
        $file = $metadata[$documentId] ?? null;
        if (!is_array($file)) continue;
        if (!empty($file['missing'])) { $missing[] = $documentId; continue; }
        if (!empty($file['trashed'])) $trashed[] = $documentId;
        $name = (string) $file['name'];
        foreach ($references as $reference) {
            $item = $state[$reference['key']][$reference['index']] ?? null;
            if (!is_array($item)) continue;
            $previous = (string) ($item[$reference['field']] ?? '');
            if ($name !== '' && $name !== $previous) {
                $item[$reference['field']] = $name;
                $renamed[] = ['type' => $reference['key'], 'id' => (string) ($item['id'] ?? ''), 'from' => $previous, 'to' => $name];
                $changed = true;
            }
            if ($name !== '' && ($item['googleDocumentName'] ?? null) !== $name) { $item['googleDocumentName'] = $name; $changed = true; }
            $link = $file['webViewLink'] ?: ('https://docs.google.com/document/d/' . rawurlencode($documentId) . '/edit');
            if (($item['googleUrl'] ?? null) !== $link) { $item['googleUrl'] = $link; $changed = true; }
            if ($reference['key'] === 'parties' && ($item['statuteUrl'] ?? null) !== $link) { $item['statuteUrl'] = $link; $changed = true; }
            if ($reference['key'] === 'companies' && ($item['regulationUrl'] ?? null) !== $link) { $item['regulationUrl'] = $link; $changed = true; }
            if (!empty($file['modifiedTime']) && ($item['googleModifiedTime'] ?? null) !== $file['modifiedTime']) { $item['googleModifiedTime'] = $file['modifiedTime']; $changed = true; }
            $state[$reference['key']][$reference['index']] = $item;
        }
    }
    return ['changed' => $changed, 'renamed' => $renamed, 'missing' => array_values(array_unique($missing)), 'trashed' => array_values(array_unique($trashed))];
}

function saveSiteState(PDO $pdo, int $userId, array $state): void
{
    $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($encoded)) return;
    // owner_user_id è NOT NULL senza valore predefinito: va passato sempre,
    // altrimenti il primo inserimento della riga id=1 fallisce con l'errore
    // MySQL 1364 ("Field 'owner_user_id' doesn't have a default value").
    $query = $pdo->prepare('INSERT INTO site_state (id, owner_user_id, state_json, updated_at) VALUES (1, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = UTC_TIMESTAMP()');
    $query->execute([$userId, $encoded]);
}

/**
 * Allinea i nomi di tutti i documenti collegati e restituisce il riepilogo.
 */
function syncGoogleDocumentNames(PDO $pdo, int $userId): array
{
    $state = rawSiteState($pdo) ?: [];
    $links = googleLinkedDocuments($state);
    if (empty($links)) return ['checked' => 0, 'renamed' => [], 'missing' => [], 'trashed' => []];
    $metadata = googleFileMetadata($pdo, $userId, array_keys($links));
    $result = applyGoogleNamesToState($state, $metadata);
    if ($result['changed']) {
        $state['googleNamesSyncedAt'] = gmdate('c');
        saveSiteState($pdo, $userId, $state);
        if (!empty($result['renamed'])) auditLog($pdo, 'google_documents_renamed', 'info', $userId, ['count' => count($result['renamed']), 'renamed' => array_slice($result['renamed'], 0, 20)]);
    }
    return ['checked' => count($links), 'renamed' => $result['renamed'], 'missing' => $result['missing'], 'trashed' => $result['trashed']];
}

/**
 * Riallinea i nomi all'apertura del sito, ma non a ogni richiesta: senza il
 * webhook Drive questa è l'unica occasione di accorgersi di un rename, con il
 * webhook resta solo una rete di sicurezza. L'intervallo evita di rallentare
 * la navigazione e di consumare quota API inutilmente.
 */
function maybeAutoSyncGoogleNames(PDO $pdo, int $userId): void
{
    $interval = googleNameSyncInterval();
    if ($interval <= 0) return;
    if (!googleConnectionExists($pdo, $userId)) return;
    $last = (int) ($_SESSION['google_names_synced_at'] ?? 0);
    if ($last > 0 && (time() - $last) < $interval) return;
    // Segnata prima del lavoro: se Drive è lento o fallisce non si riprova a ogni caricamento.
    $_SESSION['google_names_synced_at'] = time();
    try {
        syncGoogleDocumentNames($pdo, $userId);
    } catch (Throwable $error) {
        error_log('Sincronizzazione automatica dei nomi Google non riuscita: ' . $error->getMessage());
    }
}

/**
 * Rinomina il file su Drive quando il titolo cambia dal sito, così le due
 * anagrafiche non si sovrascrivono a vicenda alla sincronizzazione successiva.
 */
function renameGoogleDocument(PDO $pdo, int $userId, string $documentId, string $title): ?string
{
    $documentId = validGoogleId($documentId);
    $title = googleDocumentTitle($title);
    if ($documentId === '' || $title === '') return null;
    if (!googleConnectionExists($pdo, $userId)) return null;
    $file = googleRequest($pdo, $userId, 'PATCH', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($documentId) . '?' . http_build_query(['fields' => 'id,name', 'supportsAllDrives' => 'true']), ['name' => $title], false, true);
    return is_array($file) && isset($file['name']) ? (string) $file['name'] : null;
}

function updateGoogleTrashState(PDO $pdo, int $userId, array $data, bool $trashed, bool $permanent = false): void
{
    $ids = googleIdsFromStateItem($data);
    if (empty($ids)) return;
    
    try {
        if (!googleConfigured()) return;
        $query = $pdo->prepare('SELECT refresh_token FROM google_connections WHERE user_id = ? LIMIT 1');
        $query->execute([$userId]);
        if (!(string) $query->fetchColumn()) return;
    } catch (Throwable $error) {
        return;
    }

    foreach ($ids as $documentId) {
        if ($permanent) {
            googleRequest($pdo, $userId, 'DELETE', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($documentId), null, false, true);
        } else {
            googleRequest($pdo, $userId, 'PATCH', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($documentId), ['trashed' => $trashed], false, true);
        }
    }
}

function googleWatchDocument(PDO $pdo, int $userId, string $documentId): void
{
    // Senza un endpoint pubblico in HTTPS Drive rifiuta il canale: in quel caso
    // l'allineamento dei nomi resta affidato alla sincronizzazione periodica.
    if (!googleWebhookConfigured()) return;
    $channelId = bin2hex(random_bytes(24));
    $payload = googleRequest($pdo, $userId, 'POST', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($documentId) . '/watch', ['id' => $channelId, 'type' => 'web_hook', 'address' => GOOGLE_WEBHOOK_URI, 'token' => hash_hmac('sha256', $channelId, SESSION_NAME)], false, true);
    if (!is_array($payload)) { error_log('Google Drive webhook non attivato per il documento ' . $documentId); return; }
    $resourceId = (string) ($payload['resourceId'] ?? '');
    $expiration = (int) ($payload['expiration'] ?? 0);
    if ($resourceId === '' || $expiration <= 0) return;
    $query = $pdo->prepare('INSERT INTO google_watch_channels (channel_id, resource_id, user_id, document_id, expiration) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE resource_id = VALUES(resource_id), user_id = VALUES(user_id), document_id = VALUES(document_id), expiration = VALUES(expiration)');
    $query->execute([$channelId, $resourceId, $userId, $documentId, $expiration]);
}

function syncGoogleDocumentMetadata(PDO $pdo, int $userId, string $documentId): void
{
    $file = googleRequest($pdo, $userId, 'GET', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($documentId) . '?' . http_build_query(['fields' => 'id,name,modifiedTime,lastModifyingUser(displayName,emailAddress),webViewLink']));
    $snapshot = googleDocumentSnapshot($pdo, $userId, $documentId);
    $state = rawSiteState($pdo) ?: [];
    $changed = false;
    // Il nome su Drive è la fonte di verità: il rename fatto in Google Documenti
    // deve comparire subito nel sito, senza lasciare in giro il titolo vecchio.
    $googleName = trim((string) ($file['name'] ?? ''));
    foreach (['documents', 'templates'] as $key) foreach (($state[$key] ?? []) as &$item) {
        if (($item['googleDocumentId'] ?? '') !== $documentId) continue;
        $titleField = $key === 'documents' ? 'title' : 'name';
        if ($googleName !== '' && (string) ($item[$titleField] ?? '') !== $googleName) {
            auditLog($pdo, 'google_document_renamed', 'info', $userId, ['document_id' => $documentId, 'from' => (string) ($item[$titleField] ?? ''), 'to' => $googleName]);
            $item[$titleField] = $googleName;
        }
        if ($googleName !== '') $item['googleDocumentName'] = $googleName;
        $item['googleModifiedTime'] = $file['modifiedTime'] ?? null;
        $item['googleModifiedBy'] = $file['lastModifyingUser']['emailAddress'] ?? ($file['lastModifyingUser']['displayName'] ?? null);
        $item['googleUrl'] = $file['webViewLink'] ?? ('https://docs.google.com/document/d/' . rawurlencode($documentId) . '/edit');
        $changed = true;
    }
    foreach (($state['parties'] ?? []) as &$party) {
        if (($party['googleStatuteDocumentId'] ?? '') !== $documentId) continue;
        if ($googleName !== '') { $party['googleStatuteName'] = $googleName; $party['googleDocumentName'] = $googleName; }
        $modifiedTime = $file['modifiedTime'] ?? null;
        $previousSnapshot = (string) ($party['googleLatestText'] ?? '');
        if ($snapshot !== '' && $previousSnapshot !== '' && $snapshot !== $previousSnapshot) {
            $party['history'] ??= [];
            $party['history'][] = ['label' => 'Statuto Google', 'from' => 'Versione precedente', 'to' => 'Versione aggiornata', 'at' => $modifiedTime, 'previousStatute' => $previousSnapshot, 'nextStatute' => $snapshot, 'googleModifiedTime' => $modifiedTime, 'googleModifiedBy' => $file['lastModifyingUser']['emailAddress'] ?? ($file['lastModifyingUser']['displayName'] ?? null)];
        }
        $party['googleLatestText'] = $snapshot;
        $party['googleModifiedTime'] = $modifiedTime;
        $party['googleModifiedBy'] = $file['lastModifyingUser']['emailAddress'] ?? ($file['lastModifyingUser']['displayName'] ?? null);
        $party['googleUrl'] = $file['webViewLink'] ?? ('https://docs.google.com/document/d/' . rawurlencode($documentId) . '/edit');
        $changed = true;
    }
    foreach (($state['companies'] ?? []) as &$company) {
        if (($company['googleRegulationDocumentId'] ?? '') !== $documentId) continue;
        if ($googleName !== '') { $company['googleRegulationName'] = $googleName; $company['googleDocumentName'] = $googleName; }
        $modifiedTime = $file['modifiedTime'] ?? null;
        $previousSnapshot = (string) ($company['googleLatestText'] ?? '');
        if ($snapshot !== '' && $previousSnapshot !== '' && $snapshot !== $previousSnapshot) {
            $company['history'] ??= [];
            $company['history'][] = ['label' => 'Regolamento Google', 'from' => 'Versione precedente', 'to' => 'Versione aggiornata', 'at' => $modifiedTime, 'previousStatute' => $previousSnapshot, 'nextStatute' => $snapshot, 'googleModifiedTime' => $modifiedTime, 'googleModifiedBy' => $file['lastModifyingUser']['emailAddress'] ?? ($file['lastModifyingUser']['displayName'] ?? null)];
        }
        $company['googleLatestText'] = $snapshot;
        $company['googleModifiedTime'] = $modifiedTime;
        $company['googleModifiedBy'] = $file['lastModifyingUser']['emailAddress'] ?? ($file['lastModifyingUser']['displayName'] ?? null);
        $company['googleUrl'] = $file['webViewLink'] ?? ('https://docs.google.com/document/d/' . rawurlencode($documentId) . '/edit');
        $changed = true;
    }
    if (!$changed) return;
    $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $query = $pdo->prepare('UPDATE site_state SET state_json = ?, updated_at = UTC_TIMESTAMP() WHERE id = 1');
    $query->execute([$encoded]);
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'google_webhook' && $method === 'POST') {
    $channelId = (string) ($_SERVER['HTTP_X_GOOG_CHANNEL_ID'] ?? '');
    $token = (string) ($_SERVER['HTTP_X_GOOG_CHANNEL_TOKEN'] ?? '');
    if ($channelId === '' || !hash_equals(hash_hmac('sha256', $channelId, SESSION_NAME), $token)) { http_response_code(401); exit; }
    $pdo = database();
    $query = $pdo->prepare('SELECT user_id, document_id FROM google_watch_channels WHERE channel_id = ? AND expiration > ? LIMIT 1');
    $query->execute([$channelId, (int) (microtime(true) * 1000)]);
    $watch = $query->fetch();
    if ($watch) syncGoogleDocumentMetadata($pdo, (int) $watch['user_id'], (string) $watch['document_id']);
    http_response_code(204);
    exit;
}

if ($action === 'google_connect' && $method === 'GET') {
    $userId = authenticatedUserId();
    if (!googleConfigured()) respond(['error' => 'Google non configurato: completa private/config.php.'], 503);
    $_SESSION['google_oauth_state'] = bin2hex(random_bytes(24));
    $query = http_build_query(['client_id' => GOOGLE_CLIENT_ID, 'redirect_uri' => GOOGLE_REDIRECT_URI, 'response_type' => 'code', 'scope' => 'openid email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents', 'access_type' => 'offline', 'prompt' => 'consent', 'state' => $_SESSION['google_oauth_state']]);
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . $query, true, 302);
    exit;
}

if ($action === 'google_callback' && $method === 'GET') {
    $userId = authenticatedUserId();
    $state = (string) ($_GET['state'] ?? '');
    $code = (string) ($_GET['code'] ?? '');
    if ($state === '' || !hash_equals((string) ($_SESSION['google_oauth_state'] ?? ''), $state) || $code === '') respond(['error' => 'Collegamento Google non valido.'], 400);
    $post = http_build_query(['code' => $code, 'client_id' => GOOGLE_CLIENT_ID, 'client_secret' => GOOGLE_CLIENT_SECRET, 'redirect_uri' => GOOGLE_REDIRECT_URI, 'grant_type' => 'authorization_code']);
    $context = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/x-www-form-urlencoded\r\n", 'content' => $post, 'timeout' => googleApiTimeout(), 'ignore_errors' => true]]);
    $tokenPayload = json_decode((string) file_get_contents('https://oauth2.googleapis.com/token', false, $context), true);
    if (!is_array($tokenPayload) || empty($tokenPayload['refresh_token'])) respond(['error' => 'Google non ha restituito un refresh token. Riprova autorizzando l’accesso.'], 502);
    $token = (string) $tokenPayload['access_token'];
    $curl = curl_init('https://openidconnect.googleapis.com/v1/userinfo');
    curl_setopt_array($curl, [CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => googleApiTimeout()]);
    $profile = json_decode((string) curl_exec($curl), true);
    curl_close($curl);
    $pdo = database();
    $query = $pdo->prepare('INSERT INTO google_connections (user_id, google_email, refresh_token) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE google_email = VALUES(google_email), refresh_token = VALUES(refresh_token), updated_at = UTC_TIMESTAMP()');
    $query->execute([$userId, (string) ($profile['email'] ?? ''), (string) $tokenPayload['refresh_token']]);
    unset($_SESSION['google_oauth_state']);
    header('Location: ./index.html#settings?google=connected', true, 302);
    exit;
}

if ($action === 'google_status' && $method === 'GET') {
    $userId = authenticatedUserId();
    $pdo = database();
    $query = $pdo->prepare('SELECT google_email FROM google_connections WHERE user_id = ? LIMIT 1');
    $query->execute([$userId]);
    $email = $query->fetchColumn();
    respond(['connected' => is_string($email) && $email !== '', 'email' => $email ?: null, 'configured' => googleConfigured()]);
}

if ($action === 'google_disconnect' && $method === 'POST') {
    $userId = authenticatedUserId();
    $pdo = database();
    requireCsrf($pdo);
    $query = $pdo->prepare('DELETE FROM google_connections WHERE user_id = ?');
    $query->execute([$userId]);
    respond(['ok' => true]);
}

if ($action === 'google_drive_files' && $method === 'GET') {
    $userId = authenticatedUserId();
    $pdo = database();
    if (!googleConfigured()) respond(['error' => 'Google non configurato: completa le credenziali OAuth e l’ID della cartella in private/config.php.'], 503);
    if (!hasPermission($pdo, $userId, 'documents', 'view')) respond(['error' => 'Non hai il permesso di vedere i documenti.'], 403);
    $query = "'" . addslashes(GOOGLE_DRIVE_FOLDER_ID) . "' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'";
    $url = 'https://www.googleapis.com/drive/v3/files?' . http_build_query(['q' => $query, 'fields' => 'files(id,name,webViewLink,modifiedTime)', 'orderBy' => 'name', 'pageSize' => 100]);
    $files = googleRequest($pdo, $userId, 'GET', $url);
    respond(['files' => is_array($files['files'] ?? null) ? $files['files'] : []]);
}

if ($action === 'google_document_create' && $method === 'POST') {
    $userId = authenticatedUserId();
    $pdo = database();
    requireCsrf($pdo);
    $body = requestBody();
    $permission = (string) (($body['permission'] ?? 'documents'));
    if (!in_array($permission, ['documents', 'templates', 'parties', 'companies'], true) || !hasPermission($pdo, $userId, $permission, 'edit')) respond(['error' => 'Non hai il permesso di creare documenti Google.'], 403);
    $title = googleDocumentTitle((string) ($body['title'] ?? 'Documento'));
    $sourceDocumentId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($body['sourceDocumentId'] ?? ''));
    if ($sourceDocumentId !== '') {
        $created = googleRequest($pdo, $userId, 'POST', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($sourceDocumentId) . '/copy?fields=id,name,webViewLink,mimeType', ['name' => $title, 'parents' => [GOOGLE_DRIVE_FOLDER_ID]]);
    } else {
        $created = googleRequest($pdo, $userId, 'POST', 'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink,mimeType', ['name' => $title, 'mimeType' => 'application/vnd.google-apps.document', 'parents' => [GOOGLE_DRIVE_FOLDER_ID]]);
    }
    $documentId = (string) ($created['id'] ?? '');
    if ($documentId === '') respond(['error' => 'Google non ha restituito il documento creato.'], 502);
    googleWatchDocument($pdo, $userId, $documentId);
    auditLog($pdo, 'google_document_created', 'info', $userId, ['document_id' => $documentId, 'title' => $title]);
    respond(['id' => $documentId, 'name' => (string) ($created['name'] ?? $title), 'url' => (string) ($created['webViewLink'] ?? ('https://docs.google.com/document/d/' . rawurlencode($documentId) . '/edit'))]);
}

if ($action === 'google_document_rename' && $method === 'POST') {
    $userId = authenticatedUserId();
    $pdo = database();
    requireCsrf($pdo);
    $body = requestBody();
    $permission = (string) ($body['permission'] ?? 'documents');
    if (!in_array($permission, ['documents', 'templates', 'parties', 'companies'], true) || !hasPermission($pdo, $userId, $permission, 'edit')) respond(['error' => 'Non hai il permesso di rinominare questo documento Google.'], 403);
    $documentId = validGoogleId((string) ($body['documentId'] ?? ''));
    $title = googleDocumentTitle((string) ($body['title'] ?? ''));
    if ($documentId === '' || $title === '') respond(['error' => 'Documento Google o titolo non valido.'], 422);
    $name = renameGoogleDocument($pdo, $userId, $documentId, $title);
    if ($name === null) respond(['error' => 'Google non ha accettato la rinomina del documento.'], 502);
    auditLog($pdo, 'google_document_renamed', 'info', $userId, ['document_id' => $documentId, 'to' => $name]);
    respond(['id' => $documentId, 'name' => $name]);
}

if ($action === 'google_sync_names' && $method === 'POST') {
    $userId = authenticatedUserId();
    $pdo = database();
    requireCsrf($pdo);
    if (!googleConnectionExists($pdo, $userId)) respond(['error' => 'Collega prima un account Google dalle impostazioni.'], 409);
    $summary = syncGoogleDocumentNames($pdo, $userId);
    respond([
        'ok' => true,
        'checked' => $summary['checked'],
        'renamed' => $summary['renamed'],
        'missing' => $summary['missing'],
        'trashed' => $summary['trashed'],
        'state' => stateForUser($pdo, $userId),
    ]);
}

if ($action === 'google_document_pdf' && $method === 'GET') {
    $userId = authenticatedUserId();
    $pdo = database();
    if (!hasPermission($pdo, $userId, 'documents_pdf', 'download')) respond(['error' => 'Non hai il permesso di scaricare PDF.'], 403);
    $documentId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($_GET['id'] ?? ''));
    if ($documentId === '') respond(['error' => 'Documento Google non valido.'], 422);
    $pdf = googleRequest($pdo, $userId, 'GET', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($documentId) . '/export?mimeType=application%2Fpdf', null, true);
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="documento-google.pdf"');
    echo $pdf;
    exit;
}

if ($action === 'google_document_check' && $method === 'POST') {
    $userId = authenticatedUserId();
    $pdo = database();
    requireCsrf($pdo);
    $body = requestBody();
    $ids = $body['ids'] ?? [];
    if (!is_array($ids)) respond(['error' => 'Parametro ids non valido.'], 422);
    $results = [];
    foreach ($ids as $rawId) {
        $documentId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $rawId);
        if ($documentId === '') { $results[$rawId] = false; continue; }
        $file = googleRequest($pdo, $userId, 'GET', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($documentId) . '?fields=id,trashed', null, false, true);
        $results[$documentId] = is_array($file) && isset($file['id']) && empty($file['trashed']);
    }
    respond(['results' => $results]);
}

if ($action === 'login' && $method === 'POST') {
    $body = requestBody();
    $username = trim((string) ($body['username'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if (!validEmail($username) || $password === '') respond(['error' => 'Inserisci un indirizzo e-mail e una password.'], 422);
    $pdo = database();
    rateLimit($pdo, 'login_attempt', 10);
    $query = $pdo->prepare("SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.is_primary_admin, u.must_change_credentials, r.name AS role_name, u.password_hash FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.username = ? AND u.is_active = 1 AND u.deleted_at IS NULL LIMIT 1");
    $query->execute([$username]);
    $user = $query->fetch();
    if (!$user || !password_verify($password, $user['password_hash'])) { auditLog($pdo, 'login_failed', 'warning', null, ['username' => $username]); respond(['error' => 'Credenziali non valide. Riprova.'], 401); }
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
    $_SESSION['role'] = $user['role'];
    $_SESSION['role_id'] = $user['role_id'] ? (int) $user['role_id'] : null;
    $_SESSION['is_primary_admin'] = (bool) $user['is_primary_admin'];
    
    $_SESSION['client_ip'] = substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
    $_SESSION['client_ua'] = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200);
    $_SESSION['last_activity'] = time();
    
    $updateQuery = $pdo->prepare('UPDATE users SET last_login = UTC_TIMESTAMP() WHERE id = ?');
    $updateQuery->execute([$user['id']]);

    respond(['user' => userPayload($user, $pdo), 'state' => stateForUser($pdo, (int) $user['id'])]);
}

if ($action === 'change_credentials' && $method === 'POST') {
    $userId = authenticatedUserId();
    $pdo = database();
    requireCsrf($pdo);
    $body = requestBody();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    if (!validEmail($email) || !preg_match('/^(?=.*[A-Za-z])(?=.*[\d\W]).{8,}$/', $password)) respond(['error' => 'Inserisci una mail valida e una password di almeno 8 caratteri contenente almeno un numero o simbolo.'], 422);
    $exists = $pdo->prepare('SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1');
    $exists->execute([$email, $userId]);
    if ($exists->fetch()) respond(['error' => 'Questa mail è già associata a un altro utente.'], 409);
    $query = $pdo->prepare('UPDATE users SET username = ?, password_hash = ?, must_change_credentials = 0, updated_at = UTC_TIMESTAMP() WHERE id = ? AND is_active = 1 AND deleted_at IS NULL');
    $query->execute([$email, password_hash($password, PASSWORD_DEFAULT), $userId]);
    auditLog($pdo, 'credentials_changed', 'info', $userId);
    $userQuery = $pdo->prepare('SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.is_primary_admin, u.must_change_credentials, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1');
    $userQuery->execute([$userId]);
    respond(['user' => userPayload($userQuery->fetch(), $pdo), 'state' => stateForUser($pdo, $userId)]);
}

if ($action === 'request_registration' && $method === 'POST') {
    $body = requestBody();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $displayName = trim((string) ($body['displayName'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if (!validEmail($email) || $displayName === '' || strlen($displayName) > 160 || !preg_match('/^(?=.*[A-Za-z])(?=.*[\d\W]).{8,}$/', $password)) respond(['error' => 'Inserisci un nome, una mail valida e una password di almeno 8 caratteri contenente almeno un numero o simbolo.'], 422);
    $pdo = database();
    rateLimit($pdo, 'registration_request', 5);
    $userQuery = $pdo->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
    $userQuery->execute([$email]);
    if ($userQuery->fetch() || pendingRequestExists($pdo, 'registration_requests', $email)) respond(['error' => 'Esiste già una richiesta o un utente con questa mail.'], 409);
    $query = $pdo->prepare('INSERT INTO registration_requests (email, display_name, password_hash) VALUES (?, ?, ?)');
    $query->execute([$email, $displayName, password_hash($password, PASSWORD_DEFAULT)]);
    respond(['ok' => true, 'message' => 'Richiesta inviata. Attendi l’autorizzazione dell’amministratore principale.']);
}

if ($action === 'request_password_reset' && $method === 'POST') {
    $email = strtolower(trim((string) (requestBody()['email'] ?? '')));
    if (!validEmail($email)) respond(['error' => 'Inserisci una mail valida.'], 422);
    $pdo = database();
    rateLimit($pdo, 'password_reset_request', 5);
    $userQuery = $pdo->prepare('SELECT id FROM users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1');
    $userQuery->execute([$email]);
    $userId = $userQuery->fetchColumn();
    if ($userId && !pendingRequestExists($pdo, 'password_reset_requests', $email)) {
        $query = $pdo->prepare('INSERT INTO password_reset_requests (user_id, email) VALUES (?, ?)');
        $query->execute([(int) $userId, $email]);
    }
    respond(['ok' => true, 'message' => 'Se la mail è registrata, la richiesta è stata inoltrata all’amministratore principale.']);
}

if ($action === 'logout' && $method === 'POST') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool) $params['secure'], (bool) $params['httponly']);
    }
    session_destroy();
    respond(['ok' => true]);
}

$userId = authenticatedUserId();
$pdo = database();
if ($method === 'POST') requireCsrf($pdo);

if ($action === 'state' && $method === 'GET') {
    $query = $pdo->prepare('SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.is_primary_admin, u.must_change_credentials, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1');
    $query->execute([$userId]);
    $user = $query->fetch();
    respond(['user' => userPayload($user, $pdo), 'state' => stateForUser($pdo, $userId)]);
}

if ($action === 'security_logs' && $method === 'GET') {
    if (!hasPermission($pdo, $userId, 'logs', 'view')) respond(['error' => 'Non hai il permesso di consultare i log di sicurezza.'], 403);
    $logs = $pdo->query('SELECT l.id, l.event_type, l.severity, l.ip_address, l.details, l.created_at, u.username FROM security_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 500')->fetchAll();
    respond(['logs' => $logs]);
}

if ($action === 'admin_data' && $method === 'GET') {
    requirePrimaryAdmin();
    $users = $pdo->query('SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.is_primary_admin, u.is_active, r.name AS role_name, u.created_at FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.deleted_at IS NULL ORDER BY u.display_name, u.username')->fetchAll();
    $deletedUsers = $pdo->query('SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.is_primary_admin, u.deleted_at, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.deleted_at IS NOT NULL ORDER BY u.deleted_at DESC')->fetchAll();
    $roles = $pdo->query("SELECT id, name, role_key, is_system FROM roles WHERE role_key NOT IN ('guest', 'reader', 'editor') ORDER BY is_system DESC, name")->fetchAll();
    $permissions = $pdo->query('SELECT id, permission_key, label, permission_group FROM permissions ORDER BY permission_group, label')->fetchAll();
    $rolePermissions = $pdo->query('SELECT role_id, permission_id, can_view, can_create, can_edit, can_delete, can_restore, can_purge, can_approve, can_download FROM role_permissions')->fetchAll();
    $registrations = $pdo->query("SELECT id, email, display_name, created_at FROM registration_requests WHERE status = 'pending' ORDER BY created_at")->fetchAll();
    $resets = $pdo->query("SELECT id, email, created_at FROM password_reset_requests WHERE status = 'pending' ORDER BY created_at")->fetchAll();

    $userPayloads = function (array $rows) use ($pdo): array {
        return array_map(function (array $user) use ($pdo): array {
            return userPayload($user, $pdo);
        }, $rows);
    };

    respond([
        'users' => $userPayloads($users),
        'deletedUsers' => $userPayloads($deletedUsers),
        'roles' => $roles,
        'permissions' => $permissions,
        'rolePermissions' => $rolePermissions,
        'registrations' => $registrations,
        'resets' => $resets,
    ]);
}

if ($action === 'create_role' && $method === 'POST') {
    requirePrimaryAdmin();
    $name = trim((string) (requestBody()['name'] ?? ''));
    if ($name === '' || strlen($name) > 120) respond(['error' => 'Inserisci un nome ruolo valido.'], 422);
    $key = 'custom_' . bin2hex(random_bytes(8));
    $query = $pdo->prepare('INSERT INTO roles (name, role_key, is_system) VALUES (?, ?, 0)');
    $query->execute([$name, $key]);
    auditLog($pdo, 'role_created', 'info', (int) $_SESSION['user_id'], ['name' => $name]);
    respond(['ok' => true]);
}

if ($action === 'save_role_permissions' && $method === 'POST') {
    requirePrimaryAdmin();
    $body = requestBody();
    $roleId = (int) ($body['roleId'] ?? 0);
    $permissions = is_array($body['permissions'] ?? null) ? $body['permissions'] : [];
    $roleQuery = $pdo->prepare('SELECT id FROM roles WHERE id = ? LIMIT 1');
    $roleQuery->execute([$roleId]);
    if (!$roleQuery->fetch()) respond(['error' => 'Ruolo non trovato.'], 404);
    $pdo->beginTransaction();
    $delete = $pdo->prepare('DELETE FROM role_permissions WHERE role_id = ?');
    $delete->execute([$roleId]);
    $insert = $pdo->prepare('INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, can_restore, can_purge, can_approve, can_download) SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ? FROM permissions WHERE permission_key = ?');
    foreach ($permissions as $permissionKey => $values) $insert->execute([$roleId, !empty($values['view']), !empty($values['create']), !empty($values['edit']), !empty($values['delete']), !empty($values['restore']), !empty($values['purge']), !empty($values['approve']), !empty($values['download']), $permissionKey]);
    $pdo->commit();
    auditLog($pdo, 'role_permissions_updated', 'info', (int) $_SESSION['user_id'], ['role_id' => $roleId]);
    respond(['ok' => true]);
}

if ($action === 'approve_registration' && $method === 'POST') {
    $adminId = requirePrimaryAdmin();
    $body = requestBody();
    $requestId = (int) ($body['requestId'] ?? 0);
    $roleId = (int) ($body['roleId'] ?? 0);
    $roleQuery = $pdo->prepare('SELECT id FROM roles WHERE id = ? LIMIT 1');
    $roleQuery->execute([$roleId]);
    if (!$roleQuery->fetch()) respond(['error' => 'Seleziona un ruolo valido.'], 422);
    $query = $pdo->prepare("SELECT * FROM registration_requests WHERE id = ? AND status = 'pending' LIMIT 1");
    $query->execute([$requestId]);
    $request = $query->fetch();
    if (!$request) respond(['error' => 'Richiesta non trovata.'], 404);
    $pdo->beginTransaction();
    try {
        $create = $pdo->prepare('INSERT INTO users (username, password_hash, display_name, role, role_id) VALUES (?, ?, ?, ?, ?)');
        $create->execute([$request['email'], $request['password_hash'], $request['display_name'], 'reader', $roleId]);
        $update = $pdo->prepare("UPDATE registration_requests SET status = 'approved', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?");
        $update->execute([$adminId, $requestId]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        respond(['error' => 'Impossibile autorizzare la richiesta. La mail potrebbe essere già in uso.'], 409);
    }
    respond(['ok' => true]);
}

if ($action === 'reject_registration' && $method === 'POST') {
    $adminId = requirePrimaryAdmin();
    $query = $pdo->prepare("UPDATE registration_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'");
    $query->execute([$adminId, (int) (requestBody()['requestId'] ?? 0)]);
    respond(['ok' => $query->rowCount() > 0]);
}

if ($action === 'approve_password_reset' && $method === 'POST') {
    $adminId = requirePrimaryAdmin();
    $body = requestBody();
    $requestId = (int) ($body['requestId'] ?? 0);
    $newPassword = (string) ($body['newPassword'] ?? '');
    if (strlen($newPassword) < 8) respond(['error' => 'La nuova password deve avere almeno 8 caratteri.'], 422);
    $query = $pdo->prepare("SELECT user_id FROM password_reset_requests WHERE id = ? AND status = 'pending' LIMIT 1");
    $query->execute([$requestId]);
    $request = $query->fetch();
    if (!$request) respond(['error' => 'Richiesta non trovata.'], 404);
    $pdo->beginTransaction();
    $updateUser = $pdo->prepare('UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND is_active = 1');
    $updateUser->execute([password_hash($newPassword, PASSWORD_DEFAULT), (int) $request['user_id']]);
    $updateRequest = $pdo->prepare("UPDATE password_reset_requests SET status = 'approved', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?");
    $updateRequest->execute([$adminId, $requestId]);
    $pdo->commit();
    respond(['ok' => true]);
}

if ($action === 'change_user_role' && $method === 'POST') {
    $adminId = requirePrimaryAdmin();
    $body = requestBody();
    $targetId = (int) ($body['userId'] ?? 0);
    $roleId = (int) ($body['roleId'] ?? 0);
    if (!$roleId || $targetId === $adminId) respond(['error' => 'Ruolo o utente non validi.'], 422);
    $query = $pdo->prepare('UPDATE users SET role_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND is_primary_admin = 0 AND deleted_at IS NULL');
    $query->execute([$roleId, $targetId]);
    auditLog($pdo, 'user_role_changed', 'info', $adminId, ['target_user_id' => $targetId, 'role_id' => $roleId]);
    respond(['ok' => $query->rowCount() > 0]);
}

if ($action === 'delete_user' && $method === 'POST') {
    $adminId = requirePrimaryAdmin();
    $targetId = (int) (requestBody()['userId'] ?? 0);
    if ($targetId === $adminId) respond(['error' => 'L’amministratore principale non può eliminare se stesso.'], 422);
    $query = $pdo->prepare('UPDATE users SET is_active = 0, deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ? AND is_primary_admin = 0 AND deleted_at IS NULL');
    $query->execute([$targetId]);
    auditLog($pdo, 'user_deleted', 'warning', $adminId, ['target_user_id' => $targetId]);
    respond(['ok' => $query->rowCount() > 0]);
}

if ($action === 'restore_user' && $method === 'POST') {
    $adminId = requirePrimaryAdmin();
    $targetId = (int) (requestBody()['userId'] ?? 0);
    if ($targetId === $adminId) respond(['error' => 'L’amministratore principale non può ripristinare se stesso.'], 422);
    $query = $pdo->prepare('UPDATE users SET is_active = 1, deleted_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ? AND is_primary_admin = 0 AND deleted_at IS NOT NULL');
    $query->execute([$targetId]);
    auditLog($pdo, 'user_restored', 'info', $adminId, ['target_user_id' => $targetId]);
    respond(['ok' => $query->rowCount() > 0]);
}

if ($action === 'purge_user' && $method === 'POST') {
    $adminId = requirePrimaryAdmin();
    $targetId = (int) (requestBody()['userId'] ?? 0);
    if ($targetId === $adminId) respond(['error' => 'L’amministratore principale non può eliminare definitivamente se stesso.'], 422);
    $target = $pdo->prepare('SELECT id FROM users WHERE id = ? AND is_primary_admin = 0 AND deleted_at IS NOT NULL LIMIT 1');
    $target->execute([$targetId]);
    if (!$target->fetch()) respond(['error' => 'Utente non trovato nel cestino.'], 404);
    $pdo->beginTransaction();
    try {
        $reassignState = $pdo->prepare('UPDATE site_state SET owner_user_id = ? WHERE owner_user_id = ?');
        $reassignState->execute([$adminId, $targetId]);
        $delete = $pdo->prepare('DELETE FROM users WHERE id = ? AND is_primary_admin = 0 AND deleted_at IS NOT NULL');
        $delete->execute([$targetId]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(['error' => 'Impossibile eliminare definitivamente l’utente.'], 500);
    }
    auditLog($pdo, 'user_purged', 'critical', $adminId, ['target_user_id' => $targetId]);
    respond(['ok' => true]);
}

if ($action === 'trash_item' && $method === 'POST') {
    $body = requestBody();
    $entityType = (string) ($body['entityType'] ?? '');
    $entityId = trim((string) ($body['entityId'] ?? ''));
    $parentId = trim((string) ($body['parentId'] ?? ''));
    $config = trashEntityConfig($entityType);
    if (!$config || $entityId === '' || strlen($entityId) > 190 || strlen($parentId) > 190) respond(['error' => 'Elemento del cestino non valido.'], 422);
    if (!hasPermission($pdo, $userId, $config['permission'], 'delete')) respond(['error' => 'Non hai il permesso di spostare questo elemento nel cestino.'], 403);
    $state = stateForTrashMutation($pdo);
    $items =& $state[$config['state_key']];
    $originalIndex = -1;
    $data = null;
    if (isset($config['member_key'])) {
        $parentIndex = stateItemIndex($items, $parentId);
        if ($parentIndex < 0 || !is_array($items[$parentIndex][$config['member_key']] ?? null)) respond(['error' => 'Scheda di origine non trovata.'], 404);
        $members =& $items[$parentIndex][$config['member_key']];
        $originalIndex = stateItemIndex($members, $entityId);
        if ($originalIndex < 0) respond(['error' => 'Elemento non trovato o già eliminato.'], 404);
        $data = $members[$originalIndex];
        array_splice($members, $originalIndex, 1);
        $items[$parentIndex]['updatedAt'] = gmdate('c');
        unset($members);
    } else {
        $originalIndex = stateItemIndex($items, $entityId);
        if ($originalIndex < 0) respond(['error' => 'Elemento non trovato o già eliminato.'], 404);
        $data = $items[$originalIndex];
        updateGoogleTrashState($pdo, $userId, is_array($data) ? $data : [], true);
        array_splice($items, $originalIndex, 1);
    }
    unset($items);
    $state['trash'][] = ['id' => bin2hex(random_bytes(16)), 'entityType' => $entityType, 'permission' => $config['permission'], 'label' => $config['label'], 'deletedAt' => gmdate('c'), 'parentId' => isset($config['member_key']) ? $parentId : '', 'originalIndex' => $originalIndex, 'data' => $data];
    saveTrashMutationState($pdo, $userId, $state);
    auditLog($pdo, 'item_trashed', 'warning', $userId, ['entity_type' => $entityType, 'entity_id' => $entityId, 'parent_id' => $parentId]);
    respond(['ok' => true, 'state' => stateForUser($pdo, $userId)]);
}

if ($action === 'restore_trash_item' && $method === 'POST') {
    $trashId = trim((string) (requestBody()['trashId'] ?? ''));
    if ($trashId === '' || strlen($trashId) > 190) respond(['error' => 'Elemento del cestino non valido.'], 422);
    $state = stateForTrashMutation($pdo);
    $trashIndex = stateItemIndex($state['trash'], $trashId);
    if ($trashIndex < 0) respond(['error' => 'Elemento non trovato nel cestino.'], 404);
    $entry = $state['trash'][$trashIndex];
    $config = trashEntityConfig((string) ($entry['entityType'] ?? ''));
    if (!$config || !is_array($entry['data'] ?? null)) respond(['error' => 'Elemento del cestino non ripristinabile.'], 422);
    if (!hasPermission($pdo, $userId, $config['permission'], 'restore')) respond(['error' => 'Non hai il permesso di ripristinare questo elemento.'], 403);
    $items =& $state[$config['state_key']];
    $dataId = (string) ($entry['data']['id'] ?? '');
    if ($dataId === '') respond(['error' => 'Elemento del cestino non valido.'], 422);
    if (isset($config['member_key'])) {
        $parentIndex = stateItemIndex($items, (string) ($entry['parentId'] ?? ''));
        if ($parentIndex < 0) respond(['error' => 'Impossibile ripristinare il componente: ripristina prima la relativa scheda.'], 409);
        if (!isset($items[$parentIndex][$config['member_key']]) || !is_array($items[$parentIndex][$config['member_key']])) {
            $items[$parentIndex][$config['member_key']] = [];
        }
        if (stateItemIndex($items[$parentIndex][$config['member_key']], $dataId) >= 0) respond(['error' => 'Elemento già presente nella scheda di origine.'], 409);
        $position = min(max(0, (int) ($entry['originalIndex'] ?? 0)), count($items[$parentIndex][$config['member_key']]));
        array_splice($items[$parentIndex][$config['member_key']], $position, 0, [$entry['data']]);
        $items[$parentIndex]['updatedAt'] = gmdate('c');
    } else {
        updateGoogleTrashState($pdo, $userId, is_array($entry['data']) ? $entry['data'] : [], false);
        if (stateItemIndex($items, $dataId) >= 0) respond(['error' => 'Elemento già presente nell’archivio principale.'], 409);
        $position = min(max(0, (int) ($entry['originalIndex'] ?? 0)), count($items));
        array_splice($items, $position, 0, [$entry['data']]);
    }
    unset($items);
    array_splice($state['trash'], $trashIndex, 1);
    saveTrashMutationState($pdo, $userId, $state);
    auditLog($pdo, 'item_restored', 'info', $userId, ['entity_type' => $entry['entityType'], 'trash_id' => $trashId]);
    respond(['ok' => true, 'state' => stateForUser($pdo, $userId)]);
}

if ($action === 'purge_trash_item' && $method === 'POST') {
    $trashId = trim((string) (requestBody()['trashId'] ?? ''));
    if ($trashId === '' || strlen($trashId) > 190) respond(['error' => 'Elemento del cestino non valido.'], 422);
    $state = stateForTrashMutation($pdo);
    $trashIndex = stateItemIndex($state['trash'], $trashId);
    if ($trashIndex < 0) respond(['error' => 'Elemento non trovato nel cestino.'], 404);
    $entry = $state['trash'][$trashIndex];
    $config = trashEntityConfig((string) ($entry['entityType'] ?? ''));
    if (!$config) respond(['error' => 'Elemento del cestino non eliminabile.'], 422);
    if (!hasPermission($pdo, $userId, $config['permission'], 'purge')) respond(['error' => 'Non hai il permesso di eliminare definitivamente questo elemento.'], 403);
    $title = trashEntryTitle($entry);
    updateGoogleTrashState($pdo, $userId, is_array($entry['data']) ? $entry['data'] : [], false, true);
    array_splice($state['trash'], $trashIndex, 1);
    saveTrashMutationState($pdo, $userId, $state);
    auditLog($pdo, 'item_purged', 'critical', $userId, ['entity_type' => $entry['entityType'], 'trash_id' => $trashId, 'title' => $title]);
    respond(['ok' => true, 'state' => stateForUser($pdo, $userId)]);
}

if ($action === 'save_state' && $method === 'POST') {
    $body = requestBody();
    $permission = preg_replace('/[^a-z_]/', '', (string) ($body['permission'] ?? 'documents')) ?: 'documents';
    if (!hasPermission($pdo, $userId, $permission, 'edit')) respond(['error' => 'Non hai il permesso di modificare questa area.'], 403);
    $encodedState = (string) ($body['state'] ?? '');
    $decodedState = json_decode($encodedState, true);
    if (!is_array($decodedState) || strlen($encodedState) > maxStateBytes()) respond(['error' => 'Stato applicativo non valido.'], 422);
    $decodedState = sanitizeState($decodedState);
    $existingState = rawSiteState($pdo) ?: [];
    // Il cestino può essere modificato esclusivamente dalle azioni dedicate,
    // così non può essere forgiato da un generico salvataggio dell'interfaccia.
    $decodedState['trash'] = is_array($existingState['trash'] ?? null) ? $existingState['trash'] : [];
    if (empty($_SESSION['is_primary_admin'])) {
        foreach (statePermissionMap() as $key => $area) if ($area !== $permission) $decodedState[$key] = $existingState[$key] ?? null;
    }
    $query = $pdo->prepare('INSERT INTO site_state (id, owner_user_id, state_json, updated_at) VALUES (1, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = UTC_TIMESTAMP()');
    $query->execute([$userId, json_encode($decodedState, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    respond(['ok' => true]);
}

respond(['error' => 'Azione non riconosciuta.'], 404);