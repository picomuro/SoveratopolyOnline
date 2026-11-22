# Audit di SoveratopolyOnline

Audit del codice al commit `6a9dcbf` (branch `main`), svolto sul branch `refactor/audit-and-cleanup`.
I riferimenti `file:riga` si riferiscono al codice **prima** del refactoring.

## 1. Com'è fatto il progetto

**Stack**: Node.js (>= 20) + Express 4 + Socket.IO 4.8 sul server; HTML, CSS e JavaScript "vanilla" nel browser,
senza build. Nessun database: tutto lo stato è in memoria. Deploy su Render (piano Free) con `render.yaml`.

**Struttura**

```
server.js            1358 righe: HTTP, Socket.IO, stanze, turni, regole, carte, aste, Murra, chat, pulizia
public/
  index.html         lobby, sala d'attesa, partita, vittoria
  game.js            1006 righe: connessione, rendering, animazioni, pannelli, chat (un'unica IIFE)
  style.css          stile responsive
  board-data.js      caselle, regole e formule; caricato dal server (require) e dal browser (window.SOVERATO)
  img/board.jpg      immagine del tabellone (253 KB)
render.yaml          Blueprint di Render
```

**Flusso client ↔ server**: il browser apre una connessione Socket.IO verso la stessa origine. Il client invia solo
_intenzioni_ (`game:roll`, `game:buy`, `auction:bid {amount}` …) e ogni richiesta riceve un ack `{ok, error?, message?}`.
Il server valida, aggiorna lo stato e invia a tutta la stanza `room:state` (stato completo, senza token) e, quando
serve, `game:anim {steps}` (dadi, percorsi delle pedine, carte, mani di Murra) che il client anima prima di mostrare
lo stato successivo. Chat e reazioni viaggiano su `chat:message` / `chat:reaction`.

**Stato di gioco**: una `Map` di stanze in memoria (`server.js:134`). Ogni stanza contiene giocatori (con token
segreto per il rientro), proprietà, turno, mazzi, scambio/asta/Murra in corso, log e chat. Un solo timer per stanza
(`room.timer`) scandisce mossa, asta e Murra; un secondo timer gestisce gli scambi.

**Stanze**: codice di 4 lettere (24 lettere possibili), massimo 8 giocatori, massimo 300 stanze. Chi si disconnette
mantiene il posto e rientra con il token salvato nel browser o, da un altro dispositivo, con lo stesso nickname.
Le stanze vuote vengono eliminate dopo 5 minuti, quelle inattive dopo 30.

**Turni, dadi e movimento**: il server tira i dadi con `crypto.randomInt`, applica prigione e doppi, muove la pedina
casella per casella (ritirando 200 € al passaggio dal VIA!), applica l'effetto della casella (acquisto, affitto,
tasse, carte, prigione, Parcheggio Gratuito con Murra) e decide la fase successiva (`roll | buy | auction | murra | end`).
Se un giocatore non agisce entro 2 minuti (pochi secondi se è disconnesso) il server gioca al suo posto.

**Verifica di base**: il server è davvero l'unica fonte di verità. Dadi, posizioni, turni, prezzi, affitti e
carte sono decisi solo dal server; ogni azione controlla stanza, turno e fase (`myTurn`, `inAuction`, `inMurra`).
Gli handler sono sincroni, quindi due azioni simultanee non possono intrecciarsi. Il client inserisce i dati degli
utenti sempre con `esc()` o `textContent` (nessuna XSS trovata). Nessun segreto nel repository; `npm audit`: 0
vulnerabilità.

## 2. Problemi trovati

Totale: **0 critici, 3 alti, 9 medi, 11 bassi**.

### Critico

Nessun problema critico: non ci sono modi per barare, né falle che espongano dati o permettano di eseguire codice.

### Alto

| #   | Dove                            | Problema                                                                                                                                                                                                                                       | Impatto                                                | Soluzione                                                                                                                                             |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `server.js:1069`, `:193`, `:37` | Nessun limite di frequenza sugli eventi Socket.IO (solo chat e reazioni ne hanno uno). Uno script che invia `room:create` in loop riempie in pochi secondi le 300 stanze disponibili, che restano occupate 5 minuti.                           | Chiunque può impedire a tutti di creare partite (DoS). | Limite di frequenza per connessione su tutti gli eventi, più un limite più stretto per creare stanze ed entrare (per connessione e per indirizzo IP). |
| A2  | `server.js:1074`                | I codici stanza sono 331.776 combinazioni: senza limiti, uno script può provarli tutti in pochi minuti ed entrare in stanze altrui. A partita in corso può anche prendere il posto di un giocatore disconnesso usandone il nickname (vedi M1). | Intrusioni nelle partite di sconosciuti.               | Stesso limite di A1 su `room:join` e `room:rejoin` (pochi tentativi al minuto per IP).                                                                |
| A3  | `server.js:31`, `:1165`         | `maxHttpBufferSize` è lasciato al default di Socket.IO (1 MB) e gli array di uno scambio (`giveProps`, `getProps`) non hanno una lunghezza massima.                                                                                            | Messaggi enormi costano CPU e memoria a ogni invio.    | Limite di 16 KB per messaggio e array tagliati al numero di caselle.                                                                                  |

### Medio

| #   | Dove                                          | Problema                                                                                                                                                                                                                                           | Impatto                                                                            | Soluzione                                                                                                            |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| M1  | `server.js:1077-1080`                         | Rientro con lo stesso nickname: chi conosce codice e nickname prende il posto di un giocatore disconnesso. È una funzione richiesta esplicitamente, ma è un compromesso di sicurezza.                                                              | Tra amici va bene; con sconosciuti un posto può essere "rubato".                   | Lasciata com'è (scelta del proprietario). Possibile passo successivo: PIN di rientro scelto all'ingresso.            |
| M2  | `server.js:1298-1307`                         | `murra:play` non indica a quale mano si riferisce: una giocata arrivata in ritardo (rete lenta, doppio invio) viene applicata alla mano **successiva**. Riprodotto con client finti: alcune mani restavano ferme fino allo scadere dei 20 secondi. | Mani giocate "a sorpresa" con una scelta vecchia; attese inutili.                  | Il client invia il numero della mano (`round`); il server rifiuta le giocate di una mano diversa.                    |
| M3  | `server.js:1185-1205`, `:780`                 | Uno scambio proposto in fase `roll` resta aperto dopo il tiro e può essere accettato durante un'asta o una Murra. Se cambia i soldi di chi sta vincendo l'asta, l'asta si chiude come "deserta" (`winner.money >= bid` fallisce).                  | Esiti d'asta sorprendenti, stati poco chiari.                                      | L'accettazione è possibile solo nelle fasi `roll` ed `end`, come la proposta; prima viene chiesto di aspettare.      |
| M4  | `server.js:22-28`                             | Nessun header di sicurezza: manca la Content-Security-Policy, `X-Content-Type-Options`, la protezione dal framing (clickjacking).                                                                                                                  | Meno difese in caso di futura XSS; la pagina può essere incorporata in siti terzi. | `helmet` con una CSP compatibile (Google Fonts, stili inline).                                                       |
| M5  | `server.js` intero                            | Un solo file da 1358 righe; la logica di gioco chiama direttamente Socket.IO (`io.to().emit` in `finishAction` e `resolveMurraRound`, `broadcast` nei timer) e usa il registro globale delle stanze.                                               | Impossibile testare le regole senza avviare un server; modifiche rischiose.        | Separazione in `server/` (rete), `server/game/` (regole pure con uscite iniettate), `shared/` (dati comuni).         |
| M6  | repository                                    | Nessun test automatico, nessun linter, nessuna formattazione condivisa.                                                                                                                                                                            | Le regressioni si scoprono giocando.                                               | ESLint + Prettier, test con `node:test`, script di simulazione con client finti.                                     |
| M7  | `public/game.js` intero                       | Il client è un'unica funzione da 1006 righe che legge i dati da una variabile globale (`window.SOVERATO`).                                                                                                                                         | Difficile da mantenere; dipendenze implicite.                                      | ES modules: connessione, tabellone, pannelli, chat e finestre in file separati che importano `shared/board-data.js`. |
| M8  | `server.js:841-863`                           | Se chi deve scegliere l'avversario (Parcheggio/carta) o accettare la sfida (asta) si disconnette **dopo** l'inizio della fase, gli altri aspettano comunque tutti i 20 o 15 secondi. Per le mosse normali invece il tempo si accorcia.             | Attese inutili.                                                                    | Alla disconnessione di chi deve decidere nella Murra, la fase viene chiusa subito come tempo scaduto.                |
| M9  | `public/index.html`, `public/game.js:952-966` | Accessibilità: la finestra modale non ha `role="dialog"`/`aria-modal`, non si chiude con Esc e non riceve il focus; i pulsanti fatti solo di emoji (🤝, 🏦, ✨, ➤) hanno al massimo un `title`.                                                    | Difficile da usare con tastiera e lettori di schermo.                              | Ruoli ARIA, chiusura con Esc, focus sulla finestra, `aria-label` sui pulsanti con sole emoji.                        |

### Basso

| #   | Dove                     | Problema                                                                                                                                                                                             | Soluzione                                                                               |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| B1  | `server.js`              | Nessuna compressione HTTP: ~75 KB di JS/CSS/HTML viaggiano non compressi (pesante su rete mobile).                                                                                                   | Middleware `compression` (gzip).                                                        |
| B2  | `render.yaml`            | `buildCommand: npm install` installerebbe anche le dipendenze di sviluppo aggiunte con il tooling, allungando il build.                                                                              | `npm ci --omit=dev`.                                                                    |
| B3  | `server.js:1093`         | `room:rejoin` non toglie gli spazi dal codice (`room:join` sì).                                                                                                                                      | Stessa normalizzazione per entrambi.                                                    |
| B4  | `server.js:159-160`      | Commento JSDoc duplicato e non più corretto su `baseNick`.                                                                                                                                           | Pulizia.                                                                                |
| B5  | `public/game.js` (varie) | Numeri "magici" nel client (durate delle animazioni, chiusura automatica delle finestre 7000/6000/3500 ms, toast 2600 ms, `CHAT_KEEP = 50` diverso da `CHAT_HISTORY = 40` del server).               | Costanti con nome in un unico punto.                                                    |
| B6  | `server.js`              | Nessuna gestione di `SIGTERM`: a ogni deploy Render chiude il processo senza chiudere ordinatamente le connessioni.                                                                                  | Chiusura ordinata del server HTTP e di Socket.IO.                                       |
| B7  | `server.js:1037`         | Socket.IO accetta connessioni WebSocket da qualsiasi origine. Non ci sono cookie né autenticazione, quindi non c'è rischio CSRF, ma un sito terzo può aprire connessioni a nome dei suoi visitatori. | Variabile facoltativa `ALLOWED_ORIGINS` per limitare le origini.                        |
| B8  | `server.js:283-286`      | A ogni azione viene inviato lo stato completo (circa 4-6 KB con 8 giocatori).                                                                                                                        | Accettabile a questa scala: lasciato così (vedi sezione 4).                             |
| B9  | `public/img/board.jpg`   | Immagine da 253 KB, in cache per un giorno.                                                                                                                                                          | Accettabile; una versione WebP la dimezzerebbe (non fatto: richiede strumenti esterni). |
| B10 | `package.json`           | Express 4.22 (ultima 5.x). Nessuna vulnerabilità nota.                                                                                                                                               | Lasciato alla 4: l'aggiornamento alla 5 cambia API senza benefici qui.                  |
| B11 | `public/index.html:8-10` | Il font viene da Google Fonts: dipendenza esterna e IP dei giocatori inviato a Google.                                                                                                               | Lasciato (aspetto grafico); possibile self-hosting del font.                            |

## 3. Ambiguità di regole

Nessuna regola è stata cambiata. Punti da confermare con l'autore del gioco:

- Il Parcheggio Gratuito mette in palio **150 €** e la sfida è facoltativa: valore scelto durante lo sviluppo, non indicato esplicitamente.
- La carta "servizio più vicino" fa sempre tirare i dadi e pagare 10 volte il risultato, anche se il proprietario possiede un solo servizio (come nel gioco classico).
- Una carta può spostare su un'altra casella "carta": al massimo due carte di fila nello stesso turno.

## 4. Stato delle correzioni

_Aggiornato al termine del refactoring._
