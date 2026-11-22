/**
 * Connessione al server: riconnessione automatica, invio delle azioni, ingresso e uscita dalle stanze.
 */
import { $, closeModal, esc, openModal, toast } from './dom.js';
import { clearSession, session, setSession, setState } from './store.js';
import { setChat } from './chat.js';
import { createRoom, showScreen } from './screens.js';

// ------------------------------------------------------------------------
// Connessione con retry progressivo (1 s → 10 s, all'infinito).
// Stessa origine: nessun indirizzo scritto a mano.
// ------------------------------------------------------------------------
export const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  randomizationFactor: 0.4,
  timeout: 20000,
});
let everConnected = false;
let replaced = false; // la partita è stata aperta in un'altra scheda

export function showWake(text, sub = '') {
  $('#wake-text').textContent = text;
  $('#wake-sub').textContent = sub;
  $('#wake').classList.add('show');
}

/** Eventi della connessione: overlay di risveglio, rientro automatico, sostituzione da un'altra scheda. */
export function initNet() {
  socket.on('connect', () => {
    everConnected = true;
    $('#wake').classList.remove('show');
    if (session && !replaced) rejoin(); // una scheda sostituita non si riprende il posto da sola
  });
  socket.on('disconnect', () => showWake('Connessione persa, mi riconnetto…'));
  socket.on('connect_error', (err) => {
    // Connessione rifiutata dal server (es. troppe connessioni dallo stesso indirizzo): niente retry automatico.
    if (!socket.active) {
      showWake(err.message, 'Riprovo tra un minuto…');
      setTimeout(() => socket.connect(), 60000);
      return;
    }
    if (!everConnected)
      showWake(
        'Sto svegliando il server, attendi qualche secondo…',
        'Il server gratuito si addormenta dopo 15 minuti: può volerci fino a un minuto.',
      );
  });
  socket.io.on('reconnect_attempt', (n) => {
    $('#wake-sub').textContent = `Tentativo ${n}…`;
  });
  socket.on('session:replaced', () => {
    replaced = true;
    showReplaced();
  });
}

/**
 * Invia un'azione al server e attende la risposta.
 * Ritorna la risposta, oppure null in caso di errore (già mostrato all'utente, salvo quiet).
 */
export function send(event, payload = {}, { quiet = false } = {}) {
  if (replaced && event !== 'room:rejoin') {
    showReplaced();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    socket.timeout(10000).emit(event, payload, (err, res) => {
      if (!err && res.ok) return resolve(res);
      if (!quiet) {
        if (err) toast('Il server non risponde, riprova.');
        else if (res.error === 'ROOM_NOT_FOUND') roomGone(res.message);
        else toast(res.message || 'Errore');
      }
      resolve(null);
    });
  });
}

export async function rejoin() {
  replaced = false;
  const res = await send('room:rejoin', { code: session.code, token: session.token });
  if (res) setChat(res.chat);
}

/** Crea una stanza o entra in una esistente. */
let entering = false;
export async function enter(event, payload) {
  if (entering) return; // evita doppi clic
  entering = true;
  const res = await send(event, payload);
  entering = false;
  if (!res) return;
  setSession({ code: res.code, token: res.token, playerId: res.playerId });
  setChat(res.chat);
  history.replaceState(null, '', `?r=${res.code}`);
}

export function backToLobby() {
  clearSession();
  setState(null);
  setChat([]);
  history.replaceState(null, '', location.pathname);
  $('#victory').classList.remove('show');
  showScreen('lobby');
}

/** La stanza non esiste più (riavvio del server, stanza scaduta, posto perso). */
export function roomGone(message) {
  const code = session?.code || '';
  backToLobby();
  openModal(`
    <div class="big-emoji">😴</div>
    <h2>La stanza ${esc(code)} non è più disponibile</h2>
    <p>${esc(message)}</p>
    <button class="btn btn-big btn-pink" id="m-new">✨ Crea una nuova stanza</button>
    <button class="btn btn-ghost" data-close>Torna alla home</button>`);
  $('#m-new').onclick = () => {
    closeModal();
    createRoom();
  };
}

/** Lo stesso giocatore ha aperto la partita in un'altra scheda: questa si ferma. */
export function showReplaced() {
  openModal(`
    <div class="big-emoji">🪟</div>
    <h2>Partita aperta in un'altra scheda</h2>
    <p>Puoi continuare lì, oppure riprendere a giocare qui.</p>
    <button class="btn btn-big btn-blue" id="m-here">Gioca qui</button>`);
  $('#m-here').onclick = () => {
    closeModal();
    rejoin();
  };
}
