/**
 * Stato condiviso del client: sessione salvata, ultimo stato ricevuto dal server e selettori.
 * Le variabili esportate si leggono da tutti i moduli ma si cambiano solo con le funzioni set*.
 */
import { groupOf } from '../shared/board-data.js';

// ------------------------------------------------------------------------
// Sessione salvata nel browser: permette di rientrare nello stesso posto.
// ------------------------------------------------------------------------
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage non disponibile */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
export let session = store.get('sov_session'); // { code, token, playerId }
export const setSession = (s) => { session = s; store.set('sov_session', s); };
export const clearSession = () => { session = null; store.del('sov_session'); };

// Un link di invito a un'altra stanza vince sulla sessione salvata.
export const urlCode = (new URLSearchParams(location.search).get('r') || '').toUpperCase().slice(0, 4);
if (urlCode && session && session.code !== urlCode) clearSession();

export let state = null;        // ultimo stato ricevuto dal server
export const setState = (s) => { state = s; };
export let clockOffset = 0;     // differenza orologio server/client per i countdown
export const setClockOffset = (ms) => { clockOffset = ms; };
export const shown = {};        // casella su cui è disegnata ogni pedina (può precedere lo stato durante le animazioni)
export const shownJail = {};    // la pedina è disegnata dentro la prigione?

export const meId = () => session?.playerId;
export const pl = (id) => state.players.find((p) => p.id === id);
export const isMyTurn = () => state?.phase === 'playing' && state.turn.playerId === meId();
/** Case, ipoteche e scambi: solo nel proprio turno, non durante un acquisto o un'asta. */
export const canManage = () => isMyTurn() && ['roll', 'end'].includes(state.turn.phase);
export const propsOf = (id) => Object.keys(state.props).map(Number).filter((i) => state.props[i].owner === id);
export const groupHasHouses = (i) => groupOf(i).some((c) => state.props[c].houses > 0);
