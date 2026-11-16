# 🌊 Soveratopoly

Gioco da tavolo multiplayer online, gratuito, da giocare nel browser (anche da telefono).
Da 2 a 6 giocatori si sfidano a comprare Soverato: chi resta l'ultimo con dei soldi vince.

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
- **Proprietà libera**: puoi comprarla al prezzo indicato, oppure passare.
- **Proprietà di un altro**: paghi l'affitto.
  - Via (affitto base = 8% del prezzo): l'affitto raddoppia se il proprietario ha tutto il gruppo di colore. Con case e albergo vale ×4, ×11, ×28, ×36 e ×45.
  - Stazioni (Passaggio a Livello, Stazione degli Autobus, Stazione dei Treni, Marcello): 25, 50, 100 o 200 € in base a quante ne possiede il proprietario.
  - Raspa Elettrodomestici e Depuratore: dadi × 4, oppure dadi × 10 se il proprietario le ha entrambe.
- **Case**: si costruiscono solo con tutto il gruppo di colore, in modo uniforme (5 case = albergo). Si rivendono a metà prezzo.
- **Ipoteca**: incassi metà del prezzo, ma la proprietà non rende affitto. Per riscattarla paghi la metà del prezzo più il 10%.
- **Scambi**: nel tuo turno premi 🤝 accanto a un giocatore e proponi proprietà e/o soldi in cambio di sue proprietà e/o soldi. L'altro ha 45 secondi per accettare. Le proprietà di un gruppo con case non si possono scambiare. Gli scambi servono a completare i gruppi: senza, la partita rischierebbe di non finire mai.
- **Imprevisti / Probabilità**: carte a tema Soverato (soldi, spostamenti, prigione…).
- **Tasse**: Mazzo di rose di Rosario 200 €, Posto di Blocco 100 €.
- **Doppio**: tiri di nuovo. Con tre doppi di fila vai in prigione.
- **Prigione**: ci finisci arrivando su "In Prigione!" o con una carta. Per uscire paghi 50 € oppure provi a fare un doppio (massimo 3 tentativi, poi paghi per forza).
- **Debiti**: se non hai abbastanza soldi, il gioco ipoteca le tue proprietà e, se serve, vende le case in automatico. Se non basta sei in **bancarotta**: le tue proprietà vanno al creditore, o tornano libere se il debito era con la banca.
- **Vince l'ultimo giocatore non in bancarotta.**
- Ogni fase del turno ha un tempo massimo. Se scade (o il giocatore è disconnesso), il server tira i dadi, rinuncia all'acquisto o chiude il turno al posto suo. Scambi e gestione delle proprietà danno tempo extra, ma mai oltre tre volte la durata della fase.
- **Rivincita**: a fine partita l'host può avviarne un'altra. Partecipano solo i giocatori ancora connessi.

## Messaggi socket

| Client → Server | Server → Client |
|---|---|
| `room:create {nickname}` | `room:state` (stato completo, senza token) |
| `room:join {code, nickname}` | `game:anim {steps}` (dadi, movimenti, carte da animare) |
| `room:rejoin {code, token}` | `chat:reaction {playerId, emoji}` |
| `room:leave` | `session:replaced` (la partita è stata aperta in un'altra scheda) |
| `game:start`, `game:roll`, `game:payJail` | |
| `game:buy`, `game:pass`, `game:endTurn` | |
| `game:manage {action: build\|sell\|mortgage\|unmortgage, cell}` | |
| `trade:propose {to, giveProps, getProps, giveMoney, getMoney}` | |
| `trade:respond {accept}`, `trade:cancel` | |
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
