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
- Ogni documento e template viene creato come Google Documenti nella cartella Drive configurata. Il pulsante **Apri Google Doc** apre la redazione nell'editor ufficiale di Google.
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
8. Caricare `index.html`, `styles.css`, `app.js`, `api.php` e la cartella `private/`. Il file SQL può essere rimosso dal sito dopo l'importazione.
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
