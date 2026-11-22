/**
 * Registro delle stanze in memoria: creazione, codici, giocatori, nickname, pulizia periodica.
 * Un riavvio del server cancella tutte le stanze.
 */
import crypto from 'node:crypto';
import { RULES } from '../shared/board-data.js';
import {
  CODE_LENGTH,
  CODE_LETTERS,
  LOBBY_GHOST_MS,
  MAX_ROOMS,
  NICK_MAX,
  PAWN_COLORS,
  ROOM_EMPTY_MS,
  ROOM_IDLE_MS,
} from './config.js';
import { fail, fixHost, freshStats, newRoomState } from './game/index.js';

/** @type {Map<string, object>} codice -> stanza */
export const rooms = new Map();

/** Codice stanza come lo scrive l'utente: maiuscolo e senza spazi. */
export const normCode = (code) =>
  String(code ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 8);

const randomLetter = () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];

function newCode() {
  let code;
  do code = Array.from({ length: CODE_LENGTH }, randomLetter).join('');
  while (rooms.has(code));
  return code;
}

export const findRoom = (code) => rooms.get(normCode(code));

export function createRoom() {
  if (rooms.size >= MAX_ROOMS) fail('BUSY', 'Troppe stanze aperte in questo momento: riprova tra poco.');
  const room = newRoomState(newCode());
  rooms.set(room.code, room);
  return room;
}

export function deleteRoom(room) {
  room.closed = true; // i timer ancora in coda non faranno più nulla
  clearTimeout(room.timer);
  clearTimeout(room.tradeTimer);
  rooms.delete(room.code);
}

/** Nickname ripulito (niente HTML, una riga, al massimo NICK_MAX caratteri), senza il numero dei doppioni. */
export function baseNick(raw) {
  const text = String(raw || '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return firstChars(text, NICK_MAX) || 'Giocatore';
}

/** I primi n caratteri; Array.from non spezza le emoji a metà. */
const firstChars = (text, n) => Array.from(text).slice(0, n).join('');

/** Nickname unico nella stanza: ai doppioni si aggiunge un numero (Marco2, Marco3…). */
function uniqueNick(raw, room) {
  const base = baseNick(raw);
  const taken = (nick) => room.players.some((p) => p.nickname.toLowerCase() === nick.toLowerCase());
  let nick = base;
  for (let k = 2; taken(nick); k++) nick = `${firstChars(base, NICK_MAX - 2)}${k}`;
  return nick;
}

/** Giocatore con lo stesso nickname (senza distinguere maiuscole), se c'è. */
export const playerByNick = (room, raw) => {
  const wanted = baseNick(raw).toLowerCase();
  return room.players.find((p) => p.nickname.toLowerCase() === wanted);
};

export function addPlayer(room, nickname) {
  if (room.players.length >= RULES.MAX_PLAYERS)
    fail('ROOM_FULL', `La stanza è piena (massimo ${RULES.MAX_PLAYERS} giocatori).`);
  const used = new Set(room.players.map((p) => p.color));
  const player = {
    id: crypto.randomUUID().slice(0, 8),
    token: crypto.randomUUID(), // segreto: serve per rientrare nello stesso posto
    nickname: uniqueNick(nickname, room),
    color: PAWN_COLORS.find((c) => !used.has(c)),
    socketId: null,
    connected: false,
    disconnectedAt: null,
    offlineLogged: false,
    lastReaction: 0,
    lastChat: 0,
    ...freshStats(),
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  return player;
}

/**
 * Pulizia periodica: libera i posti dei disconnessi in sala d'attesa ed elimina le stanze
 * vuote o inattive. Ritorna le stanze cambiate (da aggiornare sui client).
 */
export function cleanupRooms(now = Date.now()) {
  const changed = [];
  for (const room of rooms.values()) {
    if (room.phase === 'lobby') {
      const before = room.players.length;
      room.players = room.players.filter((p) => p.connected || now - p.disconnectedAt < LOBBY_GHOST_MS);
      if (room.players.length !== before) {
        fixHost(room);
        changed.push(room);
      }
    }
    const idle = now - room.lastActivity > ROOM_IDLE_MS;
    const empty = !room.players.length || (room.emptySince && now - room.emptySince > ROOM_EMPTY_MS);
    if (idle || empty) {
      deleteRoom(room);
      console.log(`Stanza ${room.code} eliminata (${idle ? 'inattiva' : 'vuota'})`);
    }
  }
  return changed.filter((r) => !r.closed);
}
