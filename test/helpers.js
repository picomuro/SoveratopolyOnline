/**
 * Aiuti per i test del motore di gioco: stanze in memoria, dadi pilotati, animazioni raccolte.
 * Nessuna rete: il motore lavora su oggetti stanza e le uscite finiscono in `room.anims`.
 */
import * as game from '../server/game/index.js';
import { addPlayer } from '../server/rooms.js';

/**
 * Generatore pilotato: i dadi (randInt(1, 7)) escono dalla lista `dice`, nell'ordine;
 * ogni altra scelta casuale prende il valore minimo (ordine dei mazzi, giocatore iniziale…).
 */
export function scriptDice(dice = []) {
  const queue = [...dice];
  game.setRandom((min, max) => {
    if (min === 1 && max === 7) {
      if (!queue.length) throw new Error('Dadi finiti: aggiungi valori a scriptDice()');
      return queue.shift();
    }
    return min;
  });
  return { push: (...values) => queue.push(...values), left: () => queue.length };
}

/** Stanza in partita con n giocatori connessi (P0 inizia). */
export function newGame(n = 2) {
  const room = game.newRoomState('TEST');
  room.anims = [];
  const players = Array.from({ length: n }, (_, k) => {
    const p = addPlayer(room, `P${k}`);
    game.playerConnected(room, p, `socket-${k}`);
    return p;
  });
  game.startGame(room); // con il generatore pilotato il primo di turno è P0
  return { room, players };
}

/** Collega le uscite del motore alla stanza dei test (animazioni raccolte, stato ignorato). */
export function captureOutput() {
  game.setOutput({
    state: () => {},
    anim: (room, steps) => room.anims?.push(...steps),
  });
}

/** Chiude la stanza: i timer ancora in coda non fanno più nulla. */
export function closeRoom(room) {
  room.closed = true;
  clearTimeout(room.timer);
  clearTimeout(room.tradeTimer);
}

/** Proprietà assegnata direttamente a un giocatore (per preparare le situazioni). */
export function give(room, player, ...cells) {
  for (const i of cells) room.props[i].owner = player.id;
}
