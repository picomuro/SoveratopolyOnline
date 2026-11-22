/**
 * Murra nel client: scelta dell'avversario, accettazione, giocata e rivelazione delle mani.
 */
import { CELLS, FINGERS, euro } from '../shared/board-data.js';
import { button, closeModal, esc, openModal, row } from './dom.js';
import { meId, pl, state } from './store.js';
import { send } from './net.js';
import { UI } from './ui-config.js';

// ---------- Murra ----------
// Scelta in corso (dita e somma): sopravvive ai ridisegni del pannello e si azzera a ogni nuova mano.
let murraSel = { key: '', fingers: 0, guess: 0 };
/** Con n dita mie, la somma delle due mani può valere solo da n+1 a n+5. */
export const sumPossible = (sum, fingers) => !fingers || (sum > fingers && sum <= fingers + FINGERS.length);

export const goalText = (goal) => (goal === 1 ? 'Vince chi indovina per primo la somma.' : `Si vince a ${goal} punti.`);

/** Riquadro della sfida: lo vedono tutti. Cambia con la fase: scelta dell'avversario, sfida da accettare, mani da giocare. */
export function renderMurraBox(box) {
  const m = state.murra;
  const me = pl(meId());
  const a = pl(m.a), b = m.b && pl(m.b);
  const name = (p) => `<b style="color:${p.color}">${esc(p.nickname)}</b>`;
  const prize = m.kind === 'auction'
    ? `Chi vince compra ${esc(CELLS[state.auction.cell].name)} a ${euro(state.auction.bid)}.`
    : `Chi perde dà ${euro(m.stake)} a chi vince.`;
  const card = document.createElement('div');
  card.className = 'buy-card murra';
  const body = document.createElement('div');
  body.className = 'body';
  card.append(body);
  box.append(card);

  if (m.stage === 'choose') { // carta Imprevisti o Parcheggio Gratuito: chi lancia sceglie l'avversario
    const mine = a.id === me.id;
    const optional = m.kind === 'parking'; // dal parcheggio la sfida è facoltativa
    body.innerHTML = `<div class="name">🤜 Murra!</div>
      <div>${!mine ? `${name(a)} sta scegliendo chi sfidare…`
        : optional ? 'Sei al Parcheggio Gratuito: vuoi sfidare qualcuno?' : 'Scegli chi sfidare:'}</div>
      <div class="who">${prize} ${goalText(m.goal)}</div>`;
    if (!mine) return;
    body.append(row(...state.players.filter((p) => !p.bankrupt && p.id !== me.id).map((p) => {
      const btn = button(p.nickname, '', () => send('murra:choose', { to: p.id }));
      btn.style.background = p.color;
      return btn;
    })));
    if (optional) body.append(button('Non sfido nessuno', 'btn-ghost', () => send('murra:skip')));
    return;
  }

  if (m.stage === 'offer') { // asta: lo sfidato decide se accettare
    const mine = b.id === me.id;
    body.innerHTML = `<div class="name">🤜 Murra!</div>
      <div>${mine ? `${name(a)} ti sfida a Murra: accetti?` : `In attesa che ${name(b)} risponda alla sfida di ${name(a)}…`}</div>
      <div class="who">${prize}${mine ? ' Se rifiuti, l\'asta continua.' : ''}</div>`;
    if (mine) {
      body.append(row(
        button('✅ Accetto', 'btn-green', () => send('murra:respond', { accept: true })),
        button('❌ Rifiuto', 'btn-pink', () => send('murra:respond', { accept: false })),
      ));
    }
    return;
  }

  const mark = (p) => (m.picked.includes(p.id) ? '✅' : '⏳');
  const playing = [a.id, b.id].includes(me.id);
  body.innerHTML = `<div class="name">🤜 Murra! <small>mano ${m.round}</small></div>
    <div class="versus">${name(a)} ${mark(a)} <strong>${m.score[a.id]} – ${m.score[b.id]}</strong> ${mark(b)} ${name(b)}</div>
    <div class="who">${prize} ${m.goal === 1 ? 'Vince chi indovina per primo la somma.' : `Chi indovina la somma fa un punto: si vince a ${m.goal}.`}</div>`;
  if (playing && !m.picked.includes(me.id)) body.append(murraControls(m));
  else body.insertAdjacentHTML('beforeend', `<div class="who">${playing ? 'Hai giocato: in attesa dell\'avversario…' : 'Stanno scegliendo…'}</div>`);
}

/** Pulsanti per scegliere quante dita mostrare (1-5) e quale somma dichiarare (2-10). */
export function murraControls(m) {
  const key = `${m.a}:${m.b}:${m.round}`;
  if (murraSel.key !== key) murraSel = { key, fingers: 0, guess: 0 };
  const wrap = document.createElement('div');
  wrap.className = 'murra-controls';
  const pick = (html, on, onClick) => {
    const btn = document.createElement('button');
    btn.className = `pick${on ? ' on' : ''}`;
    btn.innerHTML = html;
    btn.onclick = onClick;
    return btn;
  };
  const draw = () => {
    wrap.innerHTML = '<small>1. Quante dita mostri?</small><div class="murra-fingers"></div>'
      + '<small>2. Quanto fa la somma delle due mani?</small><div class="murra-sums"></div>';
    FINGERS.forEach((emoji, k) => {
      const n = k + 1;
      const btn = pick(`<span>${emoji}</span>${n}`, murraSel.fingers === n, () => {
        murraSel.fingers = n;
        if (!sumPossible(murraSel.guess, n)) murraSel.guess = 0; // la somma scelta prima non è più possibile
        draw();
      });
      btn.setAttribute('aria-label', `${n} ${n === 1 ? 'dito' : 'dita'}`);
      wrap.querySelector('.murra-fingers').append(btn);
    });
    for (let sum = 2; sum <= 2 * FINGERS.length; sum++) {
      const btn = pick(sum, murraSel.guess === sum, () => { murraSel.guess = sum; draw(); });
      btn.disabled = !sumPossible(sum, murraSel.fingers);
      wrap.querySelector('.murra-sums').append(btn);
    }
    wrap.append(button('🤜 Gioca!', 'btn-big btn-pink',
      () => send('murra:play', { fingers: murraSel.fingers, guess: murraSel.guess, round: m.round }), !murraSel.fingers || !murraSel.guess));
  };
  draw();
  return wrap;
}

/** Rivelazione di una mano: le due mani, le somme dichiarate, il punto e il punteggio. */
export function showMurraReveal(step) {
  return new Promise((resolve) => {
    const winner = step.winnerId && pl(step.winnerId);
    const scorer = step.scorerId && pl(step.scorerId);
    const timer = setTimeout(closeModal, winner ? UI.MURRA_FINAL_MS : UI.MURRA_HAND_MS); // le mani intermedie scorrono più veloci
    const side = (s) => {
      const p = pl(s.id);
      const points = step.score[s.id];
      return `<div class="murra-side${step.scorerId === s.id ? ' win' : ''}">
        <b style="color:${p?.color}">${esc(p?.nickname || '')}</b>
        <div class="murra-hand">${FINGERS[s.fingers - 1]}</div>
        <div>${s.fingers} ${s.fingers === 1 ? 'dito' : 'dita'}</div>
        <div class="said">dice <b>${s.guess}</b></div>
        <div class="points" aria-label="${points} punti">${'●'.repeat(points)}${'○'.repeat(Math.max(0, step.goal - points))}</div></div>`;
    };
    const bothRight = step.a.guess === step.sum && step.b.guess === step.sum;
    const hand = scorer ? `Punto a ${esc(scorer.nickname)}! 🎯`
      : bothRight ? 'Indovinano entrambi: nessun punto.' : 'Nessuno indovina: nessun punto.';
    const final = !winner ? ''
      : `<p class="murra-final">${step.cutShort ? 'Sfida chiusa in anticipo: vince' : 'Vince la Murra'} ${esc(winner.nickname)}! 🏆</p>`;
    openModal(`
      <h2>🤜 Murra! 🤛</h2>
      <div class="murra-reveal">${side(step.a)}<div class="murra-sum">Somma<b>${step.sum}</b></div>${side(step.b)}</div>
      <p class="murra-outcome">${hand}</p>${final}
      <button class="btn btn-blue" data-close>OK!</button>`, 'murra-modal', () => { clearTimeout(timer); resolve(); });
  });
}
