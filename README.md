# 🌊 Soveratopoly

Gioco da tavolo multiplayer online, gratuito, da giocare nel browser (anche da telefono).
Da 2 a 8 giocatori si sfidano a comprare Soverato: chi resta l'ultimo con dei soldi vince.

## Avvio in locale

```bash
npm install && npm start
```

Poi apri http://localhost:3000. Per provare in multiplayer apri una seconda finestra in incognito.
Con `npm run dev` il server si riavvia da solo quando modifichi `server.js`.

## Struttura

```
server.js            Express + Socket.IO: stanze, turni, regole (unica autorità)
public/
  index.html         lobby, sala d'attesa, partita, vittoria
  game.js            client: connessione, rendering, animazioni di dadi e pedine
  style.css          stile colorato e responsive
  board-data.js      caselle, prezzi, formule degli affitti e reazioni (condiviso tra server e client)
  img/board.jpg      immagine del tabellone
render.yaml          Blueprint per Render
```

## Regole

- Ognuno parte con **1500 €** dal VIA!. Passando dal VIA! si ritirano **200 €**.
- Si tirano 2 dadi e si avanza in senso orario.
- **Proprietà libera**: puoi comprarla al prezzo indicato, oppure rinunciare.
- **Asta**: se rinunci (o scade il tempo), la proprietà va all'asta tra tutti i giocatori ancora in gioco, te compreso. Si parte da 10 € e si rilancia di almeno 10 €: ci sono 15 secondi per la prima offerta e 10 secondi dopo ogni rilancio. Chi si ritira non può rientrare. Vince l'offerta più alta; se nessuno offre, la proprietà resta libera.
- **Proprietà di un altro**: paghi l'affitto.
  - Via (affitto base = 8% del prezzo): l'affitto raddoppia se il proprietario ha tutto il gruppo di colore. Con case e albergo vale ×4, ×11, ×28, ×36 e ×45.
  - Stazioni (Passaggio a Livello, Stazione degli Autobus, Stazione dei Treni, Marcello): 25, 50, 100 o 200 € in base a quante ne possiede il proprietario.
  - Raspa Elettrodomestici e Depuratore: dadi × 4, oppure dadi × 10 se il proprietario le ha entrambe.
- **Case**: si costruiscono solo con tutto il gruppo di colore, in modo uniforme (5 case = albergo). Si rivendono a metà prezzo.
- **Ipoteca**: incassi metà del prezzo, ma la proprietà non rende affitto. Per riscattarla paghi la metà del prezzo più il 10%.
- **Scambi**: nel tuo turno premi 🤝 accanto a un giocatore e proponi proprietà e/o soldi in cambio di sue proprietà e/o soldi. L'altro ha 45 secondi per accettare. Le proprietà di un gruppo con case non si possono scambiare. Gli scambi servono a completare i gruppi: senza, la partita rischierebbe di non finire mai.
- **Imprevisti / Probabilità**: 18 Imprevisti e 15 Probabilità, scritti in dialetto; sotto ogni carta compare l'effetto in italiano. Oltre a soldi, spostamenti e prigione ci sono: il servizio più vicino (se è di un altro si tirano i dadi e si paga 10 volte il risultato), la stazione più vicina (affitto doppio) e la carta "esci di prigione", che si conserva e si può cedere in uno scambio.
- **Tasse**: Mazzo di rose di Rosario 200 €, Posto di Blocco 100 €.
- **Doppio**: tiri di nuovo. Con tre doppi di fila vai in prigione.
- **Prigione**: ci finisci arrivando su "In Prigione!" o con una carta. Per uscire paghi 50 €, usi la carta "esci di prigione" oppure provi a fare un doppio (massimo 3 tentativi, poi paghi per forza).
- **Debiti**: se non hai abbastanza soldi, il gioco ipoteca le tue proprietà e, se serve, vende le case in automatico. Se non basta sei in **bancarotta**: le tue proprietà vanno al creditore, o tornano libere se il debito era con la banca.
- **Vince l'ultimo giocatore non in bancarotta.**
- Ogni mossa (tirare i dadi, decidere un acquisto, chiudere il turno) ha un tempo massimo di 2 minuti. Se scade, il server tira i dadi, rinuncia all'acquisto o chiude il turno al posto del giocatore; se il giocatore è disconnesso lo fa dopo pochi secondi. Aste e Murra hanno tempi propri, più brevi.
- **Murra**: minigioco a due. Ognuno sceglie in segreto quante dita mostrare (da 1 a 5) e dichiara la somma delle due mani (da 2 a 10). Vince chi si avvicina di più alla somma; a pari distanza si rigioca (dopo 5 pareggi decide la sorte). Ci sono 20 secondi per giocare, poi il server sceglie a caso. Si gioca in due casi:
  - **Asta rimasta a due**: quando resta un solo rivale in grado di rilanciare, può premere "Murra" invece di rilanciare e sfidare chi ha fatto l'offerta. Chi vince compra la proprietà a quel prezzo.
  - **Imprevisti**: due carte fanno scegliere un giocatore da sfidare; chi perde dà 150 € a chi vince.
- **Chat**: in sala d'attesa e in partita si possono scrivere messaggi brevi (massimo 120 caratteri, uno ogni 1,5 secondi). Il testo non viene filtrato né censurato: parole e link compaiono così come sono scritti. Restano anche le reazioni con le emoji.
- **Rivincita**: a fine partita l'host può avviarne un'altra. Partecipano solo i giocatori ancora connessi.

## Messaggi socket

| Client → Server | Server → Client |
|---|---|
| `room:create {nickname}` | `room:state` (stato completo, senza token) |
| `room:join {code, nickname}` | `game:anim {steps}` (dadi, movimenti, carte e mani di Murra da animare) |
| `room:rejoin {code, token}` | `chat:reaction {playerId, emoji}` |
| `room:leave` | `session:replaced` (la partita è stata aperta in un'altra scheda) |
| `game:start`, `game:roll`, `game:payJail`, `game:useJailCard` | |
| `game:buy`, `game:pass`, `game:endTurn` | |
| `game:manage {action: build\|sell\|mortgage\|unmortgage, cell}` | |
| `trade:propose {to, giveProps, getProps, giveMoney, getMoney, giveCards, getCards}` | |
| `trade:respond {accept}`, `trade:cancel` | |
| `auction:bid {amount}`, `auction:pass`, `auction:murra` | |
| `murra:choose {to}`, `murra:play {fingers, guess}` | |
| `chat:send {text}` | `chat:message {id, playerId, nickname, color, text}` |
| `chat:react {id}` | |

Ogni richiesta del client riceve una risposta `{ok, error?, message?}`. L'errore `ROOM_NOT_FOUND` indica che la stanza (o il proprio posto) non esiste più: il client torna alla home e propone di crearne una nuova.

## Deploy su Render (gratis)

1. **Crea un repository su GitHub** e carica i file:
   ```bash
   git init
   git add .
   git commit -m "Soveratopoly"
   git branch -M main
   git remote add origin https://github.com/TUO-UTENTE/soveratopoly.git
   git push -u origin main
   ```
2. Vai su [render.com](https://render.com) e accedi con GitHub.
3. Scegli **New → Blueprint** e seleziona il repository: Render legge `render.yaml` e configura tutto da solo.
   In alternativa scegli **New → Web Service**, collega il repository e imposta:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
   - Health Check Path: `/health`
4. Premi **Deploy** e attendi che lo stato diventi "Live".
5. Copia l'URL pubblico (es. `https://soveratopoly.onrender.com`) e mandalo ai tuoi amici. Il pulsante "Condividi link" della stanza genera un link che porta direttamente nella stanza.

### Cose da sapere sul piano Free

- Dopo **15 minuti senza visite** il server va in sospensione. Alla visita successiva ci mette fino a circa un minuto a ripartire. Nel frattempo il gioco mostra "Sto svegliando il server…" e si riconnette da solo.
- Quando il server si riavvia, **le partite in memoria si perdono**. Chi era in una stanza vede un messaggio chiaro e può crearne subito una nuova.
- Le stanze inattive da 30 minuti vengono eliminate automaticamente.
