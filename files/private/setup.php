<?php
declare(strict_types=1);

/**
 * setup.php — Primo accesso / Creazione amministratore
 *
 * Questo script è attivo SOLO se nel database non esiste ancora alcun utente
 * con is_primary_admin = 1. Una volta creato il primo admin, restituisce 403.
 *
 * DOPO L'USO: Elimina o rinomina questo file dal server.
 */

require_once __DIR__ . '/private/config.php';

const SETUP_MIN_PASSWORD_LEN = 8;

// ─── Elenco completo dei permessi del sistema ─────────────────────────────────
// Questi corrispondono ai permission_key usati da api.php e statePermissionMap()
const ALL_PERMISSIONS = [
    // [key, label, group]
    ['documents',      'Documenti',                    'contenuti'],
    ['templates',      'Modelli',                      'contenuti'],
    ['useful_links',   'Link utili',                   'contenuti'],
    ['settings',       'Impostazioni & Categorie',     'configurazione'],
    ['parties',        'Parti & Campi parte',          'soggetti'],
    ['companies',      'Aziende',                      'soggetti'],
    ['parliament',     'Parlamento',                   'organi'],
    ['government',     'Governo',                      'organi'],
    ['composition',    'Composizione della Corte',     'organi'],
    ['interpretations','Interpretazioni',              'contenuti'],
    ['users',          'Gestione utenti',              'amministrazione'],
    ['roles',          'Gestione ruoli',               'amministrazione'],
    ['logs',           'Log di sicurezza',             'amministrazione'],
];

// ─── Funzioni helper ──────────────────────────────────────────────────────────

function setupDb(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    if (str_contains(DB_NAME, 'INSERISCI_')) {
        setupError('Il database non è ancora configurato. Modifica <code>private/config.php</code> prima di procedere.');
    }
    try {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASSWORD,
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]
        );
        return $pdo;
    } catch (Throwable $e) {
        setupError('Connessione al database fallita: <code>' . htmlspecialchars($e->getMessage()) . '</code>');
    }
}

function adminAlreadyExists(PDO $pdo): bool
{
    try {
        $q = $pdo->query('SELECT COUNT(*) FROM users WHERE is_primary_admin = 1 LIMIT 1');
        return (int) $q->fetchColumn() > 0;
    } catch (Throwable) {
        return false;
    }
}

function validEmail(string $email): bool
{
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false && strlen($email) <= 190;
}

function setupError(string $message): never
{
    http_response_code(500);
    renderPage('Errore di configurazione', '', $message);
    exit;
}

// ─── Seeding permessi e ruoli ─────────────────────────────────────────────────

function ensureSchemaAndSeed(PDO $pdo): void
{
    // Colonne aggiuntive nella tabella users (compatibilità schema base)
    $extraCols = [
        'role_id'                 => 'ALTER TABLE users ADD COLUMN role_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER role',
        'is_primary_admin'        => 'ALTER TABLE users ADD COLUMN is_primary_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active',
        'must_change_credentials' => 'ALTER TABLE users ADD COLUMN must_change_credentials TINYINT(1) NOT NULL DEFAULT 0 AFTER is_primary_admin',
        'deleted_at'              => 'ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL AFTER updated_at',
    ];
    foreach ($extraCols as $col => $sql) {
        $exists = $pdo->query("SHOW COLUMNS FROM users LIKE '{$col}'")->fetchAll();
        if (empty($exists)) $pdo->exec($sql);
    }

    // Tabella roles
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS roles (
            id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name      VARCHAR(120) NOT NULL,
            role_key  VARCHAR(120) NOT NULL,
            is_system TINYINT(1)   NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY uq_roles_key (role_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Ruoli di sistema
    $pdo->exec("
        INSERT IGNORE INTO roles (name, role_key, is_system) VALUES
            ('Ospite',          'guest',  1),
            ('Lettore',         'reader', 1),
            ('Editor',          'editor', 1),
            ('Amministratore',  'admin',  1)
    ");

    // Tabella permissions
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS permissions (
            id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            permission_key   VARCHAR(80)  NOT NULL,
            label            VARCHAR(160) NOT NULL,
            permission_group VARCHAR(80)  NOT NULL DEFAULT 'generale',
            PRIMARY KEY (id),
            UNIQUE KEY uq_permissions_key (permission_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Inserisci/aggiorna tutti i permessi del sistema
    $upsertPerm = $pdo->prepare(
        'INSERT INTO permissions (permission_key, label, permission_group)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE label = VALUES(label), permission_group = VALUES(permission_group)'
    );
    foreach (ALL_PERMISSIONS as [$key, $label, $group]) {
        $upsertPerm->execute([$key, $label, $group]);
    }

    // Tabella role_permissions
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS role_permissions (
            role_id       BIGINT UNSIGNED NOT NULL,
            permission_id BIGINT UNSIGNED NOT NULL,
            can_view      TINYINT(1) NOT NULL DEFAULT 0,
            can_create    TINYINT(1) NOT NULL DEFAULT 0,
            can_edit      TINYINT(1) NOT NULL DEFAULT 0,
            can_delete    TINYINT(1) NOT NULL DEFAULT 0,
            can_restore   TINYINT(1) NOT NULL DEFAULT 0,
            can_purge     TINYINT(1) NOT NULL DEFAULT 0,
            can_approve   TINYINT(1) NOT NULL DEFAULT 0,
            can_download  TINYINT(1) NOT NULL DEFAULT 0,
            PRIMARY KEY (role_id, permission_id),
            CONSTRAINT fk_rp_role FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
            CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Permessi aggiunti nelle installazioni già esistenti.
    foreach (['can_restore', 'can_purge'] as $column) {
        $exists = $pdo->query("SHOW COLUMNS FROM role_permissions LIKE '{$column}'")->fetchAll();
        if (empty($exists)) $pdo->exec("ALTER TABLE role_permissions ADD COLUMN {$column} TINYINT(1) NOT NULL DEFAULT 0 AFTER can_delete");
    }

    // Tabella site_state
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS site_state (
            id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            owner_user_id BIGINT UNSIGNED NOT NULL,
            state_json    JSON     NOT NULL,
            updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            CONSTRAINT fk_site_state_user FOREIGN KEY (owner_user_id) REFERENCES users(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Tabella registration_requests
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS registration_requests (
            id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            email         VARCHAR(190) NOT NULL,
            display_name  VARCHAR(160) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
            reviewed_by   BIGINT UNSIGNED NULL DEFAULT NULL,
            reviewed_at   DATETIME NULL DEFAULT NULL,
            created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            CONSTRAINT fk_rr_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Tabella password_reset_requests
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS password_reset_requests (
            id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id     BIGINT UNSIGNED NOT NULL,
            email       VARCHAR(190) NOT NULL,
            status      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
            reviewed_by BIGINT UNSIGNED NULL DEFAULT NULL,
            reviewed_at DATETIME NULL DEFAULT NULL,
            created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            CONSTRAINT fk_prr_user     FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
            CONSTRAINT fk_prr_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Tabella security_logs
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS security_logs (
            id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id    BIGINT UNSIGNED NULL DEFAULT NULL,
            event_type VARCHAR(80)  NOT NULL,
            severity   ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
            ip_address VARCHAR(45)  NOT NULL,
            user_agent VARCHAR(500) NOT NULL DEFAULT '',
            details    JSON NULL DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_logs_event (event_type),
            KEY idx_logs_ip    (ip_address),
            KEY idx_logs_time  (created_at),
            CONSTRAINT fk_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
}

/**
 * Assegna TUTTI i permessi (can_* = 1) al ruolo 'admin' per ogni permission_key.
 * L'account admin usa anche is_primary_admin = 1 che bypassa tutti i check,
 * ma popoliamo il DB così il pannello visualizza i permessi correttamente.
 */
function seedAdminFullPermissions(PDO $pdo, int $adminRoleId): void
{
    $upsert = $pdo->prepare("
        INSERT INTO role_permissions
            (role_id, permission_id, can_view, can_create, can_edit, can_delete, can_restore, can_purge, can_approve, can_download)
        SELECT ?, id, 1, 1, 1, 1, 1, 1, 1, 1
        FROM permissions
        WHERE permission_key = ?
        ON DUPLICATE KEY UPDATE
            can_view = 1, can_create = 1, can_edit = 1,
            can_delete = 1, can_restore = 1, can_purge = 1,
            can_approve = 1, can_download = 1
    ");
    foreach (ALL_PERMISSIONS as [$key, ,]) {
        $upsert->execute([$adminRoleId, $key]);
    }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderPage(string $title, string $successMessage, string $errorMessage, string $csrfToken = ''): void
{
    ?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($title) ?> — Corte Costituzionale</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
            --bg:       #080a10;
            --surface:  #10131c;
            --surface2: #181c28;
            --border:   rgba(255,255,255,.07);
            --accent:   #6366f1;
            --accent-h: #818cf8;
            --accent-g: linear-gradient(135deg, #6366f1, #818cf8);
            --danger:   #ef4444;
            --success:  #22c55e;
            --warn:     #eab308;
            --text:     #e2e8f0;
            --muted:    #64748b;
            --muted2:   #94a3b8;
            --radius:   16px;
            --radius-sm:10px;
        }

        body {
            font-family: 'Inter', system-ui, sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }

        /* Background glow */
        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background:
                radial-gradient(ellipse 90% 50% at 50% -10%, rgba(99,102,241,.14) 0%, transparent 55%),
                radial-gradient(ellipse 50% 50% at 90% 110%, rgba(129,140,248,.08) 0%, transparent 50%);
            pointer-events: none;
            z-index: 0;
        }

        .card {
            position: relative;
            z-index: 1;
            width: 100%;
            max-width: 480px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 44px 44px 40px;
            box-shadow: 0 32px 100px rgba(0,0,0,.6);
            animation: fadeUp .45s cubic-bezier(.16,1,.3,1) both;
        }

        @keyframes fadeUp {
            from { opacity:0; transform:translateY(24px); }
            to   { opacity:1; transform:translateY(0); }
        }

        /* ── Header ── */
        .header {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 32px;
        }

        .logo-icon {
            width: 46px; height: 46px;
            border-radius: 12px;
            background: var(--accent-g);
            display: flex; align-items: center; justify-content: center;
            font-size: 22px;
            flex-shrink: 0;
            box-shadow: 0 6px 24px rgba(99,102,241,.4);
        }

        .header-text h1 {
            font-size: 1rem;
            font-weight: 700;
            letter-spacing: -.01em;
            line-height: 1.2;
        }
        .header-text p {
            font-size: .75rem;
            color: var(--muted2);
            margin-top: 2px;
        }

        .divider { height: 1px; background: var(--border); margin-bottom: 28px; }

        /* ── Chips & badges ── */
        .badge {
            display: inline-flex; align-items: center; gap: 6px;
            background: rgba(99,102,241,.12);
            color: var(--accent-h);
            border: 1px solid rgba(99,102,241,.25);
            border-radius: 20px;
            padding: 4px 12px;
            font-size: .72rem;
            font-weight: 600;
            letter-spacing: .06em;
            text-transform: uppercase;
            margin-bottom: 18px;
        }

        /* ── Typography ── */
        h2 { font-size: 1.6rem; font-weight: 800; letter-spacing: -.03em; margin-bottom: 6px; }
        .subtitle { color: var(--muted2); font-size: .875rem; line-height: 1.55; margin-bottom: 30px; }

        /* ── Permission preview chips ── */
        .perm-list {
            display: flex; flex-wrap: wrap; gap: 6px;
            margin-bottom: 28px;
        }
        .perm-chip {
            display: inline-flex; align-items: center; gap: 5px;
            background: rgba(34,197,94,.08);
            border: 1px solid rgba(34,197,94,.2);
            color: #86efac;
            border-radius: 20px;
            padding: 3px 10px;
            font-size: .72rem;
            font-weight: 500;
        }
        .perm-chip::before { content: '✓'; font-size: .65rem; opacity: .8; }

        /* ── Form fields ── */
        .field { margin-bottom: 18px; }

        label {
            display: block;
            font-size: .8rem;
            font-weight: 600;
            color: var(--muted2);
            margin-bottom: 7px;
            letter-spacing: .02em;
            text-transform: uppercase;
        }

        .input-wrap { position: relative; }

        input[type="text"],
        input[type="email"],
        input[type="password"] {
            width: 100%;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text);
            font-family: inherit;
            font-size: .95rem;
            padding: 11px 42px 11px 42px;
            outline: none;
            transition: border-color .2s, box-shadow .2s, background .2s;
        }
        input:focus {
            border-color: var(--accent);
            background: #1a1f30;
            box-shadow: 0 0 0 3px rgba(99,102,241,.15);
        }
        input::placeholder { color: var(--muted); }

        .field-icon {
            position: absolute; left: 14px; top: 50%;
            transform: translateY(-50%);
            font-size: 15px; opacity: .45;
            pointer-events: none; user-select: none;
        }

        .toggle-pw {
            position: absolute; right: 12px; top: 50%;
            transform: translateY(-50%);
            background: none; border: none;
            color: var(--muted); cursor: pointer;
            font-size: 15px; padding: 4px; line-height: 1;
            transition: color .2s;
        }
        .toggle-pw:hover { color: var(--text); }

        /* ── Password strength ── */
        .strength-bar {
            height: 3px; border-radius: 2px;
            background: rgba(255,255,255,.06);
            margin-top: 8px; overflow: hidden;
        }
        .strength-fill {
            height: 100%; border-radius: 2px;
            transition: width .3s ease, background .3s ease;
            width: 0%;
        }
        .hint {
            font-size: .73rem; color: var(--muted2); margin-top: 5px;
            min-height: 16px; transition: color .2s;
        }

        /* ── Submit button ── */
        .btn {
            width: 100%;
            padding: 13px;
            border: none; border-radius: var(--radius-sm);
            font-family: inherit; font-size: .95rem; font-weight: 700;
            cursor: pointer;
            transition: opacity .2s, transform .15s, box-shadow .2s;
            margin-top: 6px;
            letter-spacing: -.01em;
        }
        .btn:active { transform: scale(.98); }
        .btn-primary {
            background: var(--accent-g);
            color: #fff;
            box-shadow: 0 6px 20px rgba(99,102,241,.35);
        }
        .btn-primary:hover { opacity: .88; box-shadow: 0 8px 28px rgba(99,102,241,.45); }
        .btn-primary:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }

        /* ── Alerts ── */
        .alert {
            border-radius: var(--radius-sm); padding: 13px 15px;
            font-size: .86rem; line-height: 1.5; margin-bottom: 20px;
            display: flex; gap: 10px; align-items: flex-start;
        }
        .alert-error   { background: rgba(239,68,68,.08);  border: 1px solid rgba(239,68,68,.25);  color: #fca5a5; }
        .alert-success { background: rgba(34,197,94,.08);  border: 1px solid rgba(34,197,94,.25);  color: #86efac; }
        .alert-warning { background: rgba(234,179,8,.08);  border: 1px solid rgba(234,179,8,.25);  color: #fde047; }
        .alert-icon { font-size: 15px; flex-shrink: 0; margin-top: 2px; }

        /* ── Footer note ── */
        .footer-note {
            margin-top: 22px;
            padding: 13px 15px;
            background: rgba(234,179,8,.06);
            border: 1px solid rgba(234,179,8,.18);
            border-radius: var(--radius-sm);
            font-size: .78rem; color: #fde04799; line-height: 1.6;
        }
        .footer-note strong { display: block; color: #fde047; margin-bottom: 3px; font-size: .80rem; }

        code {
            background: rgba(255,255,255,.09);
            padding: 1px 6px; border-radius: 4px;
            font-size: .82em;
            font-family: 'Fira Code', 'Consolas', monospace;
            color: var(--accent-h);
        }

        /* ── Success state ── */
        .success-icon {
            font-size: 60px; text-align: center; margin-bottom: 18px;
            animation: pop .5s cubic-bezier(.34,1.56,.64,1) both;
        }
        @keyframes pop { from { transform:scale(.3); opacity:0; } to { transform:scale(1); opacity:1; } }
        .success-card { text-align: center; }

        .step-list {
            text-align: left;
            margin: 18px 0 22px;
            display: flex; flex-direction: column; gap: 10px;
        }
        .step-item {
            display: flex; align-items: flex-start; gap: 12px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 11px 14px;
            font-size: .85rem; line-height: 1.45;
        }
        .step-num {
            flex-shrink: 0;
            width: 22px; height: 22px;
            border-radius: 50%;
            background: var(--accent-g);
            color: #fff;
            font-size: .7rem; font-weight: 700;
            display: flex; align-items: center; justify-content: center;
            margin-top: 1px;
        }

        a.go-btn {
            display: block;
            text-align: center; text-decoration: none;
            padding: 13px;
            background: var(--accent-g);
            color: #fff;
            border-radius: var(--radius-sm);
            font-weight: 700; font-size: .95rem;
            box-shadow: 0 6px 20px rgba(99,102,241,.35);
            transition: opacity .2s, box-shadow .2s;
        }
        a.go-btn:hover { opacity: .88; box-shadow: 0 8px 28px rgba(99,102,241,.45); }

        /* Error/403 page */
        .forbidden { text-align: center; }
        .forbidden .icon { font-size: 52px; margin-bottom: 16px; }
    </style>
</head>
<body>
<div class="card <?= $successMessage ? 'success-card' : '' ?>">
    <div class="header">
        <div class="logo-icon">⚖️</div>
        <div class="header-text">
            <h1>Corte Costituzionale</h1>
            <p>Sistema di gestione documenti</p>
        </div>
    </div>
    <div class="divider"></div>

<?php if ($successMessage): ?>
    <div class="success-icon">✅</div>
    <h2>Setup completato!</h2>
    <p class="subtitle">L'account amministratore principale è stato creato con accesso completo a tutte le aree del sistema.</p>

    <div class="step-list">
        <div class="step-item">
            <div class="step-num">1</div>
            <div>Accedi all'applicazione con le credenziali che hai appena impostato.</div>
        </div>
        <div class="step-item">
            <div class="step-num">2</div>
            <div><strong style="color:#fde047">⚠️ Elimina <code>setup.php</code></strong> dal server — chiunque potrebbe altrimenti sovrascrivere l'account admin se il database venisse svuotato.</div>
        </div>
    </div>

    <a href="index.html" class="go-btn">Vai all'applicazione →</a>

<?php elseif ($errorMessage && !$csrfToken): ?>
    <!-- Errore bloccante (403, DB non configurato, ecc.) -->
    <div class="forbidden">
        <div class="icon">🔒</div>
        <h2>Accesso negato</h2>
        <p class="subtitle" style="margin-bottom:0"><?= $errorMessage ?></p>
    </div>

<?php else: ?>
    <span class="badge">⚡ Primo avvio</span>
    <h2>Crea l'amministratore</h2>
    <p class="subtitle">L'account creato avrà <strong style="color:var(--accent-h)">pieni permessi su tutte le aree</strong> del sistema: documenti, modelli, utenti, ruoli, log e altro.</p>

    <!-- Anteprima permessi garantiti -->
    <div class="perm-list">
        <span class="perm-chip">Documenti</span>
        <span class="perm-chip">Modelli</span>
        <span class="perm-chip">Impostazioni</span>
        <span class="perm-chip">Parti</span>
        <span class="perm-chip">Aziende</span>
        <span class="perm-chip">Parlamento</span>
        <span class="perm-chip">Governo</span>
        <span class="perm-chip">Composizione Corte</span>
        <span class="perm-chip">Interpretazioni</span>
        <span class="perm-chip">Gestione utenti</span>
        <span class="perm-chip">Gestione ruoli</span>
        <span class="perm-chip">Log sicurezza</span>
    </div>

    <?php if ($errorMessage): ?>
        <div class="alert alert-error">
            <span class="alert-icon">✗</span>
            <div><?= $errorMessage ?></div>
        </div>
    <?php endif; ?>

    <form method="POST" id="setupForm" autocomplete="off" novalidate>
        <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrfToken) ?>">

        <div class="field">
            <label for="display_name">Nome visualizzato</label>
            <div class="input-wrap">
                <span class="field-icon">👤</span>
                <input type="text" id="display_name" name="display_name"
                       value="<?= htmlspecialchars($_POST['display_name'] ?? '') ?>"
                       placeholder="Es. Mario Rossi" maxlength="160" required autofocus>
            </div>
        </div>

        <div class="field">
            <label for="email">Email (username di accesso)</label>
            <div class="input-wrap">
                <span class="field-icon">✉️</span>
                <input type="email" id="email" name="email"
                       value="<?= htmlspecialchars($_POST['email'] ?? '') ?>"
                       placeholder="admin@esempio.it" maxlength="190" required>
            </div>
        </div>

        <div class="field">
            <label for="password">Password</label>
            <div class="input-wrap">
                <span class="field-icon">🔒</span>
                <input type="password" id="password" name="password"
                       placeholder="Minimo <?= SETUP_MIN_PASSWORD_LEN ?> caratteri" minlength="<?= SETUP_MIN_PASSWORD_LEN ?>" required>
                <button type="button" class="toggle-pw" onclick="togglePw('password',this)" title="Mostra/nascondi">👁</button>
            </div>
            <div class="strength-bar"><div class="strength-fill" id="strengthFill"></div></div>
            <div class="hint" id="strengthLabel"></div>
        </div>

        <div class="field">
            <label for="password2">Conferma password</label>
            <div class="input-wrap">
                <span class="field-icon">🔒</span>
                <input type="password" id="password2" name="password2"
                       placeholder="Ripeti la password" minlength="<?= SETUP_MIN_PASSWORD_LEN ?>" required>
                <button type="button" class="toggle-pw" onclick="togglePw('password2',this)" title="Mostra/nascondi">👁</button>
            </div>
            <div class="hint" id="matchHint"></div>
        </div>

        <button type="submit" class="btn btn-primary" id="submitBtn">
            Crea amministratore con pieni permessi →
        </button>
    </form>

    <div class="footer-note">
        <strong>⚠️ Sicurezza</strong>
        Questo script è accessibile solo finché non esiste un amministratore principale nel database. Dopo la creazione, <strong>elimina <code>setup.php</code> dal server</strong>.
    </div>
<?php endif; ?>
</div>

<?php if (!$successMessage && $csrfToken): ?>
<script>
function togglePw(id, btn) {
    const inp = document.getElementById(id);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
}

const pwInput   = document.getElementById('password');
const pw2Input  = document.getElementById('password2');
const fill      = document.getElementById('strengthFill');
const sLabel    = document.getElementById('strengthLabel');
const mHint     = document.getElementById('matchHint');
const submitBtn = document.getElementById('submitBtn');

const levels = [
    null,
    { pct:'20%', color:'#ef4444', text:'🔴 Molto debole' },
    { pct:'40%', color:'#f97316', text:'🟠 Debole' },
    { pct:'60%', color:'#eab308', text:'🟡 Discreta' },
    { pct:'80%', color:'#22c55e', text:'🟢 Buona' },
    { pct:'100%',color:'#6366f1', text:'💪 Ottima' },
];

function strength(pw) {
    let s = 0;
    if (pw.length >= <?= SETUP_MIN_PASSWORD_LEN ?>) s++;
    if (pw.length >= 12)          s++;
    if (/[A-Z]/.test(pw))         s++;
    if (/[0-9]/.test(pw))         s++;
    if (/[^A-Za-z0-9]/.test(pw))  s++;
    return s;
}

pwInput.addEventListener('input', () => {
    if (!pwInput.value) {
        fill.style.width = '0%'; sLabel.textContent = ''; return;
    }
    const lvl = levels[strength(pwInput.value)];
    fill.style.width = lvl.pct; fill.style.background = lvl.color;
    sLabel.textContent = lvl.text; sLabel.style.color = '';
    checkMatch();
});

pw2Input.addEventListener('input', checkMatch);

function checkMatch() {
    if (!pw2Input.value) { mHint.textContent = ''; return; }
    const ok = pw2Input.value === pwInput.value;
    mHint.textContent = ok ? '✓ Le password coincidono' : '✗ Le password non coincidono';
    mHint.style.color = ok ? '#86efac' : '#fca5a5';
}

document.getElementById('setupForm').addEventListener('submit', e => {
    const pw = pwInput.value, pw2 = pw2Input.value;
    if (pw !== pw2) {
        e.preventDefault();
        mHint.textContent = '✗ Le password non coincidono'; mHint.style.color = '#fca5a5';
        pw2Input.focus(); return;
    }
    if (pw.length < <?= SETUP_MIN_PASSWORD_LEN ?>) {
        e.preventDefault();
        sLabel.textContent = '✗ Minimo <?= SETUP_MIN_PASSWORD_LEN ?> caratteri'; sLabel.style.color = '#fca5a5';
        pwInput.focus(); return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creazione in corso…';
});
</script>
<?php endif; ?>
</body>
</html>
    <?php
}

// ─── Logica principale ────────────────────────────────────────────────────────

session_name(SESSION_NAME);
session_set_cookie_params(['httponly' => true, 'samesite' => 'Strict']);
session_start();

if (empty($_SESSION['setup_csrf'])) {
    $_SESSION['setup_csrf'] = bin2hex(random_bytes(32));
}
$csrfToken = $_SESSION['setup_csrf'];

$pdo = setupDb();

// ── Blocca se esiste già un primary admin ──────────────────────────────────
if (adminAlreadyExists($pdo)) {
    http_response_code(403);
    renderPage(
        'Accesso negato',
        '',
        'Il setup è già stato completato: esiste un amministratore principale nel database. <strong>Elimina questo file dal server.</strong>'
    );
    exit;
}

$successMessage = '';
$errorMessage   = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Verifica CSRF
    $csrf = trim((string) ($_POST['csrf'] ?? ''));
    if (!$csrf || !hash_equals($_SESSION['setup_csrf'], $csrf)) {
        $errorMessage = 'Token di sicurezza non valido. Ricarica la pagina e riprova.';
    } else {
        $displayName = trim((string) ($_POST['display_name'] ?? ''));
        $email       = strtolower(trim((string) ($_POST['email'] ?? '')));
        $password    = (string) ($_POST['password'] ?? '');
        $password2   = (string) ($_POST['password2'] ?? '');

        if ($displayName === '' || strlen($displayName) > 160) {
            $errorMessage = 'Inserisci un nome visualizzato valido (massimo 160 caratteri).';
        } elseif (!validEmail($email)) {
            $errorMessage = 'Inserisci un indirizzo email valido.';
        } elseif (strlen($password) < SETUP_MIN_PASSWORD_LEN) {
            $errorMessage = 'La password deve contenere almeno ' . SETUP_MIN_PASSWORD_LEN . ' caratteri.';
        } elseif ($password !== $password2) {
            $errorMessage = 'Le due password non coincidono.';
        } else {
            // Controlla email duplicata
            $checkEmail = $pdo->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
            $checkEmail->execute([$email]);
            if ($checkEmail->fetch()) {
                $errorMessage = 'Questa email è già associata a un utente esistente.';
            } elseif (adminAlreadyExists($pdo)) {
                // Race condition: qualcuno ha già creato un admin
                http_response_code(403);
                renderPage('Accesso negato', '', 'Un altro amministratore è stato creato nel frattempo.');
                exit;
            } else {
                try {
                    $pdo->beginTransaction();

                    // 1. Assicura schema completo e seed dati di base
                    ensureSchemaAndSeed($pdo);

                    // 2. Recupera l'ID del ruolo 'admin'
                    $adminRoleRow = $pdo->query("SELECT id FROM roles WHERE role_key = 'admin' LIMIT 1")->fetch();
                    $adminRoleId  = $adminRoleRow ? (int) $adminRoleRow['id'] : null;

                    // 3. Crea l'utente amministratore principale
                    $hash = password_hash($password, PASSWORD_DEFAULT);
                    $insert = $pdo->prepare(
                        'INSERT INTO users
                            (username, password_hash, display_name, role, role_id,
                             is_active, is_primary_admin, must_change_credentials)
                         VALUES (?, ?, ?, \'admin\', ?, 1, 1, 0)'
                    );
                    $insert->execute([$email, $hash, $displayName, $adminRoleId]);
                    $newUserId = (int) $pdo->lastInsertId();

                    // 4. Assegna pieni permessi al ruolo admin nel DB
                    if ($adminRoleId) {
                        seedAdminFullPermissions($pdo, $adminRoleId);
                    }

                    // 5. Log primo setup
                    $logStmt = $pdo->prepare(
                        'INSERT INTO security_logs (user_id, event_type, severity, ip_address, user_agent, details)
                         VALUES (?, \'setup_completed\', \'info\', ?, ?, ?)'
                    );
                    $logStmt->execute([
                        $newUserId,
                        substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45),
                        substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500),
                        json_encode(['email' => $email, 'display_name' => $displayName]),
                    ]);

                    $pdo->commit();

                    // Invalida token CSRF one-shot
                    unset($_SESSION['setup_csrf']);

                    $successMessage = 'ok';
                } catch (Throwable $e) {
                    if ($pdo->inTransaction()) $pdo->rollBack();
                    error_log('Setup error: ' . $e->getMessage());
                    $errorMessage = 'Errore durante la creazione: <code>' . htmlspecialchars($e->getMessage()) . '</code>';
                }
            }
        }
    }
}

renderPage(
    $successMessage ? 'Setup completato' : 'Setup iniziale',
    $successMessage,
    $errorMessage,
    $csrfToken
);
