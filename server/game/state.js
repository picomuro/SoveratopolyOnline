/**
 * Stato di una stanza e funzioni di lettura comuni a tutto il motore di gioco.
 */
import { RULES } from '../../shared/board-data.js';
import { LOG_KEEP, LOG_SENT } from '../config.js';
import { murraChallenger } from './auction.js';

/** Stanza vuota, in sala d'attesa. */
export function newRoomState(code) {
  return {
    code,
    hostId: null,
    phase: 'lobby', // lobby | playing | finished
    players: [],
    props: {}, // cella -> { owner, houses, mortgaged }
    turnIndex: 0,
    turn: null, // { phase: roll|buy|auction|murra|end, doubles, rollAgain, pendingBuy, deadline, limit }
    decks: {},
    lastDice: null,
    winnerId: null,
    trade: null, // { from, to, give: {props, money, cards}, get: {props, money, cards}, expires }
    tradeTimer: null,
    auction: null, // { cell, bid, bidderId, passed: [id], murraRefused } mentre una proprietà è all'asta
    murra: null, // sfida a Murra in corso (vedi murra.js)
    chat: [], // ultimi messaggi: { id, playerId, nickname, color, text }
    chatSeq: 0,
    log: [],
    timer: null, // un solo timer per mossa, asta e Murra
    closed: false, // true dopo l'eliminazione: i timer rimasti non fanno più nulla
    lastActivity: Date.now(),
    emptySince: null,
  };
}

/** Soldi e posizione di inizio partita. jailCards: carte "esci di prigione" (nome del mazzo d'origine). */
export const freshStats = () => ({
  money: RULES.START_MONEY,
  pos: 0,
  inJail: false,
  jailTurns: 0,
  bankrupt: false,
  jailCards: [],
});

export const playerById = (room, id) => room.players.find((p) => p.id === id);
export const current = (room) => room.players[room.turnIndex];
export const alive = (room) => room.players.filter((p) => !p.bankrupt);
export const connectedCount = (room) => room.players.filter((p) => p.connected).length;
export const isCurrent = (room, p) => room.phase === 'playing' && current(room).id === p.id;
/** Indici delle caselle possedute da un giocatore. */
export const ownedBy = (room, id) =>
  Object.keys(room.props)
    .map(Number)
    .filter((i) => room.props[i].owner === id);

/**
 * Passa il ruolo di host al primo giocatore connesso, se l'host non c'è più.
 * Con graceMs l'host appena disconnesso (es. ricarica della pagina) conserva il ruolo.
 * Ritorna true se l'host è cambiato.
 */
export function fixHost(room, graceMs = 0) {
  const host = playerById(room, room.hostId);
  if (host && (host.connected || Date.now() - host.disconnectedAt < graceMs)) return false;
  const next = room.players.find((p) => p.connected) || room.players[0];
  const nextId = next ? next.id : null;
  if (nextId === room.hostId) return false;
  room.hostId = nextId;
  return true;
}

/** Aggiunge una riga in cima alla cronologia. */
export function log(room, text) {
  room.log.unshift(text);
  if (room.log.length > LOG_KEEP) room.log.pop();
}

/** Stato inviato ai client: niente token, niente socket, niente scelte segrete della Murra. */
export function publicState(room) {
  const { murra } = room;
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      money: p.money,
      pos: p.pos,
      inJail: p.inJail,
      bankrupt: p.bankrupt,
      connected: p.connected,
      jailCards: p.jailCards.length,
    })),
    props: room.props,
    turn: room.turn && {
      playerId: current(room).id,
      phase: room.turn.phase,
      pendingBuy: room.turn.pendingBuy,
      deadline: room.turn.deadline,
    },
    trade: room.trade,
    auction: room.auction && { ...room.auction, challengerId: murraChallenger(room) },
    // Le scelte restano segrete fino alla rivelazione: ai client arriva solo chi ha già giocato.
    murra: murra && {
      kind: murra.kind,
      stake: murra.stake,
      goal: murra.goal,
      a: murra.a,
      b: murra.b,
      stage: murra.stage,
      score: murra.score,
      round: murra.round,
      picked: Object.keys(murra.picks),
    },
    lastDice: room.lastDice,
    winnerId: room.winnerId,
    log: room.log.slice(0, LOG_SENT),
    serverNow: Date.now(),
  };
}
