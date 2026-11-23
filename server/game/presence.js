/**
 * Presenza dei giocatori: connessione, disconnessione e abbandono, con le conseguenze sul gioco
 * (timer accorciati, avvisi in cronologia, host, Murra e turno di chi se ne va).
 */
import { HOST_GRACE_MS, OFFLINE_LOG_MS } from '../config.js';
import { later } from './output.js';
import { connectedCount, fixHost, isCurrent, log } from './state.js';
import { endTurn, setTimer, settleAndResume } from './turns.js';
import { bankrupt } from './money.js';
import { cancelMurra, watchMurraAbsence } from './murra.js';

const debtPhase = (room) => room.phase === 'playing' && room.turn?.phase === 'debt';

/** Il giocatore è (di nuovo) collegato. */
export function playerConnected(room, p, socketId) {
  Object.assign(p, { socketId, connected: true, disconnectedAt: null });
  if (p.offlineLogged) {
    p.offlineLogged = false;
    if (room.phase === 'playing') log(room, `🔌 ${p.nickname} è rientrato in partita.`);
  }
  room.emptySince = null;
  room.lastActivity = Date.now();
  fixHost(room, HOST_GRACE_MS);
  // Chi rientra nel proprio turno riprende il tempo normale; un debitore che rientra ferma l'ipoteca automatica.
  if (isCurrent(room, p) || debtPhase(room)) setTimer(room, true);
}

/** Il giocatore si è scollegato: il posto resta riservato per il rientro. */
export function playerDisconnected(room, p) {
  Object.assign(p, { socketId: null, connected: false, disconnectedAt: Date.now() });
  if (!connectedCount(room)) room.emptySince = Date.now();
  if (room.phase === 'playing' && !p.bankrupt) {
    // Una ricarica della pagina dura meno di OFFLINE_LOG_MS: solo le assenze vere finiscono in cronologia.
    const since = p.disconnectedAt;
    later(room, OFFLINE_LOG_MS, () => {
      if (room.phase !== 'playing' || p.connected || p.disconnectedAt !== since || p.bankrupt) return;
      p.offlineLogged = true;
      log(room, `📴 ${p.nickname} si è disconnesso: può rientrare con lo stesso codice e lo stesso nickname.`);
    });
  }
  if (room.murra && room.turn?.phase === 'murra') watchMurraAbsence(room, p);
  // Se era il suo turno (o doveva pagare), accorcia il timer: il gioco non resta bloccato.
  if (isCurrent(room, p) || debtPhase(room)) setTimer(room, true);
  if (room.hostId === p.id) later(room, HOST_GRACE_MS + 100, () => fixHost(room, HOST_GRACE_MS));
}

/**
 * Il giocatore esce dalla stanza. In sala d'attesa il posto si libera; a partita in corso
 * resta (gli indici dei turni non cambiano), ma il giocatore è fuori e le sue proprietà tornano libere.
 */
export function playerLeft(room, p) {
  Object.assign(p, { socketId: null, connected: false, disconnectedAt: 0 });
  if (room.phase !== 'playing') {
    room.players = room.players.filter((q) => q !== p);
  } else if (!p.bankrupt) {
    log(room, `🚪 ${p.nickname} abbandona la partita.`);
    const wasCurrent = isCurrent(room, p);
    bankrupt(room, p, null);
    if (wasCurrent) endTurn(room);
    else if (room.murra && [room.murra.a, room.murra.b].includes(p.id)) cancelMurra(room);
    else settleAndResume(room); // se il turno aspettava un suo pagamento, riparte
  }
  fixHost(room);
}
