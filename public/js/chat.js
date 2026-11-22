/**
 * Chat della stanza (sala d'attesa e partita) e reazioni rapide con le emoji.
 */
import { REACTIONS, RULES } from '../shared/board-data.js';
import { $, esc, toast } from './dom.js';
import { meId, pl, state } from './store.js';
import { send, socket } from './net.js';
import { UI } from './ui-config.js';

// ---------- Chat ----------
// Lo stesso riquadro compare in sala d'attesa e in partita: [data-chat] li aggiorna entrambi.
let chatBoxes = [];
let chat = [];

export function setChat(messages) {
  chat = messages.slice(-UI.CHAT_KEEP);
  for (const box of chatBoxes) {
    const list = box.querySelector('.chat-list');
    list.replaceChildren(
      ...chat.map((m) => {
        const li = document.createElement('li');
        const who = document.createElement('b');
        who.textContent = `${m.nickname}: `;
        who.style.color = m.color;
        li.append(who, m.text); // testo inserito come testo, mai come HTML
        if (m.playerId === meId()) li.className = 'mine';
        return li;
      }),
    );
    if (!chat.length) list.innerHTML = '<li class="empty">Nessun messaggio: rompi il ghiaccio! 👋</li>';
    list.scrollTop = list.scrollHeight;
  }
}
/** La chat è sullo schermo in questo momento? (Su telefono può essere sotto il tabellone.) */
export const chatOnScreen = () =>
  chatBoxes.some((box) => {
    const r = box.getBoundingClientRect();
    return r.height > 0 && r.top < innerHeight && r.bottom > 0;
  });
/** Collega i riquadri della chat, la ricezione dei messaggi e la barra delle reazioni. */
export function initChat() {
  chatBoxes = [...document.querySelectorAll('[data-chat]')];
  socket.on('chat:message', (m) => {
    setChat([...chat, m]);
    if (m.playerId !== meId() && !chatOnScreen()) toast(`💬 ${m.nickname}: ${m.text}`);
  });
  for (const box of chatBoxes) {
    const input = box.querySelector('input');
    input.maxLength = RULES.CHAT_MAX_LENGTH;
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text && (await send('chat:send', { text }))) input.value = '';
    };
  }
  setChat([]);

  // ---------- Reazioni (emoji predefinite) ----------
  $('#reactions').innerHTML = REACTIONS.map(
    (e, i) => `<button data-r="${i}" aria-label="Reazione ${e}">${e}</button>`,
  ).join('');
  $('#reactions').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (b) send('chat:react', { id: Number(b.dataset.r) });
  };
}
export function showReaction({ playerId, emoji }) {
  const p = state && pl(playerId);
  if (!p) return;
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.style.left = `${30 + Math.random() * 40}%`;
  el.innerHTML = `${esc(emoji)}<small style="color:${p.color}">${esc(p.nickname)}</small>`;
  $('#reaction-layer').appendChild(el);
  setTimeout(() => el.remove(), UI.REACTION_MS);
}
