/**
 * Aste: quando il giocatore di turno rinuncia a comprare, la proprietà va all'asta tra tutti
 * i giocatori ancora in gioco, compreso chi ha rinunciato. A ogni offerta il tempo riparte;
 * vince l'offerta più alta. In un'asta rimasta a due si può sfidare a Murra chi ha offerto.
 */
import { CELLS, RULES, auctionStart, euro } from '../../shared/board-data.js';
import { AUCTION_BID_MS, AUCTION_START_MS } from '../config.js';
import { fail } from './errors.js';
import { later } from './output.js';
import { alive, log, playerById } from './state.js';
import { finishAction } from './turns.js';
import { beginMurra, newMurra } from './murra.js';

/** Chi rinuncia all'acquisto manda la proprietà all'asta. */
export function doPass(room, p) {
  const i = room.turn.pendingBuy;
  log(room, `🙅 ${p.nickname} non compra ${CELLS[i].name}: va all'asta!`);
  room.turn.pendingBuy = null;
  room.turn.phase = 'auction';
  room.auction = { cell: i, bid: 0, bidderId: null, passed: [] };
  armAuction(room, AUCTION_START_MS);
}

/** Prima offerta: almeno metà del prezzo di listino; poi si rilancia di almeno AUCTION_MIN_STEP. */
const auctionMinBid = (room) =>
  room.auction.bidderId ? room.auction.bid + RULES.AUCTION_MIN_STEP : auctionStart(room.auction.cell);

/** Chi può ancora rilanciare contro l'offerta attuale (non ritirato, connesso, con abbastanza soldi). */
function auctionRivals(room) {
  const a = room.auction;
  const min = auctionMinBid(room);
  return alive(room).filter((p) => p.id !== a.bidderId && p.connected && !a.passed.includes(p.id) && p.money >= min);
}
const auctionSettled = (room) => auctionRivals(room).length === 0;

/** In un'asta rimasta a due, l'unico rivale può sfidare a Murra chi ha fatto l'offerta. Ritorna il suo id. */
export function murraChallenger(room) {
  if (!room.auction?.bidderId || room.auction.murraRefused || room.murra) return null;
  const rivals = auctionRivals(room);
  return rivals.length === 1 ? rivals[0].id : null;
}

/** (Ri)avvia il conto alla rovescia dell'asta, oppure la chiude se nessuno può più offrire. */
export function armAuction(room, ms = AUCTION_BID_MS) {
  clearTimeout(room.timer);
  if (auctionSettled(room)) return endAuction(room);
  room.turn.deadline = Date.now() + ms;
  room.timer = later(room, ms, () => {
    if (room.auction) endAuction(room);
  });
}

/** Chiude l'asta: la proprietà va al miglior offerente, se può ancora pagare. */
export function endAuction(room) {
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

/** Controlla che il giocatore possa partecipare all'asta in corso. */
function checkBidder(room, p) {
  if (!room.auction) fail('BAD', 'Nessuna asta in corso.');
  if (room.murra) fail('BAD', "L'asta è ferma: c'è una Murra in corso.");
  if (p.bankrupt) fail('BAD', 'Sei fuori dalla partita.');
  if (room.auction.passed.includes(p.id)) fail('BAD', 'Ti sei già ritirato da questa asta.');
}

/** Nuova offerta. */
export function placeBid(room, p, amount) {
  checkBidder(room, p);
  const a = room.auction;
  const bid = Math.floor(Number(amount));
  if (a.bidderId === p.id) fail('BAD', "L'offerta più alta è già tua.");
  if (!Number.isFinite(bid) || bid < auctionMinBid(room))
    fail('BAD', `L'offerta minima è ${euro(auctionMinBid(room))}.`);
  if (bid > p.money) fail('NO_MONEY', 'Non hai abbastanza soldi.');
  Object.assign(a, { bid, bidderId: p.id, murraRefused: false });
  log(room, `💰 ${p.nickname} offre ${euro(bid)} per ${CELLS[a.cell].name}.`);
  armAuction(room, AUCTION_BID_MS);
}

/** Ritiro dall'asta: chi si ritira non può rientrare. */
export function leaveAuction(room, p) {
  checkBidder(room, p);
  if (room.auction.bidderId === p.id) fail('BAD', "Hai l'offerta più alta: non puoi ritirarti.");
  room.auction.passed.push(p.id);
  if (auctionSettled(room)) endAuction(room);
}

/** Asta rimasta a due: invece di rilanciare, il rivale sfida a Murra chi ha fatto l'offerta. */
export function challengeAuctionMurra(room, p) {
  checkBidder(room, p);
  if (murraChallenger(room) !== p.id) {
    fail('BAD', "Puoi lanciare la Murra solo quando l'asta è rimasta a due e l'offerta più alta è dell'altro.");
  }
  const { cell, bid, bidderId } = room.auction;
  room.murra = newMurra('auction', p.id, bidderId); // parte dalla fase 'offer': lo sfidato deve accettare
  log(
    room,
    `🤜 ${p.nickname} sfida ${playerById(room, bidderId).nickname} a Murra per ${CELLS[cell].name}: se accetta, chi vince la compra a ${euro(bid)}.`,
  );
  beginMurra(room);
}
