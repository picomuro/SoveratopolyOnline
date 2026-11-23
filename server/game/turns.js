/**
 * Partita e turni: avvio, timer della mossa, gioco automatico allo scadere, passaggio del turno.
 */
import { CELLS, RULES, euro, isBuyable } from '../../shared/board-data.js';
import { MOVE_MS, OFFLINE_DEBT_MS, OFFLINE_MOVE_MS } from '../config.js';
import { newDeck } from './decks.js';
import { emitAnim, later } from './output.js';
import { randInt } from './random.js';
import { current, fixHost, freshStats, log, playerById } from './state.js';
import { doRoll } from './board.js';
import { doPass } from './auction.js';
import { beginMurra } from './murra.js';
import { cancelTrade } from './trade.js';
import { liquidate, owedBy, settleDebts } from './money.js';

/** Avvia (o riavvia, per la rivincita) la partita con i giocatori connessi. */
export function startGame(room) {
  // Chi è uscito o è disconnesso non partecipa alla (nuova) partita.
  room.players = room.players.filter((p) => p.connected);
  fixHost(room);
  cancelTrade(room);
  room.auction = null;
  room.murra = null;
  room.debts = [];
  room.phase = 'playing';
  room.winnerId = null;
  room.lastDice = null;
  room.props = {};
  CELLS.forEach((_, i) => {
    if (isBuyable(i)) room.props[i] = { owner: null, houses: 0, mortgaged: false };
  });
  room.players.forEach((p) => Object.assign(p, freshStats()));
  room.decks = { chance: newDeck(room.players, 'chance'), chest: newDeck(room.players, 'chest') };
  room.turnIndex = randInt(0, room.players.length);
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
export function setTimer(room, extend = false) {
  if (room.turn?.phase === 'debt') return armDebt(room);
  if (room.auction || room.murra) return; // aste e Murra hanno il proprio timer
  clearTimeout(room.timer);
  if (room.phase !== 'playing' || !room.turn) return;
  const now = Date.now();
  if (!extend) room.turn.limit = now + MOVE_MS;
  const wait = current(room).connected ? MOVE_MS : OFFLINE_MOVE_MS[room.turn.phase];
  const ms = Math.max(0, Math.min(wait, room.turn.limit - now));
  room.turn.deadline = now + ms;
  room.timer = later(room, ms, () => autoPlay(room));
}

/**
 * Pagamenti in sospeso: il tempo del turno è fermo finché i debitori non raccolgono i soldi.
 * Solo se un debitore è scollegato il server, dopo poco, ipoteca e vende al posto suo.
 */
function armDebt(room) {
  clearTimeout(room.timer);
  room.turn.deadline = 0;
  const offline = debtors(room).filter((p) => !p.connected);
  if (offline.length) room.timer = later(room, OFFLINE_DEBT_MS, () => payForOffline(room));
}

const debtors = (room) => [...new Set(room.debts.map((d) => d.playerId))].map((id) => playerById(room, id));

function payForOffline(room) {
  for (const p of debtors(room)) {
    if (p.connected) continue;
    log(room, `📴 ${p.nickname} è scollegato: il server raccoglie i soldi al posto suo.`);
    liquidate(room, p, owedBy(room, p));
  }
  settleAndResume(room);
}

/**
 * Dopo un'ipoteca, una vendita, uno scambio o un'uscita dalla partita: paga i debiti
 * ora coperti e, se non ne restano, il turno riprende da dove si era fermato.
 */
export function settleAndResume(room) {
  if (room.phase !== 'playing') return;
  settleDebts(room);
  if (room.phase !== 'playing' || room.turn.phase !== 'debt') return;
  if (room.debts.length) return setTimer(room); // un debitore può essersi scollegato
  finishAction(room);
}

/** Tempo scaduto: il server tira, rinuncia all'acquisto o chiude il turno al posto del giocatore. */
function autoPlay(room) {
  if (room.phase !== 'playing') return;
  const p = current(room);
  try {
    if (room.turn.phase === 'roll') {
      log(room, `⏰ Tempo scaduto: tiro automatico per ${p.nickname}.`);
      doRoll(room, p);
    } else if (room.turn.phase === 'buy') {
      log(room, `⏰ Tempo scaduto per ${p.nickname}.`);
      doPass(room, p);
    } else endTurn(room);
  } catch (e) {
    console.error('autoPlay', e);
    endTurn(room); // la partita non deve restare bloccata
  }
}

/** Passa il turno al prossimo giocatore ancora in gioco. */
export function endTurn(room) {
  clearTimeout(room.timer);
  room.auction = null;
  room.murra = null;
  // Caso raro (chi è di turno abbandona mentre altri devono pagare): i debiti si chiudono subito.
  for (const p of debtors(room)) liquidate(room, p, owedBy(room, p));
  settleDebts(room);
  room.debts = [];
  cancelTrade(room, '⌛ Scambio annullato: il turno è finito.');
  if (room.phase !== 'playing') return;
  const n = room.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (room.turnIndex + k) % n;
    if (!room.players[idx].bankrupt) {
      room.turnIndex = idx;
      break;
    }
  }
  startTurn(room);
}

/** Dopo ogni azione: invia l'animazione ai client e decide la fase successiva. */
export function finishAction(room, anim = []) {
  emitAnim(room, anim);
  if (room.phase !== 'playing') return;
  settleDebts(room); // es. un debito nato prima di passare dal VIA! ora è coperto
  if (room.phase !== 'playing') return;
  const p = current(room);
  if (p.bankrupt) return endTurn(room);
  if (room.debts.length) {
    room.turn.phase = 'debt'; // il turno si ferma finché qualcuno deve ancora pagare
    return setTimer(room);
  }
  if (room.murra) return beginMurra(room); // una carta o il Parcheggio hanno lanciato una sfida a Murra
  if (room.turn.pendingBuy !== null) room.turn.phase = 'buy';
  else if (room.turn.rollAgain && !p.inJail) {
    room.turn.phase = 'roll';
    log(room, `🔁 ${p.nickname} ha fatto doppio: tira ancora!`);
  } else room.turn.phase = 'end';
  setTimer(room);
}
