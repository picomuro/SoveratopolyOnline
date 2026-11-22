/**
 * Scambi nel client: riquadro della proposta in corso e finestra per comporne una nuova.
 */
import { CELLS, euro } from '../shared/board-data.js';
import * as S from '../shared/board-data.js';
import { $, button, closeModal, esc, openModal, row } from './dom.js';
import { groupHasHouses, meId, pl, propsOf, state } from './store.js';
import { send } from './net.js';

// ---------- Scambi ----------
export const chip = (i) => `<span class="chip" style="--c:${S.colorOf(i)}">${esc(CELLS[i].name)}</span>`;
/** Un lato dello scambio: proprietà e soldi. */
export const offer = ({ props, money, cards }) => (props.map(chip).join('')
  + '<span class="chip">🃏 Esci di prigione</span>'.repeat(cards)
  + (money ? `<span class="chip money">${euro(money)}</span>` : '')) || '<i>niente</i>';

/** Riquadro dello scambio in corso, mostrato in cima alle azioni. */
export function renderTradeBox(box) {
  const t = state.trade;
  if (!t) return;
  const from = pl(t.from), to = pl(t.to);
  const el = document.createElement('div');
  el.className = 'trade-card';
  const sides = (giveLabel, getLabel, give, get) => `
    <div><small>${giveLabel}</small><div class="chips">${offer(give)}</div></div>
    <div><small>${getLabel}</small><div class="chips">${offer(get)}</div></div>`;
  const timer = `<span class="timer" data-deadline="${t.expires}"></span>`;
  if (t.to === meId()) {
    el.innerHTML = `<b>🤝 ${esc(from.nickname)} ti propone uno scambio ${timer}</b>${sides('Tu ricevi', 'Tu dai', t.give, t.get)}`;
    const busy = !['roll', 'end'].includes(state.turn.phase); // asta, Murra o acquisto in corso
    if (busy) el.insertAdjacentHTML('beforeend', '<small>Potrai accettare appena finisce la mossa in corso.</small>');
    el.append(row(
      button('✅ Accetta', 'btn-green', () => send('trade:respond', { accept: true }), busy),
      button('❌ Rifiuta', 'btn-pink', () => send('trade:respond', { accept: false })),
    ));
  } else if (t.from === meId()) {
    el.innerHTML = `<b>🤝 In attesa della risposta di ${esc(to.nickname)}… ${timer}</b>${sides('Tu dai', 'Tu ricevi', t.give, t.get)}`;
    el.append(button('Annulla scambio', 'btn-ghost', () => send('trade:cancel')));
  } else {
    el.innerHTML = `<b>🤝 ${esc(from.nickname)} propone uno scambio a ${esc(to.nickname)}…</b>`;
  }
  box.append(el);
}

export function openTrade(otherId) {
  const other = pl(otherId), me = pl(meId());
  const column = (title, who, name) => {
    const checks = propsOf(who.id).map((i) => {
      const locked = groupHasHouses(i);
      return `<label class="tcheck${locked ? ' off' : ''}"><input type="checkbox" name="${name}" value="${i}"${locked ? ' disabled' : ''}>
        <span class="sw" style="background:${S.colorOf(i)}"></span>${esc(CELLS[i].name)}${state.props[i].mortgaged ? ' 🏦' : ''}</label>`;
    }).join('') || '<i>nessuna proprietà</i>';
    const cards = `<label class="tcheck"><input type="checkbox" name="${name}-card">🃏 Esci di prigione</label>`.repeat(who.jailCards);
    return `<div><h4>${title}</h4>${checks}${cards}
      <label class="tmoney">💶 <input type="number" name="${name}-money" min="0" max="${who.money}" value="0" inputmode="numeric"></label></div>`;
  };
  openModal(`
    <h2>🤝 Scambio con ${esc(other.nickname)}</h2>
    <div class="trade-cols">${column('Tu dai', me, 'give')}${column('Ricevi', other, 'get')}</div>
    <small class="who">Le proprietà con case nel gruppo non si possono scambiare.</small>
    <button class="btn btn-big btn-green" id="t-send">Proponi scambio</button>
    <button class="btn btn-ghost" data-close>Annulla</button>`, 'trade-modal');
  const box = $('#modal-box');
  const picked = (name) => [...box.querySelectorAll(`input[name=${name}]:checked`)].map((c) => Number(c.value));
  const amount = (name) => Number(box.querySelector(`input[name=${name}-money]`).value) || 0;
  const cards = (name) => box.querySelectorAll(`input[name=${name}-card]:checked`).length;
  $('#t-send').onclick = async () => {
    const res = await send('trade:propose', {
      to: other.id, giveProps: picked('give'), getProps: picked('get'), giveMoney: amount('give'), getMoney: amount('get'),
      giveCards: cards('give'), getCards: cards('get'),
    });
    if (res) closeModal();
  };
}
