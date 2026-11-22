/**
 * Soveratopoly — server multiplayer.
 * Express serve i file statici, Socket.IO gestisce le partite.
 * Il server è l'unica autorità: tira i dadi, valida i turni, muove le pedine,
 * calcola affitti e carte. I client inviano solo intenzioni ("tira", "compra"...).
 * Tutto lo stato è in memoria: un riavvio cancella le stanze.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const B = require('./public/board-data.js');
const { CELLS, RULES, REACTIONS, euro } = B;

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.status(200).send('ok')); // health check di Render
app.use(express.static(path.join(__dirname, 'public'), {
  // Codice sempre rivalidato (dopo un deploy client e server restano allineati), immagini in cache.
  setHeaders: (res, file) => res.setHeader('Cache-Control', /[\\/]img[\\/]/.test(file) ? 'public, max-age=86400' : 'no-cache'),
}));

const server = http.createServer(app);
// Messaggi piccoli: nessun evento del gioco supera pochi KB.
const io = new Server(server, { pingInterval: 20000, pingTimeout: 20000, maxHttpBufferSize: 16 * 1024 });

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------
const { MAX_PLAYERS } = RULES;
const MAX_ROOMS = 300;                  // protezione della memoria sul piano gratuito
const PAWN_COLORS = ['#ff3b6b', '#2f80ff', '#22c55e', '#ffb000', '#a855f7', '#00c2c7', '#92400e', '#334155'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // niente I e O per evitare confusione
const BOARD_SIZE = CELLS.length;
const JAIL_MAX_TRIES = 3;
const MAX_DOUBLES = 3;

const MOVE_MS = 2 * 60 * 1000;          // tempo massimo per ogni mossa: tirare, decidere un acquisto, chiudere il turno
// Se chi deve muovere è disconnesso, il server aspetta molto meno prima di giocare al posto suo.
const OFFLINE_MOVE_MS = { roll: 15000, buy: 8000, end: 4000 };
const TRADE_MS = 45000;                 // tempo per rispondere a uno scambio
const REACTION_COOLDOWN_MS = 800;
const CHAT_COOLDOWN_MS = 1500;          // un messaggio ogni 1,5 s per giocatore
const CHAT_HISTORY = 40;                // messaggi conservati per chi entra o rientra
const AUCTION_START_MS = 15000;         // tempo per la prima offerta di un'asta
const AUCTION_BID_MS = 10000;           // dopo ogni rilancio il tempo riparte da qui
const MURRA_CHOOSE_MS = 20000;          // tempo per scegliere chi sfidare a Murra
const MURRA_OFFER_MS = 15000;           // tempo per accettare una sfida a Murra in un'asta
const MURRA_PICK_MS = 20000;            // tempo per scegliere dita e somma
const MURRA_MAX_ROUNDS = 30;            // oltre 30 mani la sfida viene chiusa: vince chi è avanti
const MURRA_MAX_IDLE = 2;               // ...e così dopo 2 mani in cui nessuno dei due ha giocato
const MAX_FINGERS = B.FINGERS.length;
const HOST_GRACE_MS = 10000;            // l'host che ricarica la pagina non perde il ruolo
const OFFLINE_MURRA_MS = 5000;         // Murra: chi deve decidere ed è scollegato da 5 s viene sostituito dal server
const OFFLINE_LOG_MS = 5000;           // disconnessioni più brevi (es. ricarica della pagina) non finiscono in cronologia
const LOBBY_GHOST_MS = 60 * 1000;       // in sala d'attesa un disconnesso viene rimosso dopo 60 s
const ROOM_EMPTY_MS = 5 * 60 * 1000;    // stanza eliminata dopo 5 min con tutti disconnessi
const ROOM_IDLE_MS = 30 * 60 * 1000;    // ...o dopo 30 min senza attività
const CLEANUP_EVERY_MS = 30 * 1000;
// Limiti anti-abuso: per connessione su tutti gli eventi, per indirizzo IP su connessioni e ingressi.
const EVENT_BURST = 20;                 // eventi consecutivi ammessi da una connessione...
const EVENT_RATE = 10;                  // ...che poi si ricaricano a 10 al secondo
const IP_WINDOW_MS = 60 * 1000;
const IP_LIMITS = { connect: 40, create: 20, join: 60 }; // per IP, ogni minuto

// Carte scritte dall'autore del gioco, in dialetto. "note" spiega l'effetto in italiano
// (compare sotto il testo della carta); "copies" dice quante volte la carta è nel mazzo.
const DECKS = {
  chance: {
    title: 'Imprevisti',
    cards: [
      { text: 'Jati alu Via.', note: 'Vai al VIA! e ritira 200 €.', kind: 'goto', to: 0 },
      { text: 'Jati a Piazza Roma.', note: 'Vai a Piazza Roma. Se passi dal VIA! ritiri 200 €.', kind: 'goto', to: 24 },
      { text: 'Jati ala Sisal.', note: 'Vai alla Sisal. Se passi dal VIA! ritiri 200 €.', kind: 'goto', to: 18 },
      { text: 'Chi culu e merda, jati ala Torre e Carlo V.', note: 'Vai alla Torre di Carlo V.', kind: 'goto', to: 39 },
      {
        text: 'Jati a Raspa o alu Depuratore, chira cchiù vicina. Però si l\'ava ‘ncunu tirati i dadi e li pagati puru ppe deci.',
        note: 'Vai al servizio più vicino (Raspa o Depuratore). Se è di un altro giocatore, tiri i dadi e paghi 10 volte il risultato.',
        kind: 'nearest', type: 'utility',
      },
      {
        text: 'Jati fino ala stazione cchiù vicina.',
        note: 'Vai alla stazione più vicina. Se è di un altro giocatore, paghi il doppio dell\'affitto.',
        kind: 'nearest', type: 'station', copies: 2,
      },
      { text: 'Jati alu Passaggio a livello.', note: 'Vai al Passaggio a Livello. Se passi dal VIA! ritiri 200 €.', kind: 'goto', to: 5 },
      { text: 'Chi culu, trovasti $50 supa u lungomare.', note: 'Ritiri 50 €.', kind: 'money', value: 50 },
      { text: 'Pijjasti nu bellu gratta vinci alu Bar Charlie, vinciati $150.', note: 'Ritiri 150 €.', kind: 'money', value: 150 },
      {
        text: 'Si boi u nesci da prigione a poi usara, sinnò ta stipi.',
        note: 'Tieni questa carta: ti fa uscire di prigione senza pagare. Puoi anche cederla in uno scambio.',
        kind: 'jailfree',
      },
      { text: 'Faciti 3 passi all\'ambersa.', note: 'Torni indietro di 3 caselle.', kind: 'back', value: 3 },
      { text: 'Jati ala caserma e dommu passati do Via.', note: 'Vai in prigione, senza passare dal VIA!.', kind: 'jail' },
      {
        text: 'Pagati $25 pe ogni casa e $100 pe ogni albergo, ti piazza u costruisci ah?',
        note: 'Paghi 25 € per ogni casa e 100 € per ogni albergo.', kind: 'repairs', house: 25, hotel: 100,
      },
      { text: 'Parcheggiasti supa i strisci cunnu, paga $20.', note: 'Paghi 20 €.', kind: 'money', value: -20 },
      { text: 'Hai u paghi i debiti chi dassau Gidari, paga $50 a tutti.', note: 'Paghi 50 € a ogni giocatore.', kind: 'payEach', value: 50 },
      // Le due sfide a Murra non sono nel documento delle carte: restano dal minigioco.
      { text: 'Sfida a Murra a 3 punti!', note: 'Scegli un giocatore e sfidalo: vince chi arriva a 3 punti, chi perde dà 150 € a chi vince.', kind: 'murra', value: 150, points: 3 },
      { text: 'Murra secca!', note: 'Scegli un giocatore e sfidalo: vince chi fa il primo punto, chi perde dà 150 € a chi vince.', kind: 'murra', value: 150, points: 1 },
    ],
  },
  chest: {
    title: 'Probabilità',
    cards: [
      { text: 'Jati fino alu Via.', note: 'Vai al VIA! e ritira 200 €.', kind: 'goto', to: 0 },
      { text: 'Nannata dissa u ti pijji u gelato. Ti dezza $200, ‘nculu.', note: 'Ritiri 200 €.', kind: 'money', value: 200 },
      { text: 'Hai u paghi a visita e l\'ospedale, paga $50.', note: 'Paghi 50 €.', kind: 'money', value: -50 },
      { text: 'Stasira fatigasti ala discoteca, ti facisti $60.', note: 'Ritiri 60 €.', kind: 'money', value: 60 },
      {
        text: 'Si boi u nesci da prigione a poi usara, sinnò ta stipi.',
        note: 'Tieni questa carta: ti fa uscire di prigione senza pagare. Puoi anche cederla in uno scambio.',
        kind: 'jailfree',
      },
      { text: 'Jati ala caserma.', note: 'Vai in prigione, senza passare dal VIA!.', kind: 'jail' },
      { text: 'Facisti u PR alu Mama\'s, pijjati $100.', note: 'Ritiri 100 €.', kind: 'money', value: 100 },
      { text: 'Facisti u tavulu alu Mama\'s sabato, paghi $25.', note: 'Paghi 25 €.', kind: 'money', value: -25, copies: 2 },
      { text: 'Auguri po compleanno, fatti dara $10 da busta.', note: 'Ogni giocatore ti dà 10 €.', kind: 'collectEach', value: 10 },
      { text: 'Chi culu e merda, trovasti $100 supa u corsu.', note: 'Ritiri 100 €.', kind: 'money', value: 100 },
      { text: 'Offristi nu burdellu e cocktail stasira, paga $100.', note: 'Paghi 100 €.', kind: 'money', value: -100, copies: 2 },
      { text: 'Accattasti nu gratta e vinci ma perdisti cunnu, paga $20.', note: 'Paghi 20 €.', kind: 'money', value: -20, copies: 2 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
/** @type {Map<string, any>} */
const rooms = new Map();

class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new GameError(code, message); };

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const die = () => crypto.randomInt(1, 7);

/** Codice stanza come lo scrive l'utente: maiuscolo e senza spazi. */
const normCode = (code) => String(code ?? '').trim().toUpperCase().slice(0, 8);

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

/** Nickname sicuro: niente HTML, max 14 caratteri, unico nella stanza. */
/** Nickname ripulito, senza il numero aggiunto per i doppioni. */
function baseNick(raw) {
  const text = String(raw || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, 14).join('') || 'Giocatore'; // Array.from: non spezza le emoji
}

function cleanNick(raw, room) {
  const base = baseNick(raw);
  let nick = base;
  for (let k = 2; room.players.some((p) => p.nickname.toLowerCase() === nick.toLowerCase()); k++) {
    nick = `${Array.from(base).slice(0, 12).join('')}${k}`;
  }
  return nick;
}

function log(room, text) {
  room.log.unshift(text);
  if (room.log.length > 60) room.log.pop();
}

const playerById = (room, id) => room.players.find((p) => p.id === id);
const current = (room) => room.players[room.turnIndex];
const alive = (room) => room.players.filter((p) => !p.bankrupt);
const connectedCount = (room) => room.players.filter((p) => p.connected).length;
const isCurrent = (room, p) => room.phase === 'playing' && current(room).id === p.id;
/** Indici delle caselle possedute da un giocatore. */
const ownedBy = (room, id) => Object.keys(room.props).map(Number).filter((i) => room.props[i].owner === id);
const touch = (room) => { room.lastActivity = Date.now(); };

/** Conteggio a finestra fissa per indirizzo IP: al massimo `max` volte ogni IP_WINDOW_MS per tipo di azione. */
const ipHits = new Map(); // `${tipo}:${ip}` -> { count, since }
function ipAllowed(kind, ip) {
  if (ip === null) return true; // sviluppo in locale: nessun limite
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const hit = ipHits.get(key);
  if (!hit || now - hit.since >= IP_WINDOW_MS) { ipHits.set(key, { count: 1, since: now }); return true; }
  return ++hit.count <= IP_LIMITS[kind];
}

/**
 * Indirizzo del client: dietro il proxy di Render è il primo di X-Forwarded-For.
 * null per le connessioni dirette da questa macchina (sviluppo e test), che non hanno limiti per IP.
 */
function clientIp(socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  const addr = socket.handshake.address;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr) ? null : addr;
}

// ---------------------------------------------------------------------------
// Stanze e giocatori
// ---------------------------------------------------------------------------
function createRoom() {
  if (rooms.size >= MAX_ROOMS) fail('BUSY', 'Troppe stanze aperte in questo momento: riprova tra poco.');
  const room = {
    code: newCode(),
    hostId: null,
    phase: 'lobby', // lobby | playing | finished
    players: [],
    props: {},      // cella -> { owner, houses, mortgaged }
    turnIndex: 0,
    turn: null,     // { phase: roll|buy|end, doubles, rollAgain, pendingBuy, deadline, limit }
    decks: {},
    lastDice: null,
    winnerId: null,
    trade: null,    // { from, to, give: {props, money}, get: {props, money}, expires }
    tradeTimer: null,
    auction: null,  // { cell, bid, bidderId, passed: [id] } mentre una proprietà è all'asta
    murra: null,    // { kind, stake, a, b, picks, round } durante una sfida a Murra
    chat: [],       // ultimi messaggi: { id, playerId, nickname, color, text }
    chatSeq: 0,
    log: [],
    timer: null,
    lastActivity: Date.now(),
    emptySince: null,
  };
  rooms.set(room.code, room);
  return room;
}

function deleteRoom(room) {
  clearTimeout(room.timer);
  clearTimeout(room.tradeTimer);
  rooms.delete(room.code);
}

/** jailCards: carte "esci di prigione" in mano, ognuna col nome del mazzo da cui viene. */
const freshStats = () => ({ money: RULES.START_MONEY, pos: 0, inJail: false, jailTurns: 0, bankrupt: false, jailCards: [] });

function addPlayer(room, nickname) {
  if (room.players.length >= MAX_PLAYERS) fail('ROOM_FULL', `La stanza è piena (massimo ${MAX_PLAYERS} giocatori).`);
  const used = new Set(room.players.map((p) => p.color));
  const player = {
    id: crypto.randomUUID().slice(0, 8),
    token: crypto.randomUUID(), // segreto: serve per rientrare nello stesso posto
    nickname: cleanNick(nickname, room),
    color: PAWN_COLORS.find((c) => !used.has(c)),
    socketId: null,
    connected: false,
    disconnectedAt: null,
    lastReaction: 0,
    lastChat: 0,
    ...freshStats(),
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  return player;
}

/**
 * Passa il ruolo di host al primo giocatore connesso, se l'host non c'è più.
 * Con graceMs l'host appena disconnesso (es. ricarica della pagina) conserva il ruolo.
 * Ritorna true se l'host è cambiato.
 */
function fixHost(room, graceMs = 0) {
  const host = playerById(room, room.hostId);
  if (host && (host.connected || Date.now() - host.disconnectedAt < graceMs)) return false;
  const next = room.players.find((p) => p.connected) || room.players[0];
  const nextId = next ? next.id : null;
  if (nextId === room.hostId) return false;
  room.hostId = nextId;
  return true;
}

/** Stato inviato ai client: niente token, niente socket id. */
function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: room.players.map((p) => ({
      id: p.id, nickname: p.nickname, color: p.color, money: p.money, pos: p.pos,
      inJail: p.inJail, bankrupt: p.bankrupt, connected: p.connected, jailCards: p.jailCards.length,
    })),
    props: room.props,
    turn: room.turn && {
      playerId: current(room).id, phase: room.turn.phase,
      pendingBuy: room.turn.pendingBuy, deadline: room.turn.deadline,
    },
    trade: room.trade,
    auction: room.auction && { ...room.auction, challengerId: murraChallenger(room) },
    // Le scelte restano segrete fino alla rivelazione: ai client arriva solo chi ha già giocato.
    murra: room.murra && {
      kind: room.murra.kind, stake: room.murra.stake, goal: room.murra.goal, a: room.murra.a, b: room.murra.b,
      stage: room.murra.stage, score: room.murra.score,
      round: room.murra.round, picked: Object.keys(room.murra.picks),
    },
    lastDice: room.lastDice,
    winnerId: room.winnerId,
    log: room.log.slice(0, 40),
    serverNow: Date.now(),
  };
}

const broadcast = (room) => io.to(room.code).emit('room:state', publicState(room));

/** Collega un socket a un giocatore e invia lo stato aggiornato a tutta la stanza. */
function attach(socket, room, player) {
  // Questo socket occupava un altro posto (es. un'altra stanza): prima lo libero.
  if (socket.data.playerId && socket.data.playerId !== player.id) detach(socket);
  // Stesso giocatore già aperto in un'altra scheda: la vecchia viene avvisata e scollegata.
  const old = player.socketId && player.socketId !== socket.id && io.sockets.sockets.get(player.socketId);
  if (old) { old.leave(room.code); old.data = {}; old.emit('session:replaced'); }

  socket.join(room.code);
  socket.data = { code: room.code, playerId: player.id };
  Object.assign(player, { socketId: socket.id, connected: true, disconnectedAt: null });
  if (player.offlineLogged) {
    player.offlineLogged = false;
    if (room.phase === 'playing') log(room, `🔌 ${player.nickname} è rientrato in partita.`);
  }
  room.emptySince = null;
  touch(room);
  fixHost(room, HOST_GRACE_MS);
  if (isCurrent(room, player)) setTimer(room, true); // chi rientra nel proprio turno riprende il tempo normale
  // Lo stato parte dopo la risposta (ack), così il client conosce già il proprio id.
  setImmediate(() => broadcast(room));
  return { code: room.code, playerId: player.id, token: player.token, chat: room.chat };
}

/** Scollega un socket dal suo giocatore: il posto resta riservato per il rientro. */
function detach(socket) {
  const room = rooms.get(socket.data.code);
  const player = room && playerById(room, socket.data.playerId);
  socket.data = {};
  if (!player || player.socketId !== socket.id) return;
  socket.leave(room.code);
  Object.assign(player, { socketId: null, connected: false, disconnectedAt: Date.now() });
  if (!connectedCount(room)) room.emptySince = Date.now();
  if (room.phase === 'playing' && !player.bankrupt) {
    const since = player.disconnectedAt;
    setTimeout(() => {
      if (rooms.get(room.code) !== room || room.phase !== 'playing' || player.connected
        || player.disconnectedAt !== since || player.bankrupt) return;
      player.offlineLogged = true;
      log(room, `📴 ${player.nickname} si è disconnesso: può rientrare con lo stesso codice e lo stesso nickname.`);
      broadcast(room);
    }, OFFLINE_LOG_MS);
  }
  if (room.murra) watchMurraAbsence(room, player);
  // Se era il suo turno, accorcia il timer: il gioco non resta bloccato.
  if (isCurrent(room, player)) setTimer(room, true);
  if (room.hostId === player.id) {
    setTimeout(() => {
      if (rooms.get(room.code) === room && fixHost(room, HOST_GRACE_MS)) broadcast(room);
    }, HOST_GRACE_MS + 100);
  }
  broadcast(room);
}

// ---------------------------------------------------------------------------
// Turni
// ---------------------------------------------------------------------------
function startGame(room) {
  // Chi è uscito o è disconnesso non partecipa alla (nuova) partita.
  room.players = room.players.filter((p) => p.connected);
  fixHost(room);
  cancelTrade(room);
  room.auction = null;
  room.murra = null;
  room.phase = 'playing';
  room.winnerId = null;
  room.lastDice = null;
  room.props = {};
  CELLS.forEach((_, i) => { if (B.isBuyable(i)) room.props[i] = { owner: null, houses: 0, mortgaged: false }; });
  room.players.forEach((p) => Object.assign(p, freshStats()));
  room.decks = { chance: newDeck(room, 'chance'), chest: newDeck(room, 'chest') };
  room.turnIndex = crypto.randomInt(room.players.length);
  room.log = [];
  log(room, `🎲 La partita comincia! Ognuno parte con ${euro(RULES.START_MONEY)}.`);
  startTurn(room);
}

function startTurn(room) {
  const p = current(room);
  room.turn = { phase: 'roll', doubles: 0, rollAgain: false, pendingBuy: null, deadline: 0, limit: 0 };
  log(room, `👉 Tocca a ${p.nickname}${p.inJail ? ' (in prigione)' : ''}.`);
  setTimer(room);
}

/**
 * Avvia il timer della mossa corrente: se scade, il server gioca al posto del giocatore.
 * Con extend=true la mossa è la stessa ma il giocatore si è scollegato o ricollegato:
 * la scadenza viene ricalcolata, senza mai superare il tempo massimo contato dall'inizio
 * della mossa. Gestire proprietà o scambi non dà tempo in più.
 */
function setTimer(room, extend = false) {
  if (room.auction || room.murra) return; // aste e Murra hanno il proprio timer
  clearTimeout(room.timer);
  if (room.phase !== 'playing' || !room.turn) return;
  const now = Date.now();
  if (!extend) room.turn.limit = now + MOVE_MS;
  const wait = current(room).connected ? MOVE_MS : OFFLINE_MOVE_MS[room.turn.phase];
  const ms = Math.max(0, Math.min(wait, room.turn.limit - now));
  room.turn.deadline = now + ms;
  room.timer = setTimeout(() => autoPlay(room), ms);
}

function autoPlay(room) {
  if (rooms.get(room.code) !== room || room.phase !== 'playing') return;
  const p = current(room);
  try {
    if (room.turn.phase === 'roll') { log(room, `⏰ Tempo scaduto: tiro automatico per ${p.nickname}.`); doRoll(room, p); }
    else if (room.turn.phase === 'buy') { log(room, `⏰ Tempo scaduto per ${p.nickname}.`); doPass(room, p); }
    else endTurn(room);
  } catch (e) { console.error('autoPlay', e); endTurn(room); }
  broadcast(room);
}

function endTurn(room) {
  clearTimeout(room.timer);
  room.auction = null;
  room.murra = null;
  cancelTrade(room, '⌛ Scambio annullato: il turno è finito.');
  if (room.phase !== 'playing') return;
  const n = room.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (room.turnIndex + k) % n;
    if (!room.players[idx].bankrupt) { room.turnIndex = idx; break; }
  }
  startTurn(room);
}

/** Dopo ogni azione: invia l'animazione ai client e decide la fase successiva. */
function finishAction(room, anim = []) {
  if (anim.length) io.to(room.code).emit('game:anim', { steps: anim });
  if (room.phase !== 'playing') return;
  const p = current(room);
  if (p.bankrupt) return endTurn(room);
  if (room.murra) return beginMurra(room); // una carta ha lanciato una sfida a Murra
  if (room.turn.pendingBuy !== null) room.turn.phase = 'buy';
  else if (room.turn.rollAgain && !p.inJail) {
    room.turn.phase = 'roll';
    log(room, `🔁 ${p.nickname} ha fatto doppio: tira ancora!`);
  } else room.turn.phase = 'end';
  setTimer(room);
}

// ---------------------------------------------------------------------------
// Dadi e movimento
// ---------------------------------------------------------------------------
function doRoll(room, p) {
  const anim = [];
  const d = [die(), die()];
  const sum = d[0] + d[1];
  const doubles = d[0] === d[1];
  room.lastDice = d;
  room.turn.rollAgain = false;
  anim.push({ t: 'dice', dice: d });
  log(room, `🎲 ${p.nickname} ha tirato ${d[0]} + ${d[1]} = ${sum}${doubles ? ' (doppio!)' : ''}`);

  if (applyJailAndDoubles(room, p, doubles, anim)) {
    moveForward(room, p, sum, anim);
    land(room, p, anim, sum);
  }
  finishAction(room, anim);
}

/** Regole di prigione e doppi. Ritorna true se dopo il tiro la pedina si muove. */
function applyJailAndDoubles(room, p, doubles, anim) {
  if (p.inJail) {
    if (doubles) {
      p.inJail = false; p.jailTurns = 0;
      log(room, `🔓 ${p.nickname} esce di prigione con un doppio!`);
      return true; // esce e si muove, ma senza tiro extra
    }
    if (++p.jailTurns < JAIL_MAX_TRIES) {
      log(room, `🔒 ${p.nickname} resta in prigione (tentativo ${p.jailTurns}/${JAIL_MAX_TRIES}).`);
      return false;
    }
    log(room, `🔓 Ultimo tentativo fallito: ${p.nickname} deve pagare la cauzione.`);
    p.inJail = false; p.jailTurns = 0;
    return pay(room, p, null, RULES.JAIL_FINE, 'la cauzione');
  }
  if (!doubles) return true;
  if (++room.turn.doubles >= MAX_DOUBLES) {
    log(room, `🚨 Tre doppi di fila! ${p.nickname} va in prigione.`);
    sendToJail(room, p, anim);
    return false;
  }
  room.turn.rollAgain = true;
  return true;
}

function moveForward(room, p, steps, anim) {
  const path = [];
  for (let k = 0; k < steps; k++) {
    p.pos = (p.pos + 1) % BOARD_SIZE;
    path.push(p.pos);
    if (p.pos === 0) {
      p.money += RULES.GO_SALARY;
      log(room, `💰 ${p.nickname} passa dal VIA! e ritira ${euro(RULES.GO_SALARY)}.`);
    }
  }
  if (path.length) anim.push({ t: 'move', playerId: p.id, path });
}

/** Indietro di alcune caselle: non si ritira nulla passando dal VIA!. */
function moveBackward(p, steps, anim) {
  const path = [];
  for (let k = 0; k < steps; k++) {
    p.pos = (p.pos - 1 + BOARD_SIZE) % BOARD_SIZE;
    path.push(p.pos);
  }
  anim.push({ t: 'move', playerId: p.id, path });
}

function sendToJail(room, p, anim) {
  Object.assign(p, { pos: RULES.JAIL_CELL, inJail: true, jailTurns: 0 });
  room.turn.rollAgain = false;
  anim.push({ t: 'jump', playerId: p.id, to: RULES.JAIL_CELL, jail: true });
}

/**
 * Effetto della casella su cui il giocatore è arrivato.
 * special (solo arrivando con una carta): { rentMult } moltiplica l'affitto,
 * { rollForRent } fa tirare i dadi apposta e pagare quel multiplo del risultato.
 */
function land(room, p, anim, diceSum, cardDepth = 0, special = {}) {
  const cell = CELLS[p.pos];
  switch (cell.type) {
    case 'prop': case 'station': case 'utility': {
      const pr = room.props[p.pos];
      if (!pr.owner) { room.turn.pendingBuy = p.pos; break; }
      if (pr.owner === p.id) break;
      if (pr.mortgaged) { log(room, `🏚️ ${cell.name} è ipotecata: niente affitto.`); break; }
      let rent = calcRent(room, p.pos, diceSum) * (special.rentMult || 1);
      if (special.rollForRent) {
        const d = [die(), die()];
        room.lastDice = d;
        anim.push({ t: 'dice', dice: d });
        rent = (d[0] + d[1]) * special.rollForRent;
        log(room, `🎲 ${p.nickname} tira ${d[0]} + ${d[1]} per l'affitto: paga ${special.rollForRent} volte il risultato.`);
      }
      pay(room, p, playerById(room, pr.owner), rent, `l'affitto di ${cell.name}`);
      break;
    }
    case 'tax':
      pay(room, p, null, cell.amount, cell.name);
      break;
    case 'chance': case 'chest':
      // Una carta può spostare su un'altra casella "carta": al massimo due carte di fila.
      if (cardDepth < 2) drawCard(room, p, cell.type, anim, diceSum, cardDepth);
      break;
    case 'gotojail':
      log(room, `🚓 ${p.nickname} finisce In Prigione!`);
      sendToJail(room, p, anim);
      break;
    case 'parking':
      // A fine azione (vedi finishAction) chi è arrivato qui può sfidare un giocatore a Murra.
      room.murra = newMurra('parking', p.id, null, RULES.PARKING_MURRA_STAKE);
      break;
    default: break; // VIA!, prigione in transito: nessun effetto
  }
}

function calcRent(room, i, diceSum) {
  const { type } = CELLS[i];
  const { owner, houses } = room.props[i];
  const ownedOfType = () => ownedBy(room, owner).filter((k) => CELLS[k].type === type).length;
  if (type === 'station') return RULES.STATION_RENT[ownedOfType()];
  if (type === 'utility') return diceSum * RULES.UTILITY_MULT[ownedOfType()];
  const fullGroup = B.groupOf(i).every((c) => room.props[c].owner === owner);
  return B.propRent(i, houses, fullGroup);
}

/** Mazzo mescolato. La carta "esci di prigione" resta fuori finché un giocatore la tiene in mano. */
function newDeck(room, deckName) {
  const held = room.players.some((p) => p.jailCards.includes(deckName));
  const cards = DECKS[deckName].cards.flatMap((c) => Array(c.copies || 1).fill(c));
  return shuffle(cards.filter((c) => c.kind !== 'jailfree' || !held));
}

/** Indici delle caselle di un certo tipo (stazioni, servizi). */
const cellsOfType = (type) => CELLS.map((c, i) => (c.type === type ? i : -1)).filter((i) => i >= 0);

function drawCard(room, p, deckName, anim, diceSum, cardDepth) {
  const { title } = DECKS[deckName];
  if (!room.decks[deckName].length) room.decks[deckName] = newDeck(room, deckName);
  const card = room.decks[deckName].shift();
  anim.push({ t: 'card', deck: deckName, title, text: card.text, note: card.note, playerId: p.id });
  log(room, `🃏 ${p.nickname} pesca ${title}: "${card.text}" (${card.note})`);

  const others = alive(room).filter((o) => o.id !== p.id);
  const landAgain = (special) => land(room, p, anim, diceSum, cardDepth + 1, special);
  switch (card.kind) {
    case 'money':
      if (card.value >= 0) p.money += card.value;
      else pay(room, p, null, -card.value, 'la carta');
      break;
    case 'goto':
      moveForward(room, p, (card.to - p.pos + BOARD_SIZE) % BOARD_SIZE, anim);
      landAgain();
      break;
    case 'nearest': { // stazione o servizio più vicino, andando avanti
      const cells = cellsOfType(card.type);
      const target = cells.find((c) => c > p.pos) ?? cells[0];
      moveForward(room, p, (target - p.pos + BOARD_SIZE) % BOARD_SIZE, anim);
      landAgain(card.type === 'station' ? { rentMult: 2 } : { rollForRent: 10 });
      break;
    }
    case 'jailfree':
      p.jailCards.push(deckName); // tornerà nel mazzo quando verrà usata
      break;
    case 'back':
      moveBackward(p, card.value, anim);
      landAgain();
      break;
    case 'jail':
      sendToJail(room, p, anim);
      break;
    case 'payEach':
      for (const o of others) pay(room, p, o, card.value, 'la carta'); // pay() si ferma da solo dopo una bancarotta
      break;
    case 'collectEach':
      for (const o of others) pay(room, o, p, card.value, 'il regalo');
      break;
    case 'murra':
      // La sfida parte a fine azione (vedi finishAction), dopo l'animazione della carta.
      room.murra = newMurra('card', p.id, null, card.value, card.points);
      break;
    case 'repairs': {
      const total = ownedBy(room, p.id).reduce((sum, i) => {
        const { houses } = room.props[i];
        return sum + (houses === RULES.MAX_HOUSES ? card.hotel : houses * card.house);
      }, 0);
      if (total) pay(room, p, null, total, 'i lavori');
      else log(room, `😅 ${p.nickname} non ha case: non paga nulla.`);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Soldi, debiti, bancarotta
// ---------------------------------------------------------------------------
/**
 * Pagamento verso un giocatore (to) o verso la banca (to = null).
 * Se i soldi non bastano, il server ipoteca e vende case in automatico.
 * Se ancora non basta, chi paga va in bancarotta. Ritorna false in caso di bancarotta.
 */
function pay(room, from, to, amount, reason) {
  if (amount <= 0 || from.bankrupt) return true;
  if (to && to.bankrupt) return true; // nessun affitto a chi è già fuori
  if (from.money < amount) liquidate(room, from, amount);
  if (from.money >= amount) {
    from.money -= amount;
    if (to) to.money += amount;
    log(room, `💸 ${from.nickname} paga ${euro(amount)} ${to ? `a ${to.nickname} ` : ''}per ${reason}.`);
    return true;
  }
  if (to) to.money += from.money;
  from.money = 0;
  log(room, `💥 ${from.nickname} non riesce a pagare ${euro(amount)} per ${reason}!`);
  bankrupt(room, from, to);
  return false;
}

/**
 * Raccolta automatica di soldi per coprire un debito, con le stesse regole delle
 * azioni manuali: prima ipoteca le proprietà dei gruppi senza case (dalla più
 * economica), poi vende una casa alla volta (liberando così altri gruppi).
 */
function liquidate(room, p, target) {
  const mine = ownedBy(room, p.id);
  const props = room.props;
  let mortgaged = 0, sold = 0, raised = 0;
  while (p.money < target) {
    const free = mine
      .filter((i) => !props[i].mortgaged && B.groupOf(i).every((c) => props[c].houses === 0))
      .sort((a, b) => CELLS[a].price - CELLS[b].price)[0];
    if (free !== undefined) {
      props[free].mortgaged = true;
      p.money += B.mortgageValue(free); raised += B.mortgageValue(free); mortgaged++;
      continue;
    }
    const built = mine.filter((i) => props[i].houses > 0).sort((a, b) => props[b].houses - props[a].houses)[0];
    if (built === undefined) break; // non resta più nulla da vendere
    props[built].houses--;
    p.money += B.houseSellValue(built); raised += B.houseSellValue(built); sold++;
  }
  if (!raised) return;
  const parts = [mortgaged && `ipoteca ${mortgaged} proprietà`, sold && `vende ${sold} ${sold === 1 ? 'casa' : 'case'}`].filter(Boolean);
  log(room, `🏦 ${p.nickname} ${parts.join(' e ')} per raccogliere ${euro(raised)}.`);
}

/** Bancarotta: le proprietà vanno al creditore, oppure tornano libere se il debito era con la banca. */
function bankrupt(room, p, creditor) {
  p.bankrupt = true; p.inJail = false;
  for (const i of ownedBy(room, p.id)) {
    Object.assign(room.props[i], creditor
      ? { owner: creditor.id, houses: 0 } // l'eventuale ipoteca resta
      : { owner: null, houses: 0, mortgaged: false });
  }
  if (creditor) creditor.jailCards.push(...p.jailCards);
  p.jailCards = []; // senza creditore tornano nei mazzi al prossimo rimescolamento
  log(room, `☠️ ${p.nickname} è in bancarotta! ${creditor ? `Le sue proprietà vanno a ${creditor.nickname}.` : 'Le sue proprietà tornano libere.'}`);
  if (room.trade && [room.trade.from, room.trade.to].includes(p.id)) cancelTrade(room);
  if (room.auction?.bidderId === p.id) Object.assign(room.auction, { bid: 0, bidderId: null }); // l'asta riparte dalla base d'asta
  checkWinner(room);
}

function checkWinner(room) {
  const left = alive(room);
  if (room.phase !== 'playing' || left.length > 1) return;
  room.phase = 'finished';
  room.winnerId = left[0]?.id || null;
  room.turn = null;
  room.auction = null;
  room.murra = null;
  clearTimeout(room.timer);
  cancelTrade(room);
  if (left[0]) log(room, `🏆 ${left[0].nickname} vince Soveratopoly!`);
}

// ---------------------------------------------------------------------------
// Acquisti, case, ipoteche
// ---------------------------------------------------------------------------
function doBuy(room, p) {
  const i = room.turn.pendingBuy;
  const cell = CELLS[i];
  if (p.money < cell.price) fail('NO_MONEY', 'Non hai abbastanza soldi.');
  p.money -= cell.price;
  room.props[i].owner = p.id;
  room.turn.pendingBuy = null;
  log(room, `🏠 ${p.nickname} compra ${cell.name} per ${euro(cell.price)}.`);
  finishAction(room);
}

/** Chi rinuncia all'acquisto manda la proprietà all'asta. */
function doPass(room, p) {
  const i = room.turn.pendingBuy;
  log(room, `🙅 ${p.nickname} non compra ${CELLS[i].name}: va all'asta!`);
  room.turn.pendingBuy = null;
  room.turn.phase = 'auction';
  room.auction = { cell: i, bid: 0, bidderId: null, passed: [] };
  armAuction(room, AUCTION_START_MS);
}

// ---------------------------------------------------------------------------
// Aste: partecipano tutti i giocatori ancora in gioco, compreso chi ha rinunciato.
// Si rilancia liberamente; a ogni offerta il tempo riparte. Vince l'offerta più alta.
// ---------------------------------------------------------------------------
/** Prima offerta: almeno metà del prezzo di listino; poi si rilancia di almeno AUCTION_MIN_STEP. */
const auctionMinBid = (room) => (room.auction.bidderId
  ? room.auction.bid + RULES.AUCTION_MIN_STEP
  : B.auctionStart(room.auction.cell));

/** Chi può ancora rilanciare contro l'offerta attuale (non ritirato, connesso, con abbastanza soldi). */
function auctionRivals(room) {
  const a = room.auction;
  const min = auctionMinBid(room);
  return alive(room).filter((p) => p.id !== a.bidderId && p.connected && !a.passed.includes(p.id) && p.money >= min);
}
const auctionSettled = (room) => auctionRivals(room).length === 0;

/** In un'asta rimasta a due, l'unico rivale può sfidare a Murra chi ha fatto l'offerta. Ritorna il suo id. */
function murraChallenger(room) {
  if (!room.auction?.bidderId || room.auction.murraRefused || room.murra) return null;
  const rivals = auctionRivals(room);
  return rivals.length === 1 ? rivals[0].id : null;
}

/** (Ri)avvia il conto alla rovescia dell'asta, oppure la chiude se nessuno può più offrire. */
function armAuction(room, ms) {
  clearTimeout(room.timer);
  if (auctionSettled(room)) return endAuction(room);
  room.turn.deadline = Date.now() + ms;
  room.timer = setTimeout(() => {
    if (rooms.get(room.code) !== room || !room.auction) return;
    endAuction(room);
    broadcast(room);
  }, ms);
}

function endAuction(room) {
  clearTimeout(room.timer);
  const { cell, bid, bidderId } = room.auction;
  room.auction = null;
  const winner = bidderId && playerById(room, bidderId);
  if (winner && !winner.bankrupt && winner.money >= bid) {
    winner.money -= bid;
    room.props[cell].owner = winner.id;
    log(room, `🔨 Aggiudicata! ${winner.nickname} si prende ${CELLS[cell].name} per ${euro(bid)}.`);
  } else {
    log(room, `🔨 Asta deserta: ${CELLS[cell].name} resta libera.`);
  }
  finishAction(room); // il turno riprende da dove si era fermato
}

// ---------------------------------------------------------------------------
// Murra: minigioco a due. A ogni mano ognuno mostra da 1 a 5 dita e dichiara la
// somma delle due mani (2-10). Chi indovina la somma fa un punto (se indovinano
// entrambi, o nessuno, il punto non viene assegnato). Vince chi arriva a 3 punti; nelle aste basta il primo.
// Si gioca in tre casi (kind):
//  - 'auction': in un'asta rimasta a due, il rivale sfida chi ha fatto l'offerta.
//               Lo sfidato può accettare o rifiutare; chi vince compra al prezzo offerto.
//  - 'card':    carta Imprevisti: si sceglie un avversario, che non può rifiutare.
//  - 'parking': chi arriva sul Parcheggio Gratuito può sfidare un giocatore (o rinunciare);
//               lo sfidato non può rifiutare. In questi due casi chi perde paga la posta.
// Fasi (stage): 'choose' = chi lancia sceglie l'avversario, 'offer' = lo sfidato decide
// se accettare, 'play' = si giocano le mani.
// ---------------------------------------------------------------------------
/** a = chi lancia la sfida, b = lo sfidato (null finché non viene scelto). */
const newMurra = (kind, a, b, stake = 0, goal = kind === 'auction' ? RULES.MURRA_AUCTION_POINTS : RULES.MURRA_POINTS) => ({
  kind, stake, a, b, stage: kind === 'auction' ? 'offer' : 'choose',
  goal, // punti per vincere
  picks: {}, round: 1, score: {}, idle: 0,
});

const randomMurraPick = () => {
  const fingers = crypto.randomInt(1, MAX_FINGERS + 1);
  return { fingers, guess: fingers + crypto.randomInt(1, MAX_FINGERS + 1) };
};

/** Mette il turno in fase "murra" e avvia la prima fase della sfida. */
function beginMurra(room) {
  const m = room.murra;
  room.turn.phase = 'murra';
  // Carta Imprevisti con un solo avversario possibile: la scelta è obbligata.
  const others = alive(room).filter((p) => p.id !== m.a);
  if (m.kind === 'card' && others.length === 1) return setMurraOpponent(room, others[0]);
  armMurra(room);
}

/** Sfida da carta o da parcheggio: l'avversario scelto non può rifiutare. */
function setMurraOpponent(room, opponent) {
  const m = room.murra;
  m.b = opponent.id;
  log(room, `🤜 ${playerById(room, m.a).nickname} sfida ${opponent.nickname} a Murra: chi perde dà ${euro(m.stake)} a chi vince!`);
  startMurraPlay(room);
}

function startMurraPlay(room) {
  const m = room.murra;
  m.stage = 'play';
  m.score = { [m.a]: 0, [m.b]: 0 };
  armMurra(room);
}

/** Avvia il conto alla rovescia della fase corrente della Murra. */
function armMurra(room) {
  clearTimeout(room.timer);
  const m = room.murra;
  const connected = (id) => playerById(room, id).connected;
  // Chi deve decidere ma è disconnesso non blocca la partita: vale come tempo scaduto.
  if ((m.stage === 'offer' && !connected(m.b)) || (m.stage === 'choose' && !connected(m.a))) return murraTimeout(room);
  if (m.stage === 'play') {
    // Chi è disconnesso gioca a caso, così la sfida non resta ferma.
    const absent = [m.a, m.b].filter((id) => !m.picks[id] && !connected(id));
    for (const id of absent) m.picks[id] = randomMurraPick();
    if (m.picks[m.a] && m.picks[m.b]) {
      if (absent.length === 2) m.idle++;
      return resolveMurraRound(room);
    }
  }
  const ms = { choose: MURRA_CHOOSE_MS, offer: MURRA_OFFER_MS, play: MURRA_PICK_MS }[m.stage];
  room.turn.deadline = Date.now() + ms;
  room.timer = setTimeout(() => {
    if (rooms.get(room.code) !== room || room.murra !== m) return;
    murraTimeout(room);
    broadcast(room);
  }, ms);
}

/**
 * Chi deve decidere nella Murra si è scollegato: se non torna entro OFFLINE_MURRA_MS
 * il server decide subito per lui, invece di far aspettare tutti fino allo scadere del tempo.
 */
function watchMurraAbsence(room, p) {
  const m = room.murra;
  const { stage, round } = m;
  const decides = (stage === 'offer' && m.b === p.id) || (stage === 'choose' && m.a === p.id)
    || (stage === 'play' && [m.a, m.b].includes(p.id) && !m.picks[p.id]);
  if (!decides) return;
  setTimeout(() => {
    if (rooms.get(room.code) !== room || room.murra !== m || m.stage !== stage || m.round !== round || p.connected) return;
    if (stage !== 'play') murraTimeout(room);
    else {
      m.picks[p.id] ??= randomMurraPick();
      if (m.picks[m.a] && m.picks[m.b]) resolveMurraRound(room);
    }
    broadcast(room);
  }, OFFLINE_MURRA_MS);
}

/** Tempo scaduto: il server decide al posto di chi non l'ha fatto. */
function murraTimeout(room) {
  const m = room.murra;
  if (m.stage === 'offer') return refuseMurra(room);
  if (m.stage === 'choose') {
    if (m.kind === 'parking') return skipMurra(room); // sfida facoltativa: senza scelta non si gioca
    const others = alive(room).filter((p) => p.id !== m.a);
    return setMurraOpponent(room, others[crypto.randomInt(others.length)]);
  }
  if (!Object.keys(m.picks).length) m.idle++; // nessuno dei due ha giocato
  for (const id of [m.a, m.b]) m.picks[id] ??= randomMurraPick();
  resolveMurraRound(room);
}

/** Asta: lo sfidato rifiuta (o non risponde). L'asta riprende e la sfida non si può riproporre sulla stessa offerta. */
function refuseMurra(room) {
  const m = room.murra;
  room.murra = null;
  room.auction.murraRefused = true;
  log(room, `🙅 ${playerById(room, m.b).nickname} rifiuta la sfida a Murra: l'asta continua.`);
  room.turn.phase = 'auction';
  armAuction(room, AUCTION_BID_MS);
}

/** Parcheggio Gratuito: chi poteva sfidare rinuncia. */
function skipMurra(room) {
  const m = room.murra;
  room.murra = null;
  log(room, `🅿️ ${playerById(room, m.a).nickname} non sfida nessuno.`);
  finishAction(room);
}

/** Entrambi hanno giocato: rivela le mani, assegna l'eventuale punto e controlla se qualcuno ha vinto. */
function resolveMurraRound(room) {
  const m = room.murra;
  const [pa, pb] = [m.picks[m.a], m.picks[m.b]];
  const [na, nb] = [playerById(room, m.a).nickname, playerById(room, m.b).nickname];
  const sum = pa.fingers + pb.fingers;
  const [hitA, hitB] = [pa.guess === sum, pb.guess === sum];
  const scorerId = hitA === hitB ? null : hitA ? m.a : m.b; // entrambi o nessuno: niente punto
  if (scorerId) m.score[scorerId]++;
  const [sa, sb] = [m.score[m.a], m.score[m.b]];

  let winnerId = sa >= m.goal ? m.a : sb >= m.goal ? m.b : null;
  // Sfida troppo lunga, o giocatori assenti: vince chi è avanti; a pari punti decide la sorte.
  const cutShort = !winnerId && (m.round >= MURRA_MAX_ROUNDS || m.idle >= MURRA_MAX_IDLE);
  if (cutShort) winnerId = sa > sb ? m.a : sb > sa ? m.b : crypto.randomInt(2) ? m.a : m.b;

  io.to(room.code).emit('game:anim', {
    steps: [{ t: 'murra', a: { id: m.a, ...pa }, b: { id: m.b, ...pb }, sum, scorerId, score: { ...m.score }, goal: m.goal, winnerId, cutShort }],
  });
  log(room, `🤜 Murra: ${na} mostra ${pa.fingers} e dice ${pa.guess}, ${nb} mostra ${pb.fingers} e dice ${pb.guess}. Somma ${sum}: ${
    scorerId ? `punto a ${scorerId === m.a ? na : nb}` : hitA ? 'indovinano entrambi, nessun punto' : 'nessun punto'} (${sa}-${sb}).`);

  if (winnerId) return finishMurra(room, winnerId, cutShort);
  m.round++;
  m.picks = {};
  armMurra(room);
}

function finishMurra(room, winnerId, cutShort = false) {
  clearTimeout(room.timer);
  const m = room.murra;
  room.murra = null;
  const winner = playerById(room, winnerId);
  const loser = playerById(room, winnerId === m.a ? m.b : m.a);
  log(room, `🏆 ${winner.nickname} vince la Murra contro ${loser.nickname} ${m.score[winner.id]}-${m.score[loser.id]}${cutShort ? ' (sfida chiusa in anticipo)' : ''}.`);
  if (m.kind === 'auction') {
    room.auction.bidderId = winner.id; // chi vince la sfida si aggiudica l'asta al prezzo dell'offerta in corso
    return endAuction(room);
  }
  pay(room, loser, winner, m.stake, 'la Murra');
  finishAction(room);
}

/** Un giocatore della sfida ha lasciato la partita: la Murra salta e il gioco riprende. */
function cancelMurra(room) {
  room.murra = null;
  log(room, '🤜 Murra annullata.');
  if (!room.auction) return finishAction(room);
  room.turn.phase = 'auction';
  armAuction(room, AUCTION_BID_MS);
}

// ---------------------------------------------------------------------------
// Chat: testo breve e con limite di frequenza. Il contenuto non viene filtrato né censurato.
// ---------------------------------------------------------------------------
/** Riduce il messaggio a una sola riga di lunghezza limitata, senza toccarne le parole. */
function cleanChat(raw) {
  const oneLine = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(oneLine).slice(0, RULES.CHAT_MAX_LENGTH).join('');
}

function manage(room, p, action, cellIdx) {
  const i = Number(cellIdx);
  const pr = room.props[i];
  if (!pr || pr.owner !== p.id) fail('NOT_OWNER', 'Questa proprietà non è tua.');
  const cell = CELLS[i];
  const group = B.groupOf(i).map((c) => room.props[c]);
  switch (action) {
    case 'build': {
      if (cell.type !== 'prop') fail('BAD', 'Qui non si costruisce.');
      if (!group.every((g) => g.owner === p.id)) fail('BAD', 'Devi possedere tutto il gruppo di colore.');
      if (group.some((g) => g.mortgaged)) fail('BAD', 'Il gruppo ha proprietà ipotecate.');
      if (pr.houses >= RULES.MAX_HOUSES) fail('BAD', 'C\'è già l\'albergo.');
      if (pr.houses > Math.min(...group.map((g) => g.houses))) fail('BAD', 'Costruisci in modo uniforme sul gruppo.');
      const cost = B.houseCost(i);
      if (p.money < cost) fail('NO_MONEY', 'Non hai abbastanza soldi.');
      p.money -= cost; pr.houses++;
      log(room, `🔨 ${p.nickname} costruisce ${pr.houses === RULES.MAX_HOUSES ? 'un albergo' : 'una casa'} su ${cell.name}.`);
      break;
    }
    case 'sell': {
      if (pr.houses <= 0) fail('BAD', 'Non ci sono case.');
      if (pr.houses < Math.max(...group.map((g) => g.houses))) fail('BAD', 'Vendi in modo uniforme sul gruppo.');
      pr.houses--; p.money += B.houseSellValue(i);
      log(room, `🪓 ${p.nickname} vende una casa su ${cell.name} (+${euro(B.houseSellValue(i))}).`);
      break;
    }
    case 'mortgage': {
      if (pr.mortgaged) fail('BAD', 'È già ipotecata.');
      if (group.some((g) => g.houses > 0)) fail('BAD', 'Prima vendi le case del gruppo.');
      pr.mortgaged = true; p.money += B.mortgageValue(i);
      log(room, `🏦 ${p.nickname} ipoteca ${cell.name} (+${euro(B.mortgageValue(i))}).`);
      break;
    }
    case 'unmortgage': {
      if (!pr.mortgaged) fail('BAD', 'Non è ipotecata.');
      const cost = B.unmortgageCost(i);
      if (p.money < cost) fail('NO_MONEY', 'Non hai abbastanza soldi.');
      pr.mortgaged = false; p.money -= cost;
      log(room, `✨ ${p.nickname} riscatta ${cell.name} (-${euro(cost)}).`);
      break;
    }
    default: fail('BAD', 'Azione sconosciuta.');
  }
}

// ---------------------------------------------------------------------------
// Scambi tra giocatori
// Senza scambi i gruppi di colore restano divisi e la partita può non finire mai.
// ---------------------------------------------------------------------------
/** Controlla che un'offerta sia (ancora) valida. Ritorna [chi propone, chi riceve]. */
function validateTrade(room, t) {
  const from = playerById(room, t.from);
  const to = playerById(room, t.to);
  if (!from || !to || from === to || from.bankrupt || to.bankrupt) fail('BAD', 'Giocatore non valido.');
  const check = (props, owner) => {
    for (const i of props) {
      if (room.props[i]?.owner !== owner.id) fail('BAD', `${CELLS[i].name} non appartiene più a ${owner.nickname}.`);
      if (B.groupOf(i).some((c) => room.props[c].houses > 0)) fail('BAD', `Prima vanno vendute le case del gruppo di ${CELLS[i].name}.`);
    }
  };
  check(t.give.props, from);
  check(t.get.props, to);
  if (from.jailCards.length < t.give.cards) fail('BAD', `${from.nickname} non ha più la carta "esci di prigione".`);
  if (to.jailCards.length < t.get.cards) fail('BAD', `${to.nickname} non ha più la carta "esci di prigione".`);
  if (from.money < t.give.money) fail('NO_MONEY', `${from.nickname} non ha abbastanza soldi.`);
  if (to.money < t.get.money) fail('NO_MONEY', `${to.nickname} non ha abbastanza soldi.`);
  return [from, to];
}

/** Fasi del turno in cui gli scambi si possono proporre e accettare. */
const tradeOpenPhase = (room) => room.phase === 'playing' && ['roll', 'end'].includes(room.turn.phase);

function cancelTrade(room, reason) {
  if (!room.trade) return;
  clearTimeout(room.tradeTimer);
  room.trade = null;
  if (reason) log(room, reason);
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
// Troppe connessioni dallo stesso indirizzo: rifiutate prima di arrivare al gioco.
io.use((socket, next) => {
  if (ipAllowed('connect', clientIp(socket))) return next();
  next(new Error('Troppe connessioni: riprova tra un minuto.'));
});

io.on('connection', (socket) => {
  const ip = clientIp(socket);
  // Secchiello di gettoni: EVENT_BURST eventi di fila, poi EVENT_RATE al secondo.
  const bucket = { tokens: EVENT_BURST, at: Date.now() };
  const takeToken = () => {
    const now = Date.now();
    bucket.tokens = Math.min(EVENT_BURST, bucket.tokens + ((now - bucket.at) / 1000) * EVENT_RATE);
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens--;
    return true;
  };

  /** Registra un handler: risponde sempre con un ack { ok, ... } oppure { ok: false, error, message }. */
  const on = (event, fn) => socket.on(event, (payload, cb) => {
    if (typeof payload === 'function') { cb = payload; payload = null; }
    if (typeof cb !== 'function') cb = () => {};
    if (!payload || typeof payload !== 'object') payload = {};
    if (!takeToken()) return cb({ ok: false, error: 'RATE_LIMIT', message: 'Troppe richieste: rallenta un attimo.' });
    try {
      cb({ ok: true, ...fn(payload) });
    } catch (e) {
      if (e instanceof GameError) return cb({ ok: false, error: e.code, message: e.message });
      console.error(event, e);
      cb({ ok: false, error: 'SERVER', message: 'Errore del server.' });
    }
  });

  /** Stanza e giocatore associati a questo socket. */
  const ctx = () => {
    const room = rooms.get(socket.data.code);
    const player = room && playerById(room, socket.data.playerId);
    if (!player) fail('ROOM_NOT_FOUND', 'La stanza non esiste più.');
    touch(room);
    return { room, player };
  };
  /** Come ctx(), ma richiede che sia il turno del giocatore, in una delle fasi indicate. */
  const myTurn = (...phases) => {
    const c = ctx();
    if (!isCurrent(c.room, c.player)) fail('NOT_YOUR_TURN', 'Non è il tuo turno.');
    if (!phases.includes(c.room.turn.phase)) fail('BAD_PHASE', 'Azione non disponibile adesso.');
    return c;
  };

  // --- Stanze ---------------------------------------------------------------
  const limitIp = (kind) => {
    if (!ipAllowed(kind, ip)) fail('RATE_LIMIT', 'Troppi tentativi: riprova tra un minuto.');
  };

  on('room:create', ({ nickname }) => {
    limitIp('create');
    const room = createRoom();
    return attach(socket, room, addPlayer(room, nickname));
  });

  on('room:join', ({ code, nickname }) => {
    limitIp('join');
    const room = rooms.get(normCode(code));
    if (!room) fail('NO_SUCH_ROOM', 'Nessuna stanza con questo codice.');
    // Stesso nickname di un giocatore disconnesso: riprende il suo posto, con soldi e proprietà.
    const wanted = baseNick(nickname).toLowerCase();
    const same = room.players.find((p) => p.nickname.toLowerCase() === wanted);
    if (same && !same.connected) return attach(socket, room, same);
    if (room.phase === 'playing') {
      fail('GAME_STARTED', same
        ? `${same.nickname} risulta ancora collegato. Se sei tu, riprova tra qualche secondo.`
        : 'La partita è già iniziata: puoi rientrare solo con il nickname che avevi.');
    }
    const player = addPlayer(room, nickname);
    log(room, `👋 ${player.nickname} è entrato.`);
    return attach(socket, room, player);
  });

  // Rientro dopo disconnessione o ricarica della pagina: stesso posto, stessi soldi.
  on('room:rejoin', ({ code, token }) => {
    limitIp('join');
    const room = rooms.get(normCode(code));
    if (!room) fail('ROOM_NOT_FOUND', 'Il server si è riavviato oppure la stanza è rimasta inattiva troppo a lungo.');
    const player = room.players.find((p) => p.token === token);
    if (!player) fail('ROOM_NOT_FOUND', 'Non fai più parte di questa stanza.');
    return attach(socket, room, player);
  });

  on('room:leave', () => {
    const { room, player } = ctx();
    socket.leave(room.code);
    socket.data = {};
    Object.assign(player, { socketId: null, connected: false, disconnectedAt: 0 });
    if (room.phase !== 'playing') {
      room.players = room.players.filter((p) => p !== player);
    } else if (!player.bankrupt) {
      // A partita in corso il posto resta (gli indici dei turni non cambiano), ma il giocatore è fuori.
      log(room, `🚪 ${player.nickname} abbandona la partita.`);
      const wasCurrent = isCurrent(room, player);
      bankrupt(room, player, null);
      if (wasCurrent) endTurn(room);
      else if (room.murra && [room.murra.a, room.murra.b].includes(player.id)) cancelMurra(room);
    }
    if (!connectedCount(room)) return deleteRoom(room);
    fixHost(room);
    broadcast(room);
  });

  // --- Partita --------------------------------------------------------------
  on('game:start', () => {
    const { room, player } = ctx();
    if (player.id !== room.hostId) fail('NOT_HOST', 'Solo l\'host può avviare la partita.');
    if (room.phase === 'playing') fail('BAD_PHASE', 'La partita è già in corso.');
    if (connectedCount(room) < 2) fail('NOT_ENOUGH', 'Servono almeno 2 giocatori connessi.');
    startGame(room);
    broadcast(room);
  });

  on('game:roll', () => { const { room, player } = myTurn('roll'); doRoll(room, player); broadcast(room); });
  on('game:buy', () => { const { room, player } = myTurn('buy'); doBuy(room, player); broadcast(room); });
  on('game:pass', () => { const { room, player } = myTurn('buy'); doPass(room, player); broadcast(room); });
  on('game:endTurn', () => { const { room } = myTurn('end'); endTurn(room); broadcast(room); });

  on('game:payJail', () => {
    const { room, player } = myTurn('roll');
    if (!player.inJail) fail('BAD', 'Non sei in prigione.');
    if (player.money < RULES.JAIL_FINE) fail('NO_MONEY', 'Non hai abbastanza soldi.');
    player.money -= RULES.JAIL_FINE; player.inJail = false; player.jailTurns = 0;
    log(room, `🔓 ${player.nickname} paga ${euro(RULES.JAIL_FINE)} ed esce di prigione.`);
    broadcast(room);
  });

  on('game:useJailCard', () => {
    const { room, player } = myTurn('roll');
    if (!player.inJail) fail('BAD', 'Non sei in prigione.');
    if (!player.jailCards.length) fail('BAD', 'Non hai la carta per uscire di prigione.');
    player.jailCards.pop(); // la carta torna nel suo mazzo al prossimo rimescolamento
    player.inJail = false; player.jailTurns = 0;
    log(room, `🃏 ${player.nickname} usa la carta ed esce di prigione senza pagare.`);
    broadcast(room);
  });

  // Case e ipoteche: solo nel proprio turno, non mentre si decide un acquisto.
  on('game:manage', ({ action, cell }) => {
    const { room, player } = myTurn('roll', 'end');
    manage(room, player, action, cell);
    broadcast(room);
  });

  // --- Scambi: si propongono solo nel proprio turno, uno alla volta ---------
  on('trade:propose', ({ to, giveProps, getProps, giveMoney, getMoney, giveCards, getCards }) => {
    const { room, player } = myTurn('roll', 'end');
    if (room.trade) fail('BAD', 'C\'è già uno scambio in corso.');
    const ids = (a) => [...new Set(Array.isArray(a) ? a.slice(0, BOARD_SIZE).map(Number) : [])].filter(B.isBuyable);
    const money = (m) => { const n = Math.floor(Number(m)); return Number.isFinite(n) && n > 0 ? n : 0; };
    const trade = {
      from: player.id, to: String(to),
      give: { props: ids(giveProps), money: money(giveMoney), cards: money(giveCards) },
      get: { props: ids(getProps), money: money(getMoney), cards: money(getCards) },
      expires: Date.now() + TRADE_MS,
    };
    const items = (side) => side.props.length + side.cards;
    if (!items(trade.give) && !items(trade.get)) fail('BAD', 'Lo scambio deve includere almeno una proprietà o una carta.');
    const [, other] = validateTrade(room, trade);
    room.trade = trade;
    room.tradeTimer = setTimeout(() => {
      cancelTrade(room, `⌛ Lo scambio con ${other.nickname} è scaduto.`);
      broadcast(room);
    }, TRADE_MS);
    log(room, `🤝 ${player.nickname} propone uno scambio a ${other.nickname}.`);
    broadcast(room);
  });

  on('trade:respond', ({ accept }) => {
    const { room, player } = ctx();
    const t = room.trade;
    if (!t || t.to !== player.id) fail('BAD', 'Nessuno scambio a cui rispondere.');
    // Come per la proposta: niente scambi mentre si decide un acquisto o durante un'asta o una Murra.
    if (accept && !tradeOpenPhase(room)) fail('BAD_PHASE', 'Potrai accettare appena finisce la mossa in corso.');
    if (accept) {
      const [from, to] = validateTrade(room, t);
      for (const i of t.give.props) room.props[i].owner = to.id;
      for (const i of t.get.props) room.props[i].owner = from.id;
      const given = from.jailCards.splice(0, t.give.cards);
      const received = to.jailCards.splice(0, t.get.cards);
      to.jailCards.push(...given);
      from.jailCards.push(...received);
      const net = t.give.money - t.get.money; // soldi che passano da chi propone a chi accetta
      from.money -= net;
      to.money += net;
      cancelTrade(room, `✅ Scambio fatto tra ${from.nickname} e ${to.nickname}!`);
    } else {
      cancelTrade(room, `🙅 ${player.nickname} rifiuta lo scambio.`);
    }
    broadcast(room);
  });

  on('trade:cancel', () => {
    const { room, player } = ctx();
    if (room.trade?.from !== player.id) fail('BAD', 'Nessuno scambio da annullare.');
    cancelTrade(room, `↩️ ${player.nickname} annulla lo scambio.`);
    broadcast(room);
  });

  // --- Aste -----------------------------------------------------------------
  /** Come ctx(), ma richiede un'asta in corso e un giocatore che può parteciparvi. */
  const inAuction = () => {
    const c = ctx();
    if (!c.room.auction) fail('BAD', 'Nessuna asta in corso.');
    if (c.room.murra) fail('BAD', 'L\'asta è ferma: c\'è una Murra in corso.');
    if (c.player.bankrupt) fail('BAD', 'Sei fuori dalla partita.');
    if (c.room.auction.passed.includes(c.player.id)) fail('BAD', 'Ti sei già ritirato da questa asta.');
    return c;
  };

  on('auction:bid', ({ amount }) => {
    const { room, player } = inAuction();
    const a = room.auction;
    const bid = Math.floor(Number(amount));
    if (a.bidderId === player.id) fail('BAD', 'L\'offerta più alta è già tua.');
    if (!Number.isFinite(bid) || bid < auctionMinBid(room)) fail('BAD', `L'offerta minima è ${euro(auctionMinBid(room))}.`);
    if (bid > player.money) fail('NO_MONEY', 'Non hai abbastanza soldi.');
    Object.assign(a, { bid, bidderId: player.id, murraRefused: false });
    log(room, `💰 ${player.nickname} offre ${euro(bid)} per ${CELLS[a.cell].name}.`);
    armAuction(room, AUCTION_BID_MS);
    broadcast(room);
  });

  on('auction:pass', () => {
    const { room, player } = inAuction();
    if (room.auction.bidderId === player.id) fail('BAD', 'Hai l\'offerta più alta: non puoi ritirarti.');
    room.auction.passed.push(player.id);
    if (auctionSettled(room)) endAuction(room);
    broadcast(room);
  });

  // Asta rimasta a due: invece di rilanciare, il rivale sfida a Murra chi ha fatto l'offerta.
  on('auction:murra', () => {
    const { room, player } = inAuction();
    if (murraChallenger(room) !== player.id) {
      fail('BAD', 'Puoi lanciare la Murra solo quando l\'asta è rimasta a due e l\'offerta più alta è dell\'altro.');
    }
    const { cell, bid, bidderId } = room.auction;
    room.murra = newMurra('auction', player.id, bidderId); // parte dalla fase 'offer': lo sfidato deve accettare
    log(room, `🤜 ${player.nickname} sfida ${playerById(room, bidderId).nickname} a Murra per ${CELLS[cell].name}: se accetta, chi vince la compra a ${euro(bid)}.`);
    beginMurra(room);
    broadcast(room);
  });

  // --- Murra ----------------------------------------------------------------
  const inMurra = () => {
    const c = ctx();
    if (!c.room.murra) fail('BAD', 'Nessuna Murra in corso.');
    return { ...c, m: c.room.murra };
  };

  // Asta: lo sfidato accetta o rifiuta la sfida.
  on('murra:respond', ({ accept }) => {
    const { room, player, m } = inMurra();
    if (m.stage !== 'offer' || m.b !== player.id) fail('BAD', 'Nessuna sfida a cui rispondere.');
    if (accept) {
      log(room, `🤜 ${player.nickname} accetta la sfida a Murra!`);
      startMurraPlay(room);
    } else {
      refuseMurra(room);
    }
    broadcast(room);
  });

  // Carta Imprevisti o Parcheggio Gratuito: chi lancia la sfida sceglie l'avversario.
  on('murra:choose', ({ to }) => {
    const { room, player, m } = inMurra();
    if (m.stage !== 'choose' || m.a !== player.id) fail('BAD', 'Non tocca a te scegliere.');
    const opponent = playerById(room, String(to));
    if (!opponent || opponent.bankrupt || opponent.id === player.id) fail('BAD', 'Scegli un giocatore ancora in gioco.');
    setMurraOpponent(room, opponent);
    broadcast(room);
  });

  // Parcheggio Gratuito: la sfida è facoltativa.
  on('murra:skip', () => {
    const { room, player, m } = inMurra();
    if (m.stage !== 'choose' || m.kind !== 'parking' || m.a !== player.id) fail('BAD', 'Non puoi rinunciare a questa sfida.');
    skipMurra(room);
    broadcast(room);
  });

  // Giocata: quante dita mostro (1-5) e quale somma dichiaro (2-10), per la mano indicata.
  on('murra:play', ({ fingers, guess, round }) => {
    const { room, player, m } = inMurra();
    if (m.stage !== 'play' || ![m.a, m.b].includes(player.id)) fail('BAD', 'Non stai giocando questa Murra.');
    // Una giocata arrivata in ritardo non deve finire nella mano successiva.
    if (Number(round) !== m.round) fail('BAD', 'Questa mano è già finita.');
    if (m.picks[player.id]) fail('BAD', 'Hai già giocato: aspetta l\'avversario.');
    const [f, g] = [Number(fingers), Number(guess)];
    if (!Number.isInteger(f) || f < 1 || f > MAX_FINGERS) fail('BAD', `Mostra da 1 a ${MAX_FINGERS} dita.`);
    if (!Number.isInteger(g) || g < 2 || g > 2 * MAX_FINGERS) fail('BAD', `Dichiara una somma da 2 a ${2 * MAX_FINGERS}.`);
    m.picks[player.id] = { fingers: f, guess: g };
    if (m.picks[m.a] && m.picks[m.b]) resolveMurraRound(room);
    broadcast(room);
  });

  // --- Chat: messaggi di testo e reazioni predefinite -----------------------
  on('chat:send', ({ text }) => {
    const { room, player } = ctx();
    const clean = cleanChat(text);
    if (!clean) fail('BAD', 'Scrivi qualcosa prima di inviare.');
    const now = Date.now();
    if (now - player.lastChat < CHAT_COOLDOWN_MS) fail('RATE_LIMIT', 'Piano con i messaggi! 😅');
    player.lastChat = now;
    const message = { id: ++room.chatSeq, playerId: player.id, nickname: player.nickname, color: player.color, text: clean };
    room.chat.push(message);
    if (room.chat.length > CHAT_HISTORY) room.chat.shift();
    io.to(room.code).emit('chat:message', message);
  });

  on('chat:react', ({ id }) => {
    const { room, player } = ctx();
    const emoji = REACTIONS[Number(id)];
    if (!emoji) fail('BAD', 'Reazione non valida.');
    const now = Date.now();
    if (now - player.lastReaction < REACTION_COOLDOWN_MS) fail('RATE_LIMIT', 'Piano con le reazioni! 😅');
    player.lastReaction = now;
    io.to(room.code).emit('chat:reaction', { playerId: player.id, emoji });
  });

  socket.on('disconnect', () => detach(socket));
});

// ---------------------------------------------------------------------------
// Pulizia periodica
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const [key, hit] of ipHits) if (now - hit.since >= IP_WINDOW_MS) ipHits.delete(key);
  for (const room of rooms.values()) {
    // In sala d'attesa, chi è disconnesso da troppo tempo libera il posto.
    if (room.phase === 'lobby') {
      const before = room.players.length;
      room.players = room.players.filter((p) => p.connected || now - p.disconnectedAt < LOBBY_GHOST_MS);
      if (room.players.length !== before) { fixHost(room); broadcast(room); }
    }
    const idle = now - room.lastActivity > ROOM_IDLE_MS;
    const empty = !room.players.length || (room.emptySince && now - room.emptySince > ROOM_EMPTY_MS);
    if (idle || empty) {
      deleteRoom(room);
      console.log(`Stanza ${room.code} eliminata (${idle ? 'inattiva' : 'vuota'})`);
    }
  }
}, CLEANUP_EVERY_MS);

server.listen(PORT, HOST, () => console.log(`Soveratopoly in ascolto su http://${HOST}:${PORT}`));
