-- phpMyAdmin SQL Dump
-- version 5.2.0
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Creato il: Set 09, 2026 alle 04:04
-- Versione del server: 8.0.45
-- Versione PHP: 8.0.22

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `my_tecnomagistratura`
--

-- --------------------------------------------------------

--
-- Struttura della tabella `password_reset_requests`
--

CREATE TABLE `password_reset_requests` (
  `id` bigint UNSIGNED NOT NULL,
  `user_id` bigint UNSIGNED NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewed_by` bigint UNSIGNED DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `permissions`
--

CREATE TABLE `permissions` (
  `id` bigint UNSIGNED NOT NULL,
  `permission_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `permission_group` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'generale'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dump dei dati per la tabella `permissions`
--

INSERT INTO `permissions` (`id`, `permission_key`, `label`, `permission_group`) VALUES
(1, 'documents', 'Documenti', 'contenuti'),
(2, 'templates', 'Modelli', 'contenuti'),
(3, 'settings', 'Impostazioni & Categorie', 'configurazione'),
(4, 'parties', 'Parti & Campi parte', 'soggetti'),
(5, 'companies', 'Aziende', 'soggetti'),
(6, 'parliament', 'Parlamento', 'organi'),
(7, 'government', 'Governo', 'organi'),
(8, 'composition', 'Composizione della Corte', 'organi'),
(9, 'interpretations', 'Interpretazioni', 'contenuti'),
(10, 'users', 'Gestione utenti', 'amministrazione'),
(11, 'roles', 'Gestione ruoli', 'amministrazione'),
(12, 'logs', 'Log di sicurezza', 'amministrazione');

-- --------------------------------------------------------

--
-- Struttura della tabella `registration_requests`
--

CREATE TABLE `registration_requests` (
  `id` bigint UNSIGNED NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewed_by` bigint UNSIGNED DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `roles`
--

CREATE TABLE `roles` (
  `id` bigint UNSIGNED NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_system` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dump dei dati per la tabella `roles`
--

INSERT INTO `roles` (`id`, `name`, `role_key`, `is_system`) VALUES
(1, 'Ospite', 'guest', 1),
(2, 'Lettore', 'reader', 1),
(3, 'Editor', 'editor', 1),
(4, 'Amministratore', 'admin', 1);

-- --------------------------------------------------------

--
-- Struttura della tabella `role_permissions`
--

CREATE TABLE `role_permissions` (
  `role_id` bigint UNSIGNED NOT NULL,
  `permission_id` bigint UNSIGNED NOT NULL,
  `can_view` tinyint(1) NOT NULL DEFAULT '0',
  `can_create` tinyint(1) NOT NULL DEFAULT '0',
  `can_edit` tinyint(1) NOT NULL DEFAULT '0',
  `can_delete` tinyint(1) NOT NULL DEFAULT '0',
  `can_purge` tinyint(1) NOT NULL DEFAULT '0',
  `can_restore` tinyint(1) NOT NULL DEFAULT '0',
  `can_approve` tinyint(1) NOT NULL DEFAULT '0',
  `can_download` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dump dei dati per la tabella `role_permissions`
--

INSERT INTO `role_permissions` (`role_id`, `permission_id`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_purge`, `can_restore`, `can_approve`, `can_download`) VALUES
(4, 1, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 2, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 3, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 4, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 5, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 6, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 7, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 8, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 9, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 10, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 11, 1, 1, 1, 1, 0, 0, 1, 1),
(4, 12, 1, 1, 1, 1, 0, 0, 1, 1);

UPDATE `role_permissions`
SET `can_view` = 1, `can_create` = 1, `can_edit` = 1, `can_delete` = 1,
    `can_purge` = 1, `can_restore` = 1, `can_approve` = 1, `can_download` = 1
WHERE `role_id` = 4;

-- --------------------------------------------------------

--
-- Struttura della tabella `security_logs`
--

CREATE TABLE `security_logs` (
  `id` bigint UNSIGNED NOT NULL,
  `user_id` bigint UNSIGNED DEFAULT NULL,
  `event_type` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('info','warning','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'info',
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `details` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `site_state`
--

CREATE TABLE `site_state` (
  `id` bigint UNSIGNED NOT NULL,
  `owner_user_id` bigint UNSIGNED NOT NULL,
  `state_json` json NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dump dei dati per la tabella `site_state`
--

INSERT INTO `site_state` (`id`, `owner_user_id`, `state_json`, `updated_at`) VALUES
(1, 1, '{\"trash\": [], \"parties\": [], \"counters\": [], \"companies\": [], \"documents\": [], \"templates\": [], \"categories\": [{\"name\": \"ODG\"}], \"demoSeeded\": false, \"governments\": [], \"pageMargins\": {\"top\": 10, \"left\": 10, \"right\": 10, \"bottom\": 10}, \"parliaments\": [], \"partyFields\": [], \"interpretations\": [], \"courtCompositions\": [], \"testMandateSeeded\": false, \"governmentSettings\": {\"roles\": [{\"id\": \"presidente\", \"name\": \"Ruolo\", \"limit\": 1}]}, \"parliamentSettings\": {\"roles\": [{\"id\": \"sostituto\", \"name\": \"Ruolo\", \"limit\": 1}], \"fields\": []}, \"compositionSettings\": {\"roles\": [{\"id\": \"presidente\", \"name\": \"Ruolo\", \"limit\": 1}]}, \"interpretationSettings\": {\"fields\": []}}', '2026-09-09 01:54:43');

-- --------------------------------------------------------

--
-- Struttura della tabella `google_connections`
--

CREATE TABLE `google_connections` (
  `user_id` bigint UNSIGNED NOT NULL,
  `google_email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `refresh_token` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET foreign_key_checks = 0;


-- --------------------------------------------------------

--
-- Struttura della tabella `users`
--

CREATE TABLE `users` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('admin','editor','reader') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'reader',
  `role_id` bigint UNSIGNED DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `is_primary_admin` tinyint(1) NOT NULL DEFAULT '0',
  `must_change_credentials` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `google_watch_channels` (
  `channel_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `resource_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint UNSIGNED NOT NULL,
  `document_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiration` bigint UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`channel_id`),
  KEY `idx_google_watch_document` (`document_id`),
  KEY `idx_google_watch_user` (`user_id`),
  CONSTRAINT `fk_google_watch_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET foreign_key_checks = 1;
--
-- Dump dei dati per la tabella `users`
--

INSERT INTO `users` (`id`, `username`, `password_hash`, `display_name`, `role`, `role_id`, `is_active`, `is_primary_admin`, `must_change_credentials`, `deleted_at`, `created_at`, `updated_at`) VALUES
(1, 'thecyber0000@gmail.com', '$2y$10$xq38BPGbj0OZL8gOnG99aOsSzY1.PXWFWvJ6IELvLEqEJa1TLkPHC', 'TheCyber_', 'admin', 4, 1, 1, 0, NULL, '2026-09-08 19:16:22', '2026-09-08 19:16:22');

--
-- Indici per le tabelle scaricate
--

--
-- Indici per le tabelle `password_reset_requests`
--
ALTER TABLE `password_reset_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_prr_user` (`user_id`),
  ADD KEY `fk_prr_reviewer` (`reviewed_by`);

--
-- Indici per le tabelle `permissions`
--
ALTER TABLE `permissions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_permissions_key` (`permission_key`);

--
-- Indici per le tabelle `registration_requests`
--
ALTER TABLE `registration_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_rr_reviewer` (`reviewed_by`);

--
-- Indici per le tabelle `roles`
--
ALTER TABLE `roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_roles_key` (`role_key`);

--
-- Indici per le tabelle `role_permissions`
--
ALTER TABLE `role_permissions`
  ADD PRIMARY KEY (`role_id`,`permission_id`),
  ADD KEY `fk_rp_perm` (`permission_id`);

--
-- Indici per le tabelle `security_logs`
--
ALTER TABLE `security_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_logs_event` (`event_type`),
  ADD KEY `idx_logs_ip` (`ip_address`),
  ADD KEY `idx_logs_time` (`created_at`),
  ADD KEY `fk_logs_user` (`user_id`);

--
-- Indici per le tabelle `site_state`
--
ALTER TABLE `site_state`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_site_state_user` (`owner_user_id`);

--
-- Indici per le tabelle `users`
--
-- Primary key and unique username index already defined in CREATE TABLE; skipped

--
-- Indici per la tabella `google_connections`
--
ALTER TABLE `google_connections`
  ADD PRIMARY KEY (`user_id`),
  ADD KEY `idx_google_email` (`google_email`);

--
-- AUTO_INCREMENT per le tabelle scaricate
--

--
-- AUTO_INCREMENT per la tabella `password_reset_requests`
--
ALTER TABLE `password_reset_requests`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `permissions`
--
ALTER TABLE `permissions`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT per la tabella `registration_requests`
--
ALTER TABLE `registration_requests`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `roles`
--
ALTER TABLE `roles`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT per la tabella `security_logs`
--
ALTER TABLE `security_logs`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `site_state`
--
ALTER TABLE `site_state`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT per la tabella `users`
--
ALTER TABLE `users`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- Limiti per le tabelle scaricate
--

--
-- Limiti per la tabella `password_reset_requests`
--
ALTER TABLE `password_reset_requests`
  ADD CONSTRAINT `fk_prr_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_prr_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Limiti per la tabella `registration_requests`
--
ALTER TABLE `registration_requests`
  ADD CONSTRAINT `fk_rr_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Limiti per la tabella `role_permissions`
--
ALTER TABLE `role_permissions`
  ADD CONSTRAINT `fk_rp_perm` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE;

--
-- Limiti per la tabella `security_logs`
--
ALTER TABLE `security_logs`
  ADD CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Limiti per la tabella `site_state`
--
ALTER TABLE `site_state`
  ADD CONSTRAINT `fk_site_state_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`);

--
-- Limiti per la tabella `google_connections`
--
ALTER TABLE `google_connections`
  ADD CONSTRAINT `fk_google_connections_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
