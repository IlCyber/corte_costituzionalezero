# Guida a `git cherry-pick` con GitHub (per Antigravity IDE)

Questa guida serve a portare nel tuo repository locale — quello che apri con Antigravity — le modifiche che arrivano da un ramo o da una pull request su GitHub, senza dover unire tutto il ramo.

---

## 1. Quando serve il cherry-pick

- Un collaboratore (o un agente) ha sistemato qualcosa su un ramo separato e a te interessa **solo quel certo insieme di commit**, non tutto il ramo.
- Hai due copie di lavoro diverse (per esempio il progetto su Antigravity e una copia di prova) e vuoi spostare singole correzioni da una all'altra.
- Una pull request contiene molti commit, ma tu ne vuoi solo alcuni.

Se invece vuoi **tutte** le modifiche di un ramo, il comando giusto è `git merge` o `git rebase`: il cherry-pick servirebbe solo a fare lavoro in più.

---

## 2. Concetto in una riga

`git cherry-pick <commit>` = «prendi **questo** commit (e solo questo) e riapplicalo qui, sopra la cronologia attuale». Il risultato è un **nuovo commit** con lo stesso contenuto ma con codice (hash) diverso.

---

## 3. Preparazione (una volta sola, da terminale in Antigravity)

Antigravity ha un terminale integrato (pannello Terminale). Aprilo nella cartella del progetto e verifica:

```bash
git status          # la copia deve essere PULITA prima di iniziare
git remote -v       # deve comparire "origin" che punta al tuo repo GitHub
```

Se `git status` mostra file modificati, prima fai commit oppure mettili da parte:

```bash
git stash           # mette da parte le modifiche non salvate
```

 Collega il repository remoto da cui prelevare i commit (se non è già il tuo `origin`):

```bash
git remote add sorgente https://github.com/<utente>/<repo>.git
```

e scarica tutto (senza toccare i tuoi file):

```bash
git fetch sorgente
# oppure, se i commit sono nel tuo stesso repository:
git fetch origin
```

---

## 4. Trovare il commit giusto

Elenca i commit recenti del ramo sorgente:

```bash
git log --oneline --graph --all -20
```

Per vedere **cosa contiene** un commit prima di prenderlo:

```bash
git show <codice-commit>          # mostra modifiche complete
git show --stat <codice-commit>   # solo l'elenco dei file toccati
```

Il «codice commit» è la sigla gialla/verde di 7–10 caratteri (es. `a1b2c3d`).

---

## 5. Cherry-pick di base

```bash
git switch main            # vai sul ramo che vuoi aggiornare
git pull origin main       # assicurati di essere aggiornato
git cherry-pick <codice-commit>
```

Fatto: le modifiche di quel commit ora sono nella tua cronologia, come nuovo commit locale. Puoi continuare a lavorare.

**Più commit singoli** (in ordine, dal più vecchio al più recente):

```bash
git cherry-pick a1b2c3d e4f5g6h
```

**Un intervallo di commit** (tutti, in sequenza):

```bash
git cherry-pick A1b2c3d^..e4f5g6h
```

Attenzione al `^`: `A..B` esclude il commit A (parte dal successivo), `A^..B` lo include. Usa sempre l'ordine cronologico: prima il più vecchio.

---

## 6. Se arrivano i conflitti

Con file toccati da entrambe le parti Git si ferma e scrive `CONFLICT`. **Non è un errore grave**: Git ti chiede di scegliere.

```bash
git status                 # elenca i file in conflitto (rosso "both modified")
```

Apri i file in Antigravity: cerca i blocchi

```
<<<<<<< HEAD
... la tua versione ...
=======
... la versione in arrivo ...
>>>>>>> a1b2c3d (messaggio del commit)
```

Sistemali a mano tenendo la combinazione corretta delle due versioni e togli le righe `<<<<<<<`, `=======`, `>>>>>>>`. Poi:

```bash
git add <file-sistemato>
git cherry-pick --continue     # conclude il cherry-pick
```

Comandi di emergenza:

```bash
git cherry-pick --abort       # annulla tutto e torna come prima
git cherry-pick --skip        # salta questo commit e passa al successivo
git checkout --ours <file>    # tieni la TUA versione di un file
git checkout --theirs <file>  # prendi la versione in ARRIVO di un file
```

In Antigravity l'interfaccia «Source Control» mostra i conflitti con i pulsanti «Accetta current / incoming / entrambi»: si può usare quella invece del terminale.

---

## 7. Prendere le modifiche senza crearne subito un commit

Se vuoi prima rivedere o sistemare qualcosa:

```bash
git cherry-pick -n <codice-commit>     # -n = --no-commit
```

Le modifiche restano in sospeso (staging): le controlli con `git diff --cached`, le sistemi e poi decidi:

```bash
git commit              # se va bene
git checkout .          # se invece vuoi buttare via tutto
```

---

## 8. Inviare il risultato a GitHub

```bash
git push origin main
```

Se GitHub rifiuta perché nel frattempo il ramo remoto è andato avanti:

```bash
git pull --rebase origin main
git push origin main
```

---

## 9. Se il flusso «pull request» ti è più comodo

Su GitHub una pull request mostra l'elenco dei commit: aprendone uno, il pulsante «…» → «Copy SHA» copia il codice da dare a `git cherry-pick` dopo `git fetch origin`. Alternativa senza cherry-pick: dalla pagina della PR, scheda «Files changed», puoi creare una patch dei singoli commit con `git format-patch`/`git am`:

```bash
# lato sorgente (repo scaricato in locale):
git format-patch -1 <codice-commit> -o /tmp/     # crea /tmp/0001-....patch
# lato destinazione:
git am /tmp/0001-....patch
```

`git am` applica la patch come commit mantenendo autore e messaggio; con `git am --abort` si annulla.

---

## 10. Riassunto rapido

| Obiettivo | Comando |
|---|---|
| Scaricare i commit nuovi senza toccare i file | `git fetch origin` |
| Vedere le modifiche di un commit | `git show <sha>` |
| Prendere un commit nel ramo attuale | `git cherry-pick <sha>` |
| Prendere più commit (intervallo, incluso il primo) | `git cherry-pick A^..B` |
| Prendere senza commit immediato | `git cherry-pick -n <sha>` |
| Concludere dopo i conflitti | `git add <file> && git cherry-pick --continue` |
| Annullare un cherry-pick in corso | `git cherry-pick --abort` |
| Annullare l'ultimo commit già fatto (tieni le modifiche) | `git reset --soft HEAD~1` |
| Inviare su GitHub | `git push origin <ramo>` |

**Regola d'oro:** parti sempre da una copia pulita (`git status` vuoto) e non fare cherry-pick «alla cieca»: guarda prima il commit con `git show`. Ogni cherry-pick crea un commit nuovo con codice diverso: se poi in futuro unisci anche il ramo originale, Git riconosce le modifiche uguali ma vedrai entrambe le cronologie (non è un problema, è normale).
