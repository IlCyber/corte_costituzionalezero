# Casellario digitale della Corte Costituzionale di Zero

Applicazione HTML/CSS/JavaScript per la gestione di un casellario digitale. L’archivio documentale richiede `api.php`, sessioni PHP, MySQL 8.0 e un account Google collegato dalle impostazioni.

## Funzionalita

- Login e logout con e-mail e sessione server.
- Cambio obbligatorio di e-mail e password personali al primo accesso.
- Richieste di registrazione approvate dall'amministratore principale.
- Recupero password sottoposto all'amministratore principale.
- Gestione utenti con ruoli, cambio permessi e disattivazione degli account.
- Ruoli personalizzati con matrice di permessi separata per visualizzazione, creazione, modifica, cestino, ripristino, eliminazione definitiva e approvazione.
- Cestino centralizzato: ogni documento, template, partito, azienda, mandato, componente, scheda di Governo/Corte e interpretazione può essere spostato nel cestino, ripristinato o eliminato definitivamente.
- Permessi distinti per spostare nel cestino, ripristinare ed eliminare definitivamente, applicati sia nell’interfaccia sia nel backend.
- Protezioni applicative con CSRF, rate limiting, CSP, sanificazione HTML, query PDO preparate e log di sicurezza.
- Archivio documenti con categorie, progressivi, ricerca, editor ricco, immagini e stampa.
- Template riutilizzabili.
- ODG con stato Da valutare/Valutato.
- Partiti con stato, campi configurabili, Statuto e storico versioni.
- Aziende con Regolamento e storico versioni.
- Parlamento con mandati, ruoli, nomine, giuramenti e dimissioni.
- Governo e Composizione della Corte con periodi, ruoli, limiti e componenti.
- Interpretazioni con valori base configurabili.
- Persistenza online dell'archivio condiviso tramite MySQL.

## File principali

- [index.html](index.html): interfaccia.
- [styles.css](styles.css): stile responsive.
- [app.js](app.js): logica dell'interfaccia, fallback locale e sincronizzazione API.
- [api.php](api.php): autenticazione, richieste utenti, ruoli, permessi, sessione e persistenza con PDO.
- [private/config.php](private/config.php): configurazione MySQL non esposta direttamente al browser.
- [database.sql](database.sql): query per utenti, ruoli, permessi, richieste, log e archivio MySQL 8.0.
- [GUIDA_UTENTE.md](GUIDA_UTENTE.md): guida funzionale e installazione Altervista.

## Installazione Altervista

1. Importare `database.sql` nel database assegnato da Altervista.
2. Generare un hash con `password_hash('zero2026', PASSWORD_DEFAULT)` e inserirlo nella tabella `users` tramite phpMyAdmin.
3. Configurare le quattro costanti MySQL in `private/config.php`.
4. Caricare i file PHP, HTML, CSS, JavaScript e la cartella `private/` nella stessa cartella.
5. Accedere via HTTPS con l'utente creato.

Dettagli, query e controlli di sicurezza sono descritti in [GUIDA_UTENTE.md](GUIDA_UTENTE.md).

La scheda **Guida** dentro il sito è filtrata in base ai permessi dell'utente. La cartella `private/` contiene la configurazione server. Il progetto non aggiunge file `.htaccess`: la protezione della cartella pubblica va gestita con le impostazioni già presenti su Altervista oppure tenendo `private/config.php` fuori dalla document root. Non è possibile nascondere il codice HTML/CSS/JavaScript consegnato al browser; i controlli reali sono applicati in PHP.

## Nota tecnica

Per mantenere compatibili tutte le funzionalita gia presenti, MySQL salva lo stato applicativo condiviso in `site_state.state_json`. Credenziali e richieste restano relazionate in tabelle separate. Il backend non espone mai MySQL al browser: il browser comunica solo con PHP. Questa e una base funzionante per Altervista; quando il volume dei dati crescera, lo stato potra essere normalizzato in tabelle dedicate senza cambiare il contratto dell'interfaccia.
