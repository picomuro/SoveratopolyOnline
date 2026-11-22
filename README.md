# 🌊 Soveratopoly

Gioco da tavolo multiplayer online, gratuito, da giocare nel browser (anche da telefono).
Da 2 a 8 giocatori si sfidano a comprare Soverato: chi resta l'ultimo con dei soldi vince.
Tabellone con i luoghi di Soverato, carte Imprevisti e Probabilità in dialetto, aste e il minigioco della Murra.

## Avvio in locale

Serve [Node.js](https://nodejs.org) 20 o più recente.

```bash
npm install
npm start
```

Poi apri http://localhost:3000. Per provare in multiplayer apri una seconda finestra in incognito.

| Comando                                     | A cosa serve                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `npm start`                                 | avvia il server                                                          |
| `npm run dev`                               | avvia il server e lo riavvia a ogni modifica del codice                  |
| `npm test`                                  | test delle regole e test di integrazione (circa 40 secondi)              |
| `npm run simulate -- [giocatori] [secondi]` | partita completa tra bot, con controllo delle incoerenze (default 4, 90) |
| `npm run lint`                              | controllo del codice con ESLint                                          |
| `npm run format`                            | formattazione con Prettier (`format:check` controlla soltanto)           |
| `npm run check`                             | lint, formattazione e test insieme                                       |

### Variabili d'ambiente

Tutte facoltative (vedi `.env.example`):

| Variabile         | Default   | Descrizione                                                                           |
| ----------------- | --------- | ------------------------------------------------------------------------------------- |
| `PORT`            | `3000`    | porta HTTP (Render la imposta da solo)                                                |
| `HOST`            | `0.0.0.0` | indirizzo su cui ascoltare                                                            |
| `ALLOWED_ORIGINS` | (vuota)   | altre origini, separate da virgola, da cui accettare connessioni oltre al sito stesso |

## Deploy su Render (gratis)

1. Carica il progetto su un repository GitHub.
2. Su [render.com](https://render.com), accedi con GitHub e scegli **New → Blueprint**: Render legge `render.yaml` e configura tutto.
   In alternativa **New → Web Service** con:
   - Runtime: **Node**
   - Build Command: `npm ci --omit=dev` (installa solo le dipendenze necessarie al gioco)
   - Start Command: `npm start`
   - Instance Type: **Free**
   - Health Check Path: `/health`
   - Variabili d'ambiente: nessuna obbligatoria
3. Premi **Deploy** e attendi lo stato "Live". A ogni push sul branch collegato Render ripubblica da solo.
4. Condividi l'URL pubblico (es. `https://soveratopoly.onrender.com`). Il pulsante "Condividi link" della stanza porta direttamente nella stanza.

**Piano Free**: dopo 15 minuti senza visite il server si addormenta e al risveglio impiega fino a un minuto
(il gioco mostra "Sto svegliando il server…" e si riconnette da solo). A ogni riavvio o deploy le partite in memoria
si perdono: chi era in una stanza vede un messaggio chiaro e può crearne subito una nuova. Le stanze inattive da
30 minuti vengono eliminate.

## Struttura del progetto

```
server/
  index.js          avvio: HTTP + Socket.IO, pulizia periodica, chiusura ordinata (startServer per test e script)
  http.js           Express: header di sicurezza (helmet), compressione, file statici, /health
  socket.js         eventi Socket.IO -> azioni del motore; ack, limiti di frequenza
  rooms.js          registro delle stanze in memoria, codici, nickname, pulizia
  limits.js         limiti anti-abuso per connessione e per indirizzo IP
  config.js         tempi, limiti e variabili d'ambiente
  game/             motore di gioco, senza rete:
    turns.js          avvio partita, turni, timer della mossa, gioco automatico allo scadere
    board.js          dadi, movimento, caselle, carte, acquisti, prigione
    money.js          pagamenti, liquidazione automatica, bancarotta, vittoria
    auction.js        aste (e sfida a Murra nelle aste a due)
    murra.js          minigioco della Murra
    trade.js          scambi tra giocatori
    properties.js     case, alberghi, ipoteche
    chat.js           chat e reazioni
    presence.js       connessione, disconnessione, abbandono
    state.js          stato della stanza e stato pubblico inviato ai client
    decks.js          mazzi Imprevisti e Probabilità
    output.js         uscite verso la rete (stato, animazioni) e timer sicuri
    random.js         dadi e casualità (sostituibile nei test)
shared/
  board-data.js     caselle, prezzi, regole economiche e formule: un solo modulo per server e browser
public/
  index.html        home, sala d'attesa, partita, vittoria
  style.css         stile colorato e responsive
  img/board.jpg     immagine del tabellone
  js/               client a moduli ES: main (avvio e coda), net (connessione), store (stato),
                    screens, board (tabellone, pedine, dadi), panels, murra, trade, chat, dom, ui-config
scripts/simulate.js partita completa tra bot
test/               test con node:test (regole e integrazione)
render.yaml         Blueprint per Render
AUDIT.md            analisi del codice e stato delle correzioni
```

## Come funziona

- **Il server è l'unica autorità.** Il browser invia solo intenzioni (`game:roll`, `auction:bid {amount}` …); il
  server controlla stanza, turno e fase, tira i dadi con `crypto.randomInt`, muove le pedine, calcola affitti e carte.
  Ogni richiesta riceve una risposta `{ok, error?, message?}`.
- Dopo ogni azione il server invia a tutta la stanza lo stato completo (`room:state`, senza token né scelte segrete) e,
  se serve, i passi da animare (`game:anim`: dadi, percorsi, carte, mani di Murra). Il client li mostra in coda,
  nell'ordine di arrivo, e salta le animazioni se la scheda è in background.
- Il motore di gioco (`server/game/`) lavora su un oggetto stanza e non conosce Socket.IO: per questo si può testare
  senza server, con dadi e timer pilotati.
- Tutto lo stato è in memoria. Ogni giocatore ha un token segreto salvato nel browser per rientrare nel proprio posto;
  da un altro dispositivo si rientra con lo stesso codice e lo stesso nickname.

## Sicurezza

- Nessuna azione viene decisa dal client; i dati degli utenti sono inseriti nella pagina sempre come testo.
- Header di sicurezza con `helmet` (Content-Security-Policy, nosniff, protezione dal framing), compressione gzip.
- Limiti anti-abuso: 20 eventi di fila per connessione (poi 10 al secondo), messaggi al massimo di 16 KB; per
  indirizzo IP 40 connessioni, 20 stanze create e 60 tentativi di ingresso al minuto.
- Connessioni Socket.IO accettate solo dalle pagine dello stesso sito (o da `ALLOWED_ORIGINS`).
- Il rientro con il nickname permette a chi conosce codice e nickname di riprendere il posto di un giocatore
  disconnesso: è una scelta voluta per la comodità tra amici (vedi `AUDIT.md`).

## Regole

- Ognuno parte con **1500 €** dal VIA!. Passando dal VIA! si ritirano **200 €**.
- Si tirano 2 dadi e si avanza in senso orario.
- **Proprietà libera**: puoi comprarla al prezzo indicato, oppure rinunciare.
- **Asta**: se rinunci (o scade il tempo), la proprietà va all'asta tra tutti i giocatori ancora in gioco, te compreso. Si parte da metà del prezzo di listino (es. 100 € per una proprietà da 200 €) e si rilancia di almeno 10 €: ci sono 15 secondi per la prima offerta e 10 secondi dopo ogni rilancio. Chi si ritira non può rientrare. Vince l'offerta più alta; se nessuno offre, la proprietà resta libera.
- **Proprietà di un altro**: paghi l'affitto.
  - Via (affitto base = 8% del prezzo): l'affitto raddoppia se il proprietario ha tutto il gruppo di colore. Con case e albergo vale ×4, ×11, ×28, ×36 e ×45.
  - Stazioni (Passaggio a Livello, Stazione degli Autobus, Stazione dei Treni, Marcello): 25, 50, 100 o 200 € in base a quante ne possiede il proprietario.
  - Raspa Elettrodomestici e Depuratore: dadi × 4, oppure dadi × 10 se il proprietario le ha entrambe.
- **Case**: si costruiscono solo con tutto il gruppo di colore, in modo uniforme (5 case = albergo). Si rivendono a metà prezzo.
- **Ipoteca**: incassi metà del prezzo, ma la proprietà non rende affitto. Per riscattarla paghi la metà del prezzo più il 10%.
- **Scambi**: nel tuo turno premi 🤝 accanto a un giocatore e proponi proprietà e/o soldi in cambio di sue proprietà e/o soldi. L'altro ha 45 secondi per accettare; può accettare solo a mossa ferma (non durante un acquisto, un'asta o una Murra), mentre rifiutare si può sempre. Le proprietà di un gruppo con case non si possono scambiare. Gli scambi servono a completare i gruppi: senza, la partita rischierebbe di non finire mai.
- **Imprevisti / Probabilità**: 18 Imprevisti e 15 Probabilità, scritti in dialetto; sotto ogni carta compare l'effetto in italiano. Oltre a soldi, spostamenti e prigione ci sono: il servizio più vicino (se è di un altro si tirano i dadi e si paga 10 volte il risultato), la stazione più vicina (affitto doppio) e la carta "esci di prigione", che si conserva e si può cedere in uno scambio.
- **Tasse**: Mazzo di rose di Rosario 200 €, Posto di Blocco 100 €.
- **Doppio**: tiri di nuovo. Con tre doppi di fila vai in prigione.
- **Prigione**: ci finisci arrivando su "In Prigione!" o con una carta. Per uscire paghi 50 €, usi la carta "esci di prigione" oppure provi a fare un doppio (massimo 3 tentativi, poi paghi per forza).
- **Debiti**: se non hai abbastanza soldi, il gioco ipoteca le tue proprietà e, se serve, vende le case in automatico. Se non basta sei in **bancarotta**: le tue proprietà vanno al creditore, o tornano libere se il debito era con la banca.
- **Vince l'ultimo giocatore non in bancarotta.**
- Ogni mossa (tirare i dadi, decidere un acquisto, chiudere il turno) ha un tempo massimo di 2 minuti. Se scade, il server tira i dadi, rinuncia all'acquisto o chiude il turno al posto del giocatore; se il giocatore è disconnesso lo fa dopo pochi secondi. Aste e Murra hanno tempi propri, più brevi.
- **Disconnessioni**: se un giocatore resta scollegato per più di 5 secondi, la cronologia lo segnala (una semplice ricarica della pagina non viene scritta). Il posto resta suo: può rientrare dallo stesso browser in automatico, oppure da qualsiasi dispositivo entrando con lo stesso codice e lo stesso nickname, e ritrova soldi e proprietà. Al rientro la cronologia scrive che è tornato.
- **Murra**: minigioco a due. A ogni mano ognuno sceglie in segreto quante dita mostrare (da 1 a 5) e dichiara la somma delle due mani (da 2 a 10). Chi indovina la somma fa un punto; se indovinano entrambi, o nessuno, il punto non viene assegnato. Vince chi arriva per primo a 3 punti (nelle aste basta il primo punto, per non rallentare il gioco). Ci sono 20 secondi per ogni mano, poi il server sceglie a caso. Se chi deve scegliere, accettare o giocare si scollega per più di 5 secondi, il server decide subito al suo posto. Per non bloccare la partita, la sfida si chiude in anticipo dopo 30 mani o dopo 2 mani in cui nessuno dei due ha giocato: vince chi è avanti, a pari punti decide la sorte. Si gioca in tre casi:
  - **Asta rimasta a due**: quando resta un solo rivale in grado di rilanciare, può sfidare a Murra chi ha fatto l'offerta invece di rilanciare. Lo sfidato ha 15 secondi per accettare o rifiutare. Se accetta, chi vince compra la proprietà a quel prezzo. Se rifiuta, l'asta continua e la sfida non si può riproporre finché l'offerta non cambia.
  - **Parcheggio Gratuito**: chi ci arriva può sfidare un giocatore a sua scelta (o rinunciare). Lo sfidato non può rifiutare; chi perde dà 150 € a chi vince.
  - **Imprevisti**: due carte obbligano a scegliere un giocatore da sfidare: con "Sfida a Murra a 3 punti!" si gioca a 3 punti, con "Murra secca!" basta il primo punto. Lo sfidato non può rifiutare e chi perde dà 150 € a chi vince.
- **Chat**: in sala d'attesa e in partita si possono scrivere messaggi brevi (massimo 120 caratteri, uno ogni 1,5 secondi). Il testo non viene filtrato né censurato: parole e link compaiono così come sono scritti. Restano anche le reazioni con le emoji.
- **Rivincita**: a fine partita l'host può avviarne un'altra. Partecipano solo i giocatori ancora connessi.

## Messaggi socket

| Client → Server                                                                                   | Server → Client                                                         |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `room:create {nickname}`                                                                          | `room:state` (stato completo, senza token)                              |
| `room:join {code, nickname}`                                                                      | `game:anim {steps}` (dadi, movimenti, carte e mani di Murra da animare) |
| `room:rejoin {code, token}`                                                                       | `chat:message {id, playerId, nickname, color, text}`                    |
| `room:leave`                                                                                      | `chat:reaction {playerId, emoji}`                                       |
| `game:start`, `game:roll`, `game:payJail`, `game:useJailCard`                                     | `session:replaced` (la partita è stata aperta in un'altra scheda)       |
| `game:buy`, `game:pass`, `game:endTurn`                                                           |                                                                         |
| `game:manage {action: build\|sell\|mortgage\|unmortgage, cell}`                                   |                                                                         |
| `trade:propose {to, giveProps, getProps, giveMoney, getMoney, giveCards, getCards}`               |                                                                         |
| `trade:respond {accept}`, `trade:cancel`                                                          |                                                                         |
| `auction:bid {amount}`, `auction:pass`, `auction:murra`                                           |                                                                         |
| `murra:choose {to}`, `murra:skip`, `murra:respond {accept}`, `murra:play {fingers, guess, round}` |                                                                         |
| `chat:send {text}`, `chat:react {id}`                                                             |                                                                         |

Errori principali: `ROOM_NOT_FOUND` (la stanza o il proprio posto non esistono più: il client torna alla home),
`NOT_YOUR_TURN`, `BAD_PHASE`, `NO_MONEY`, `RATE_LIMIT`, `GAME_STARTED`.
