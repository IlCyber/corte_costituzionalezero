# Casellario digitale della Corte Costituzionale di Zero

Applicazione HTML/CSS/JavaScript per la gestione di un casellario digitale. L’archivio documentale richiede `api.php`, sessioni PHP, MySQL 8.0 e un account Google collegato dalle impostazioni.

## Funzionalita

- Login e logout con e-mail e sessione server.
- Fallback locale al login: se `api.php` non è raggiungibile (PHP assente, errore fatale o database non configurato) l'accesso avviene con gli utenti salvati nel browser, a partire da `admin@localhost` / `zero2026` con cambio credenziali obbligato; l'errore mostrato è in italiano e indica cosa verificare sul server.
- Cambio obbligatorio di e-mail e password personali al primo accesso.
- Richieste di registrazione approvate dall'amministratore principale.
- Recupero password sottoposto all'amministratore principale.
- Gestione utenti con ruoli, cambio permessi e disattivazione degli account.
- Ruoli personalizzati con matrice di permessi separata per visualizzazione, creazione, modifica, cestino, ripristino, eliminazione definitiva e approvazione.
- Cestino centralizzato: ogni documento, template, partito, azienda, mandato, componente, scheda di Governo/Corte e interpretazione può essere spostato nel cestino, ripristinato o eliminato definitivamente.
- Permessi distinti per spostare nel cestino, ripristinare ed eliminare definitivamente, applicati sia nell’interfaccia sia nel backend.
- Protezioni applicative con CSRF, rate limiting, CSP, sanificazione HTML, query PDO preparate e log di sicurezza.
- Archivio documenti con categorie, progressivi, ricerca, editor ricco, immagini e stampa.
- Nomi dei documenti sempre allineati a Google Drive: se un Google Doc viene rinominato, il sito aggiorna il titolo e non conserva quello vecchio.
- Progressivi con zeri iniziali (00001, 00002, ...) e numero di cifre configurabile dalle impostazioni.
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
- [app-loader.php](app-loader.php): assegna automaticamente ad `app.js` una versione basata sulla data di modifica, evitando cache obsolete.
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

# Guida utente e installazione

## Uso del sito

Il sito gestisce documenti, template, ODG, partiti, aziende, Parlamento, Governo, Composizione della Corte e Interpretazioni. L'archivio e condiviso tra tutti gli utenti autorizzati.

### Scheda Guida

La scheda **Guida** è interna all'applicazione e viene filtrata automaticamente dal ruolo. Mostra soltanto le aree che l'utente può vedere e le azioni effettivamente autorizzate, per esempio creare, modificare, eliminare, approvare o scaricare PDF. Non sostituisce i controlli PHP: serve a rendere chiaro all'utente come usare ciò che gli è consentito.

### Accesso

In locale, se `api.php` non e configurato, la demo salva nel browser. Su Altervista il nome utente e un indirizzo e-mail, il login viene verificato da PHP con `password_verify()` e la sessione e mantenuta dal server.

### Primo accesso: credenziali personali

Al primo accesso l'amministratore provvisorio usa `admin@localhost` / `zero2026` in locale, oppure l'utente iniziale creato su Altervista. Prima di entrare nell'archivio compare una schermata obbligatoria dove inserire:

- il proprio indirizzo e-mail, che diventa il nuovo nome utente;
- una nuova password di almeno 8 caratteri;
- la conferma della nuova password.

Dopo il salvataggio le credenziali provvisorie non sono più necessarie. Se il database era già stato installato prima del flag `must_change_credentials`, impostarlo manualmente con:

```sql
UPDATE users SET must_change_credentials = 1 WHERE username = 'admin@example.it';
```

### Registrazione e recupero password

- **Richiedi registrazione** invia nome, e-mail e password al server senza creare subito l'utente.
- L'amministratore principale approva la richiesta e assegna il ruolo Lettore o Redattore.
- **Recupera password** crea una richiesta visibile solo all'amministratore principale.
- L'amministratore principale inserisce una nuova password temporanea e la comunica all'utente tramite un canale sicuro.
- Le risposte pubbliche non rivelano se una e-mail esiste, per evitare enumerazione degli account.

### Gestione utenti

L'amministratore principale trova nella scheda autonoma **Utenti e permessi**:

- elenco degli utenti attivi;
- assegnazione dei ruoli Amministratore, Redattore o Lettore;
- approvazione o rifiuto delle richieste di registrazione;
- autorizzazione dei recuperi password;
- eliminazione dell'accesso di un utente.

Nella stessa scheda è possibile creare ruoli personalizzati e, per ogni area, impostare separatamente i permessi **Vedere**, **Creare**, **Modificare**, **Spostare nel cestino**, **Ripristinare**, **Eliminare definitivamente** e **Approvare**. Le sezioni e i pulsanti non autorizzati vengono nascosti nell'interfaccia; l'API ripete il controllo lato server.

L'amministratore principale non puo eliminare se stesso o essere eliminato da un altro amministratore. L'eliminazione di un account lo sposta nel cestino degli utenti, disattivandone immediatamente l'accesso; l'amministratore principale può poi ripristinarlo o eliminarlo definitivamente.

### Cestino

La scheda **Cestino** raccoglie gli elementi rimossi dagli archivi principali. I documenti (compresi gli ODG), i template, i partiti, le aziende, i mandati parlamentari, le nomine, le schede e i componenti di Governo e Corte, nonché le interpretazioni, sono tutti eliminabili attraverso questo flusso.

Lo spostamento nel cestino rimuove subito l'elemento dalla relativa sezione principale senza cancellarne i dati. Dal cestino, un utente autorizzato può **ripristinarlo** nella posizione originaria oppure **eliminarlo definitivamente**. La seconda azione è irreversibile e richiede una conferma esplicita. Per i componenti di una scheda istituzionale, occorre ripristinare prima l'eventuale scheda padre eliminata.

I tre passaggi sono governati da permessi indipendenti per ciascuna area: chi può spostare un elemento nel cestino non acquisisce automaticamente la facoltà di ripristinarlo o di eliminarlo definitivamente. Tutte le operazioni sono registrate nel log di sicurezza quando viene usato il backend.

### Sicurezza e log

Nella scheda **Utenti e permessi** il pannello **Log di sicurezza** mostra gli ultimi eventi rilevanti, tra cui login falliti, richieste CSRF non valide, permessi negati, creazione ruoli, modifiche ai permessi, cambi ruolo ed eliminazioni utenti. Gli eventi hanno gravita Informazione, Avviso o Critica e includono data, utente, indirizzo IP e dettagli disponibili.

Il backend applica inoltre header di sicurezza HTTP, sessioni con cookie HttpOnly/SameSite, token CSRF per le operazioni autenticate, rate limiting per login/registrazioni/recuperi, query PDO preparate, validazione input, sanificazione dell'HTML e blocco degli URL non consentiti nell'editor. I controlli del browser sono solo un aiuto all'interfaccia: l'autorizzazione effettiva viene ripetuta in PHP.

### Documenti e ODG

- Creare un documento con titolo, categoria, data, numero e contenuto.
- Il progressivo viene aggiornato per categoria e puo mantenere zeri iniziali.
- Cercare per titolo, categoria o numero.
- Riaprire una riga per modificare il documento.
- Ogni documento e template viene creato come Google Documenti nella cartella Drive configurata. In archivio si apre un documento cliccando la relativa riga; per i template si usa **Modifica**.
- **Scarica PDF** usa l'export PDF di Google Drive; il browser non genera più PDF e non conserva il contenuto redazionale nello stato locale.
- La sezione ODG usa la categoria automatica `ODG` e gli stati `Da valutare` / `Valutato`.

### Template

Creare un template con nome e categoria. Il contenuto si redige nel Google Doc creato nella cartella condivisa. **Usa template** mantiene il collegamento al template nell'archivio applicativo; i template possono essere spostati nel cestino senza modificare i documenti già creati con essi.

### Partiti

Ogni partito ha nome, stato, campi minimi configurabili e Statuto. Gli stati sono Attivo, Eliminato, Confluito e Cancellato. Le modifiche dei dati e dello Statuto sono registrate nello storico; le versioni dello Statuto possono essere confrontate.

### Aziende

Ogni azienda ha nome e Regolamento. Il Regolamento e modificabile in un editor dedicato e ogni versione viene conservata nello storico con confronto.

### Parlamento

Creare un mandato indicando legislazione, date e stato. I ruoli, i limiti e i campi aggiuntivi sono configurabili. Una nomina conserva nome, ruolo, giuramento, dimissioni, partito, coalizione, annotazioni e dati aggiuntivi. Le dimissioni non cancellano lo storico e liberano il limite del ruolo.

### Governo e Corte

Le due sezioni sono generate automaticamente. Per ogni periodo si possono definire ruoli, limiti, componenti, date di nomina, cessazioni e annotazioni. Le cessazioni rimangono nello storico.

### Interpretazioni

Creare una scheda con nome, data, testo e valori base configurabili, per esempio Fonte normativa. Le interpretazioni sono archiviate separatamente dai documenti.

### Impostazioni

Da questa sezione si gestiscono categorie, progressivi, campi minimi dei partiti, ruoli parlamentari, ruoli di Governo, ruoli della Corte e valori base delle interpretazioni.

Il campo **Cifre del progressivo** decide quanti zeri iniziali usare: con il valore 5 la numerazione diventa `00001`, `00002` e così via. La numerazione può essere reimpostata anche a un valore precedente e si applica soltanto ai documenti creati da quel momento: i progressivi già archiviati non vengono modificati. Il progressivo resta un testo: `00042` non viene mai ridotto a `42`.

### Nomi dei documenti e Google Drive

Il nome del file su Google Drive è il riferimento per il titolo mostrato dal sito.

- Se un documento viene rinominato dentro Google Documenti, il sito recepisce il nome nuovo e smette di mostrare quello vecchio. Vale per documenti, template, Statuti dei partiti e Regolamenti delle aziende.
- L'allineamento avviene all'apertura del sito, quando si torna sulla scheda del browser, a intervalli regolari mentre la pagina resta aperta e subito tramite il webhook Drive, se configurato. Il pulsante **Sincronizza nomi** in Impostazioni forza il controllo in qualsiasi momento.
- Se il titolo viene cambiato dal sito, la modifica viene riportata anche sul file in Drive, così le due parti non si sovrascrivono a vicenda.
- Il controllo periodico si ferma mentre un editor del sito è aperto, per non interferire con una modifica in corso.

Le costanti facoltative `DOCUMENT_NUMBER_PADDING`, `GOOGLE_NAME_SYNC_INTERVAL` e `GOOGLE_SYNC_MAX_LOOKUPS` in `private/config.php` regolano cifre predefinite, frequenza minima del riallineamento automatico lato server e numero massimo di file interrogati singolarmente fuori dalla cartella configurata. Se mancano, `api.php` usa valori predefiniti e le installazioni già attive continuano a funzionare.

## Installazione su Altervista

1. Creare o usare il database MySQL dal pannello Altervista e annotare host, nome database, utente e password.
2. Aprire phpMyAdmin e importare [database.sql](database.sql).
3. Generare un hash per la password amministratore su un computer con PHP:

```text
php -r "echo password_hash('zero2026', PASSWORD_DEFAULT), PHP_EOL;"
```

4. In phpMyAdmin eseguire la query indicata nel file SQL, sostituendo `HASH_BCRYPT` con l'hash ottenuto:

```sql
INSERT INTO users (username, password_hash, display_name, role, is_primary_admin)
VALUES ('admin@example.it', 'HASH_BCRYPT', 'Amministratore principale', 'admin', 1);
```

5. Creare un progetto Google Cloud, abilitare Google Drive API e Google Docs API e creare un client OAuth 2.0 di tipo applicazione web.
6. Impostare `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_WEBHOOK_URI` e `GOOGLE_DRIVE_FOLDER_ID` in `private/config.php`. L’URI di redirect deve puntare a `api.php?action=google_callback` ed essere registrato nel client Google. Il webhook deve essere pubblico in HTTPS e puntare a `api.php?action=google_webhook`.
7. Modificare le costanti `DB_HOST`, `DB_NAME`, `DB_USER` e `DB_PASSWORD` in `private/config.php`, non in `api.php`.
8. Caricare `index.html`, `styles.css`, `app.js`, `app-loader.php`, `api.php` e la cartella `private/`. Il file SQL può essere rimosso dal sito dopo l'importazione.
9. Accedere al sito, aprire **Impostazioni** e usare **Collega account Google**. L’account autorizzato deve avere accesso alla cartella Drive configurata.
7. Se Altervista consente di tenere file fuori dalla cartella pubblica, spostare lì `private/config.php`; in alternativa mantenerlo come file PHP non collegato pubblicamente e usare le protezioni già disponibili nel pannello Altervista.
8. Aprire l'URL HTTPS del sito e accedere con l'utente creato.

Il browser deve comunicare con `api.php` sullo stesso dominio. Non inserire mai le credenziali MySQL in JavaScript. HTML, CSS e JavaScript inviati al browser non possono essere nascosti: la sicurezza deve dipendere dal backend, dai permessi e dalla configurazione del server. Il progetto non usa file `.htaccess`: la protezione della cartella pubblica deve essere gestita dalle impostazioni del servizio Altervista.

## Architettura Google Drive

Il backend usa OAuth server-side per ogni utente. Il browser riceve solo l'ID del Google Doc e apre `docs.google.com`; client secret e refresh token non vengono mai inviati al browser. Senza backend o senza account Google collegato le azioni documentali restano disabilitate.

## Architettura dati

La versione attuale mantiene in `site_state.state_json` lo stesso oggetto usato dalla demo `localStorage`. Questo consente di portare online tutte le funzionalita esistenti senza riscrivere l'interfaccia. Lo stato e unico e condiviso tra gli utenti autorizzati; le richieste e le credenziali restano invece personali.

La soluzione e deliberatamente una prima fase: per archivi molto grandi sara opportuno trasformare documenti, versioni, partiti, nomine e interpretazioni in tabelle relazionali separate. Il backend, invece, e gia separato dall'interfaccia e puo essere esteso senza esporre MySQL al browser.

## Sicurezza e manutenzione

- Cambiare subito la password demo.
- Usare HTTPS.
- Proteggere `api.php` con password non presenti nel repository pubblico; idealmente spostare la configurazione fuori dalla cartella pubblica.
- Mantenere PDO con query preparate e `password_hash()`.
- Sanificare l'HTML dell'editor prima di mostrarlo ad altri utenti.
- Limitare dimensione e tipo dei file immagine; in produzione salvarli sul filesystem e nel database conservare solo il percorso.
- Fare backup del database e dei file caricati.
- Aggiungere CSRF token se il sito viene esposto pubblicamente o usato da piu ruoli.
