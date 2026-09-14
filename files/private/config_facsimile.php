<?php
declare(strict_types=1);

/* Copiare questo file su Altervista e inserire i dati del database. */
const DB_HOST = 'BOH';
const DB_NAME = 'BOH';
const DB_USER = 'BOH';
const DB_PASSWORD = 'BOH';
const SESSION_NAME = 'BOH';
const MAX_STATE_BYTES = 'BOH';
const GOOGLE_DRIVE_FOLDER_ID = 'BOH';
const GOOGLE_CLIENT_ID = 'BOH';
const GOOGLE_CLIENT_SECRET = 'BOH';
const GOOGLE_REDIRECT_URI = 'BOH';
const GOOGLE_WEBHOOK_URI = 'BOH';
const GOOGLE_API_TIMEOUT = 'BOH';

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