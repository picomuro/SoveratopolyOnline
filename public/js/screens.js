/**
 * Schermate: home (lobby), sala d'attesa, partita.
 */
import { $, esc, toast } from './dom.js';
import { meId, pl, session, setClockOffset, setState, state, store, urlCode } from './store.js';
import { backToLobby, enter, send } from './net.js';
import { renderGame, renderVictory } from './panels.js';

// ------------------------------------------------------------------------
// Schermate
// ------------------------------------------------------------------------
export function showScreen(name) {
  for (const s of ['lobby', 'wait', 'game']) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
}

export function applyState(s) {
  if (!session) return; // stato in arrivo mentre stavamo uscendo
  if (!s.players.some((p) => p.id === meId())) return backToLobby(); // il nostro posto è stato liberato
  const prev = state;
  setState(s);
  setClockOffset(s.serverNow - Date.now());
  if (s.phase === 'lobby') { showScreen('wait'); renderWait(); return; }
  showScreen('game');
  renderGame(prev);
  renderVictory();
}

// ---------- Lobby ----------
const nickInput = $('#nick');
const codeInput = $('#code');

export function getNick() {
  const n = nickInput.value.trim();
  if (!n) { toast('Scrivi prima il tuo nickname 😉'); nickInput.focus(); return null; }
  store.set('sov_nick', n);
  return n;
}
export function createRoom() {
  const nickname = getNick();
  if (nickname) enter('room:create', { nickname });
}
export function joinRoom() {
  const nickname = getNick();
  if (!nickname) return;
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 4) return toast('Il codice ha 4 lettere');
  enter('room:join', { code, nickname });
}

// ---------- Sala d'attesa ----------
export function renderWait() {
  $('#wait-code').textContent = state.code;
  $('#wait-players').innerHTML = state.players.map((p) => `
    <li><span class="dot" style="background:${p.color}"></span>
    <b>${esc(p.nickname)}</b>${p.id === meId() ? ' (tu)' : ''} ${p.id === state.hostId ? '👑' : ''} ${p.connected ? '' : '📴'}</li>`).join('');
  const isHost = state.hostId === meId();
  const ready = state.players.filter((p) => p.connected).length;
  $('#btn-start').classList.toggle('hidden', !isHost);
  $('#btn-start').disabled = ready < 2;
  $('#wait-hint').textContent = ready < 2 ? 'Condividi il codice: servono almeno 2 giocatori.'
    : isHost ? `${ready} giocatori pronti!` : 'In attesa che l\'host avvii la partita…';
}
async function shareLink() {
  const url = `${location.origin}${location.pathname}?r=${state.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Soveratopoly', text: `Gioca con me a Soveratopoly! Codice ${state.code}`, url });
    else { await navigator.clipboard.writeText(url); toast('Link copiato! 📋'); }
  } catch { /* condivisione annullata */ }
}

export async function leave() {
  await send('room:leave', {}, { quiet: true }); // se la stanza non c'è più va bene lo stesso
  backToLobby();
}
function leaveGame() {
  const me = pl(meId());
  if (state.phase === 'playing' && !me.bankrupt && !confirm('Vuoi abbandonare? Le tue proprietà torneranno libere.')) return;
  leave();
}

/** Collega i controlli di home, sala d'attesa e partita. */
export function initScreens() {
  nickInput.value = store.get('sov_nick') || '';
  codeInput.value = urlCode;
  $('#btn-create').onclick = createRoom;
  $('#btn-join').onclick = joinRoom;
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeInput.value.trim() ? joinRoom : createRoom)(); });
  $('#btn-share').onclick = shareLink;
  $('#btn-start').onclick = () => send('game:start');
  $('#btn-rematch').onclick = () => send('game:start');
  $('#btn-leave-wait').onclick = leave;
  $('#btn-victory-exit').onclick = leave;
  $('#btn-leave-game').onclick = leaveGame;
}
