/**
 * Pannelli della partita: turno, azioni, aste, giocatori, proprietà, info casella, vittoria.
 */
import { CELLS, RULES, euro } from '../shared/board-data.js';
import * as S from '../shared/board-data.js';
import { $, button, esc, openModal, row } from './dom.js';
import {
  canManage,
  clockOffset,
  groupHasHouses,
  isMyTurn,
  meId,
  pl,
  propsOf,
  shown,
  shownJail,
  state,
} from './store.js';
import { send } from './net.js';
import { buildCells, flash, layoutPawns, pawnEls, renderCells, setDice } from './board.js';
import { renderMurraBox } from './murra.js';
import { UI } from './ui-config.js';
import { openTrade, renderTradeBox } from './trade.js';

// ------------------------------------------------------------------------
// Render partita
// ------------------------------------------------------------------------
export function renderGame(prev) {
  buildCells();
  $('#game-code').textContent = state.code;
  // Allinea le pedine allo stato (dopo un'animazione sono già al posto giusto).
  for (const p of state.players) {
    if (pawnEls[p.id] && shown[p.id] !== p.pos) flash(pawnEls[p.id], 'jump', 600);
    shown[p.id] = p.pos;
    shownJail[p.id] = p.inJail;
  }
  $('#dice').style.opacity = state.lastDice ? 1 : 0;
  if (state.lastDice) setDice(state.lastDice);
  renderCells();
  layoutPawns(state.turn?.playerId);
  renderBanner();
  renderActions();
  renderPlayers(prev);
  renderMyProps();
  $('#log').innerHTML = state.log.map((text) => `<li>${esc(text)}</li>`).join('');
}

export function renderBanner() {
  const b = $('#turn-banner');
  if (!state.turn) {
    b.className = 'turn-banner';
    b.style.background = '';
    b.textContent = '🏁 Partita finita';
    return;
  }
  const cur = pl(state.turn.playerId);
  const special = state.murra ? '🤜 Murra!' : state.auction ? '🔨 Asta in corso!' : '';
  const mine = cur.id === meId() && !special;
  b.className = `turn-banner${mine ? ' mine' : ''}`;
  b.style.background = special ? '' : cur.color;
  b.innerHTML = `<span>${special || (mine ? '🎯 Tocca a TE!' : `Tocca a ${esc(cur.nickname)}`)}</span>
    <span class="timer" data-deadline="${state.turn.deadline}"></span>`;
  tickTimers();
}
/** Aggiorna tutti i conti alla rovescia (turno e scambio). */
export function tickTimers() {
  const now = Date.now() + clockOffset;
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    el.textContent = `⏱ ${Math.max(0, Math.ceil((el.dataset.deadline - now) / 1000))}s`;
  });
}

export function renderActions() {
  const box = $('#actions');
  box.innerHTML = '';
  if (!state.turn) return;
  renderTradeBox(box);
  if (state.murra) return renderMurraBox(box);
  if (state.auction) return renderAuctionBox(box);
  const { phase, pendingBuy } = state.turn;
  if (!isMyTurn()) {
    const what = {
      roll: 'sta per tirare i dadi',
      buy: `decide se comprare ${CELLS[pendingBuy]?.name}`,
      end: 'sta gestendo le sue proprietà',
    }[phase];
    box.insertAdjacentHTML(
      'beforeend',
      `<div class="waiting">⏳ ${esc(pl(state.turn.playerId).nickname)} ${esc(what)}…</div>`,
    );
    return;
  }
  const me = pl(meId());
  if (phase === 'roll' && me.inJail) {
    box.append(
      row(
        button('🎲 Tenta il doppio', 'btn-blue', () => send('game:roll')),
        button(
          `🔓 Paga ${euro(RULES.JAIL_FINE)}`,
          'btn-yellow',
          () => send('game:payJail'),
          me.money < RULES.JAIL_FINE,
        ),
        ...(me.jailCards ? [button('🃏 Usa la carta', 'btn-green', () => send('game:useJailCard'))] : []),
      ),
    );
  } else if (phase === 'roll') {
    box.append(button('🎲 Tira i dadi', 'btn-big btn-pink', () => send('game:roll')));
  } else if (phase === 'buy') {
    const cell = CELLS[pendingBuy];
    const card = document.createElement('div');
    card.className = 'buy-card';
    card.innerHTML = `<div class="band" style="background:${S.colorOf(pendingBuy)}"></div>
      <div class="body"><div class="name">${esc(cell.name)}</div>
      <div>Prezzo <b>${euro(cell.price)}</b> · hai ${euro(me.money)}</div></div>`;
    card.querySelector('.body').append(
      row(
        button('🛒 Compra', 'btn-green', () => send('game:buy'), me.money < cell.price),
        button('Passa', 'btn-ghost', () => send('game:pass')),
      ),
    );
    box.append(card);
  } else {
    box.append(button('✅ Fine turno', 'btn-big btn-blue', () => send('game:endTurn')));
  }
}

// ---------- Aste ----------
/** Riquadro dell'asta: lo vedono tutti; chi è ancora in gara può rilanciare o ritirarsi. */
export function renderAuctionBox(box) {
  const a = state.auction;
  const me = pl(meId());
  const leader = a.bidderId && pl(a.bidderId);
  const winning = a.bidderId === me.id;
  const out = me.bankrupt || a.passed.includes(me.id);
  const card = document.createElement('div');
  card.className = 'buy-card auction';
  card.innerHTML = `<div class="band" style="background:${S.colorOf(a.cell)}"></div>
    <div class="body"><div class="name">🔨 ${esc(CELLS[a.cell].name)}</div>
    <div>${
      leader
        ? `Offerta più alta: <b>${euro(a.bid)}</b> di <b style="color:${leader.color}">${esc(leader.nickname)}</b>`
        : `Nessuna offerta: si parte da <b>${euro(S.auctionStart(a.cell))}</b>`
    }</div>
    <div class="who">Prezzo di listino ${euro(CELLS[a.cell].price)} · ${
      winning
        ? `stai vincendo tu! 🎉${a.challengerId ? ' Ma può sfidarti a Murra…' : ''}`
        : out
          ? 'sei fuori da questa asta'
          : `hai ${euro(me.money)}`
    }</div></div>`;
  if (!winning && !out) {
    // Rilanci rapidi: +10, +50, +100 sull'offerta in corso; senza offerte, base d'asta, +50, +100
    const raises = leader
      ? [1, 5, 10].map((k) => a.bid + k * RULES.AUCTION_MIN_STEP)
      : [0, 5, 10].map((k) => S.auctionStart(a.cell) + k * RULES.AUCTION_MIN_STEP);
    card.querySelector('.body').append(
      row(...raises.map((v) => button(euro(v), 'btn-green', () => send('auction:bid', { amount: v }), v > me.money))),
      // Asta rimasta a due: invece di rilanciare si può sfidare a Murra chi ha fatto l'offerta
      ...(a.challengerId === me.id
        ? [button(`🤜 Sfida a Murra per comprarla a ${euro(a.bid)}`, 'btn-pink', () => send('auction:murra'))]
        : []),
      button('Mi ritiro', 'btn-ghost', () => send('auction:pass')),
    );
  }
  box.append(card);
}

export function renderPlayers(prev) {
  const ul = $('#players');
  const tradeOpen = canManage() && !state.trade;
  ul.innerHTML = state.players
    .map(
      (p) => `
    <li data-id="${p.id}" class="${state.turn?.playerId === p.id ? 'current' : ''} ${p.bankrupt ? 'bankrupt' : ''}">
      <span class="dot" style="background:${p.color}"></span>
      <span class="name">${esc(p.nickname)}${p.id === meId() ? ' (tu)' : ''}
        <span class="tag">${p.id === state.hostId ? '👑' : ''}${p.inJail ? ' 🔒' : ''}${p.connected ? '' : ' 📴'}${p.bankrupt ? ' ☠️' : ''}${p.jailCards ? ' 🃏' : ''}</span></span>
      <span class="money">${euro(p.money)}</span>
      ${tradeOpen && p.id !== meId() && !p.bankrupt ? `<button class="btn btn-yellow btn-small" data-trade="${p.id}" title="Proponi uno scambio" aria-label="Proponi uno scambio a ${esc(p.nickname)}">🤝</button>` : ''}
    </li>`,
    )
    .join('');
  ul.querySelectorAll('[data-trade]').forEach((b) => {
    b.onclick = () => openTrade(b.dataset.trade);
  });
  // Variazione di soldi (+200, -50...) rispetto allo stato precedente della stessa partita
  if (prev?.phase !== 'playing') return;
  for (const p of state.players) {
    const old = prev.players.find((q) => q.id === p.id);
    const d = old ? p.money - old.money : 0;
    if (!d) continue;
    const span = document.createElement('span');
    span.className = `delta ${d > 0 ? 'plus' : 'minus'}`;
    span.textContent = `${d > 0 ? '+' : ''}${euro(d)}`;
    ul.querySelector(`[data-id="${p.id}"]`).appendChild(span);
  }
}

export function renderMyProps() {
  const box = $('#my-props');
  const mine = propsOf(meId());
  box.innerHTML = mine.length ? '' : '<div class="empty">Nessuna proprietà… ancora! 🏝️</div>';
  box.insertAdjacentHTML(
    'beforeend',
    '<div class="prop-row"><span class="pn">🃏 Esci di prigione<small>carta da usare o scambiare</small></span></div>'.repeat(
      pl(meId()).jailCards,
    ),
  );
  const can = canManage();
  const me = pl(meId());
  for (const i of mine) {
    const cell = CELLS[i];
    const pr = state.props[i];
    const fullGroup = cell.type === 'prop' && S.groupOf(i).every((c) => state.props[c].owner === me.id);
    const info = pr.mortgaged
      ? 'ipotecata'
      : pr.houses === RULES.MAX_HOUSES
        ? '🏨 albergo'
        : pr.houses
          ? `🏠 × ${pr.houses}`
          : fullGroup
            ? 'gruppo completo!'
            : '';
    const el = document.createElement('div');
    el.className = `prop-row${pr.mortgaged ? ' mort' : ''}`;
    el.innerHTML = `<span class="sw" style="background:${S.colorOf(i)}"></span>
      <span class="pn">${esc(cell.name)}<small>${info}</small></span><span class="ops"></span>`;
    el.querySelector('.pn').onclick = () => showCellInfo(i);
    const op = (label, action, cls, title, affordable = true) => {
      const b = button(label, cls, () => send('game:manage', { action, cell: i }), !can || !affordable);
      b.title = title;
      b.setAttribute('aria-label', `${title}: ${cell.name}`);
      el.querySelector('.ops').append(b);
    };
    if (fullGroup && !pr.mortgaged && pr.houses < RULES.MAX_HOUSES)
      op('+🏠', 'build', 'btn-green', `Costruisci (${euro(S.houseCost(i))})`, me.money >= S.houseCost(i));
    if (pr.houses > 0) op('−🏠', 'sell', 'btn-yellow', `Vendi casa (+${euro(S.houseSellValue(i))})`);
    if (!pr.mortgaged && !groupHasHouses(i))
      op('🏦', 'mortgage', 'btn-ghost', `Ipoteca (+${euro(S.mortgageValue(i))})`);
    if (pr.mortgaged)
      op('✨', 'unmortgage', 'btn-blue', `Riscatta (-${euro(S.unmortgageCost(i))})`, me.money >= S.unmortgageCost(i));
    box.append(el);
  }
}

// ---------- Info casella ----------
export function showCellInfo(i) {
  const cell = CELLS[i];
  const pr = state?.props[i];
  const owner = pr?.owner && pl(pr.owner);
  const table = (rows) =>
    `<table class="info-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
  let details = '';
  if (cell.type === 'prop') {
    details = table([
      ['Affitto', euro(S.propRent(i, 0, false))],
      ['Con tutto il gruppo', euro(S.propRent(i, 0, true))],
      ...[1, 2, 3, 4].map((h) => [`Con ${h} ${h === 1 ? 'casa' : 'case'}`, euro(S.propRent(i, h))]),
      ['Con albergo', euro(S.propRent(i, RULES.MAX_HOUSES))],
      ['Costo di una casa', euro(S.houseCost(i))],
      ['Ipoteca', euro(S.mortgageValue(i))],
    ]);
  } else if (cell.type === 'station') {
    details = table([1, 2, 3, 4].map((n) => [`Con ${n} stazion${n === 1 ? 'e' : 'i'}`, euro(RULES.STATION_RENT[n])]));
  } else if (cell.type === 'utility') {
    details = table([
      ['Con una', `dadi × ${RULES.UTILITY_MULT[1]}`],
      ['Con entrambe', `dadi × ${RULES.UTILITY_MULT[2]}`],
    ]);
  }
  const desc = {
    go: `Ogni volta che passi dal VIA! ritiri ${euro(RULES.GO_SALARY)}.`,
    tax: `Paghi ${euro(cell.amount)} alla banca.`,
    chance: 'Pesca una carta Imprevisti.',
    chest: 'Pesca una carta Probabilità.',
    jail: 'Se sei solo di passaggio non succede nulla.',
    parking: `Puoi sfidare un giocatore a Murra: chi perde dà ${euro(RULES.PARKING_MURRA_STAKE)} a chi vince. 🤜`,
    gotojail: 'Vai dritto in prigione senza passare dal VIA!.',
  }[cell.type];
  openModal(`
    <div class="info-band" style="background:${S.colorOf(i)}"></div>
    <h2>${esc(cell.name)}</h2>
    ${cell.price ? `<p>Prezzo <b>${euro(cell.price)}</b></p>` : ''}
    ${desc ? `<p>${desc}</p>` : ''}
    ${details}
    ${pr ? `<p>${owner ? `Proprietario: <b style="color:${owner.color}">${esc(owner.nickname)}</b>` : 'Libera 🟢'}${pr.mortgaged ? ' · ipotecata' : ''}</p>` : ''}
    <button class="btn btn-blue" data-close>Chiudi</button>`);
}

// ---------- Vittoria ----------
export function renderVictory() {
  const ov = $('#victory');
  const finished = state.phase === 'finished';
  $('#btn-rematch').classList.toggle('hidden', state.hostId !== meId());
  if (finished === ov.classList.contains('show')) return; // già nello stato giusto
  ov.classList.toggle('show', finished);
  if (!finished) return;
  const w = state.winnerId && pl(state.winnerId);
  $('#victory-title').textContent = !w
    ? 'Partita finita'
    : w.id === meId()
      ? 'Hai vinto! 🎉'
      : `${w.nickname} ha vinto!`;
  $('#victory-sub').textContent = w ? `Il re di Soverato chiude con ${euro(w.money)} 🤑` : '';
  confetti();
}

export function confetti() {
  const box = $('#confetti');
  box.innerHTML = '';
  const colors = ['#ff3b8d', '#2f80ff', '#ffd23f', '#22c55e', '#a855f7', '#ff9a50'];
  for (let k = 0; k < 120; k++) {
    const c = document.createElement('div');
    c.className = 'confetto';
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[k % colors.length];
    c.style.animationDuration = `${2.5 + Math.random() * 2.5}s`;
    c.style.animationDelay = `${Math.random() * 1.5}s`;
    box.appendChild(c);
  }
}

/** Avvia l'aggiornamento periodico dei conti alla rovescia. */
export function initPanels() {
  setInterval(tickTimers, UI.TIMER_TICK_MS);
}
