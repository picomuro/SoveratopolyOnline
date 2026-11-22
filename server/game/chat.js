/**
 * Chat della stanza: testo breve e reazioni predefinite, con limite di frequenza.
 * Per scelta del proprietario del gioco il contenuto non viene filtrato né censurato;
 * il client lo inserisce sempre come testo (mai come HTML).
 */
import { REACTIONS, RULES } from '../../shared/board-data.js';
import { CHAT_COOLDOWN_MS, CHAT_HISTORY, REACTION_COOLDOWN_MS } from '../config.js';
import { fail } from './errors.js';

/** Riduce il messaggio a una sola riga di lunghezza limitata, senza toccarne le parole. */
export function cleanChat(raw) {
  // eslint-disable-next-line no-control-regex -- i caratteri di controllo vanno tolti di proposito
  const oneLine = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(oneLine).slice(0, RULES.CHAT_MAX_LENGTH).join('');
}

/** Nuovo messaggio: ritorna il messaggio da inviare alla stanza. */
export function addChatMessage(room, p, text, now = Date.now()) {
  const clean = cleanChat(text);
  if (!clean) fail('BAD', 'Scrivi qualcosa prima di inviare.');
  if (now - p.lastChat < CHAT_COOLDOWN_MS) fail('RATE_LIMIT', 'Piano con i messaggi! 😅');
  p.lastChat = now;
  const message = { id: ++room.chatSeq, playerId: p.id, nickname: p.nickname, color: p.color, text: clean };
  room.chat.push(message);
  if (room.chat.length > CHAT_HISTORY) room.chat.shift();
  return message;
}

/** Reazione rapida (indice in REACTIONS): ritorna l'evento da inviare alla stanza. */
export function reaction(p, id, now = Date.now()) {
  const emoji = REACTIONS[Number(id)];
  if (!emoji) fail('BAD', 'Reazione non valida.');
  if (now - p.lastReaction < REACTION_COOLDOWN_MS) fail('RATE_LIMIT', 'Piano con le reazioni! 😅');
  p.lastReaction = now;
  return { playerId: p.id, emoji };
}
