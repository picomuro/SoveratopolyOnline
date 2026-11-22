/**
 * Uscite del motore di gioco. Il motore non conosce Socket.IO: quando lo stato cambia
 * o c'è qualcosa da animare chiama queste funzioni, collegate alla rete da server/socket.js
 * (e da finti collegamenti nei test).
 */

const noop = () => {};
let out = { state: noop, anim: noop };

/** Collega le uscite: { state(room), anim(room, steps) }. */
export function setOutput(o) {
  out = { state: o.state || noop, anim: o.anim || noop };
}

/** Invia a tutta la stanza lo stato aggiornato. */
export const broadcast = (room) => out.state(room);

/** Invia a tutta la stanza i passi da animare (dadi, movimenti, carte, mani di Murra). */
export const emitAnim = (room, steps) => {
  if (steps.length) out.anim(room, steps);
};

/**
 * Timer legato a una stanza: non scatta se la stanza è stata chiusa, e un errore imprevisto
 * viene registrato invece di far cadere il processo (con tutte le partite in memoria).
 * Al termine invia lo stato aggiornato.
 */
export function later(room, ms, fn) {
  return setTimeout(() => {
    if (room.closed) return;
    try {
      fn();
    } catch (e) {
      console.error(`Errore in un timer della stanza ${room.code}:`, e);
    }
    broadcast(room);
  }, ms);
}
