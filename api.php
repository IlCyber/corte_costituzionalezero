<?php
declare(strict_types=1);

require_once __DIR__ . '/private/config.php';

session_name(SESSION_NAME);
session_set_cookie_params([
    'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Lax',
]);
session_start();
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
    $allowedTags = '<p><br><strong><b><em><i><u><ol><ul><li><h1><h2><h3><h4><blockquote><table><tbody><tr><td><hr><a><img><span><div><font>';
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
    foreach ($state['documents'] ?? [] as &$document) if (isset($document['body'])) $document['body'] = sanitizeRichHtml((string) $document['body']);
    foreach ($state['templates'] ?? [] as &$template) if (isset($template['body'])) $template['body'] = sanitizeRichHtml((string) $template['body']);
    foreach ($state['parties'] ?? [] as &$party) if (isset($party['statute'])) $party['statute'] = sanitizeRichHtml((string) $party['statute']);
    foreach ($state['companies'] ?? [] as &$company) if (isset($company['regulation'])) $company['regulation'] = sanitizeRichHtml((string) $company['regulation']);
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
    return ['documents' => 'documents', 'templates' => 'templates', 'counters' => 'settings', 'categories' => 'settings', 'parties' => 'parties', 'partyFields' => 'parties', 'companies' => 'companies', 'parliaments' => 'parliament', 'parliamentSettings' => 'parliament', 'governments' => 'government', 'governmentSettings' => 'government', 'courtCompositions' => 'composition', 'compositionSettings' => 'composition', 'interpretations' => 'interpretations', 'interpretationSettings' => 'interpretations'];
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
    foreach (['documents', 'templates', 'parties', 'companies', 'parliaments', 'governments', 'courtCompositions', 'interpretations'] as $key) {
        if (!isset($state[$key]) || !is_array($state[$key])) $state[$key] = [];
    }
    if (!isset($state['trash']) || !is_array($state['trash'])) $state['trash'] = [];
    return $state;
}

function saveTrashMutationState(PDO $pdo, int $userId, array $state): void
{
    $state = sanitizeState($state);
    $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($encoded) || strlen($encoded) > MAX_STATE_BYTES) respond(['error' => 'Stato del cestino non valido o troppo grande.'], 422);
    $query = $pdo->prepare('INSERT INTO site_state (id, owner_user_id, state_json, updated_at) VALUES (1, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = UTC_TIMESTAMP()');
    $query->execute([$userId, $encoded]);
}

function trashEntryTitle(array $entry): string
{
    $data = is_array($entry['data'] ?? null) ? $entry['data'] : [];
    return substr((string) ($data['title'] ?? $data['name'] ?? $data['legislation'] ?? $data['period'] ?? $entry['label'] ?? 'Elemento'), 0, 160);
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

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
    respond(['user' => userPayload($user, $pdo), 'state' => stateForUser($pdo, (int) $user['id'])]);
}

if ($action === 'change_credentials' && $method === 'POST') {
    $userId = authenticatedUserId();
    $pdo = database();
    requireCsrf($pdo);
    $body = requestBody();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    if (!validEmail($email) || strlen($password) < 8) respond(['error' => 'Inserisci una mail valida e una password di almeno 8 caratteri.'], 422);
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
    if (!validEmail($email) || $displayName === '' || strlen($displayName) > 160 || strlen($password) < 8) respond(['error' => 'Inserisci un nome, una mail valida e una password di almeno 8 caratteri.'], 422);
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

if ($action === 'admin_data' && $method === 'GET') {
    requirePrimaryAdmin();
    $users = $pdo->query('SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.is_primary_admin, u.is_active, r.name AS role_name, u.created_at FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.deleted_at IS NULL ORDER BY u.display_name, u.username')->fetchAll();
    $deletedUsers = $pdo->query('SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.is_primary_admin, u.deleted_at, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.deleted_at IS NOT NULL ORDER BY u.deleted_at DESC')->fetchAll();
    $roles = $pdo->query('SELECT id, name, role_key, is_system FROM roles ORDER BY is_system DESC, name')->fetchAll();
    $permissions = $pdo->query('SELECT id, permission_key, label, permission_group FROM permissions ORDER BY permission_group, label')->fetchAll();
    $rolePermissions = $pdo->query('SELECT role_id, permission_id, can_view, can_create, can_edit, can_delete, can_restore, can_purge, can_approve, can_download FROM role_permissions')->fetchAll();
    $registrations = $pdo->query("SELECT id, email, display_name, created_at FROM registration_requests WHERE status = 'pending' ORDER BY created_at")->fetchAll();
    $resets = $pdo->query("SELECT id, email, created_at FROM password_reset_requests WHERE status = 'pending' ORDER BY created_at")->fetchAll();
    $logs = $pdo->query('SELECT l.id, l.event_type, l.severity, l.ip_address, l.details, l.created_at, u.username FROM security_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 200')->fetchAll();

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
        'logs' => $logs,
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
    if (!$roleQuery->fetch()) $roleId = (int) $pdo->query("SELECT id FROM roles WHERE role_key = 'guest' LIMIT 1")->fetchColumn();
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
    if (!is_array($decodedState) || strlen($encodedState) > MAX_STATE_BYTES) respond(['error' => 'Stato applicativo non valido.'], 422);
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
