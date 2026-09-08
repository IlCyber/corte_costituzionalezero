-- MySQL 8.0 / Altervista
-- Non usare CREATE DATABASE: Altervista assegna gia il database dal pannello.
-- Eseguire questo file nel database assegnato, poi configurare api.php.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  role ENUM('admin', 'editor', 'reader') NOT NULL DEFAULT 'reader',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  state_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_state_user (user_id),
  CONSTRAINT fk_app_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dopo aver generato un hash con password_hash('zero2026', PASSWORD_DEFAULT),
-- inserire l'utente amministratore sostituendo HASH_BCRYPT con l'hash ottenuto.
-- INSERT INTO users (username, password_hash, display_name, role)
-- VALUES ('admin', 'HASH_BCRYPT', 'Amministratore', 'admin');

-- Esempio di aggiornamento di un utente gia esistente:
-- UPDATE users SET password_hash = 'HASH_BCRYPT', role = 'admin', is_active = 1 WHERE username = 'admin';
