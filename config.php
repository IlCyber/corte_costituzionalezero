<?php
declare(strict_types=1);

/* Copiare questo file su Altervista e inserire i dati del database. */
const DB_HOST = 'localhost';
const DB_NAME = 'my_cortecostituzionalezero';
const DB_USER = 'root';
const DB_PASSWORD = '';
const SESSION_NAME = 'cz_session';
const MAX_STATE_BYTES = 15000000;
const GOOGLE_DRIVE_FOLDER_ID = '165UMB_FmyzfQfsBypXJDj1lXUFuAEv0L';
const GOOGLE_CLIENT_ID = '258222479900-aec10pkl76ijlq7qkevfp06suj56bkiu.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_REDIRECT_URI = 'https://cortecostituzionalezero.altervista.org/api.php?action=google_callback';
const GOOGLE_WEBHOOK_URI = 'https://cortecostituzionalezero.altervista.org/api.php?action=google_webhook';
const GOOGLE_API_TIMEOUT = 20;

/*
 * Impostazioni facoltative: se mancano, api.php usa questi stessi valori
 * predefiniti, quindi le installazioni già attive continuano a funzionare.
 */

/* Cifre dei progressivi: 5 produce 00001, 00002, ... */
const DOCUMENT_NUMBER_PADDING = 5;

/* Secondi minimi fra due riallineamenti automatici dei nomi Google (0 li disattiva). */
const GOOGLE_NAME_SYNC_INTERVAL = 120;

/* Quanti file fuori dalla cartella configurata interrogare singolarmente per sincronizzazione. */
const GOOGLE_SYNC_MAX_LOOKUPS = 40;