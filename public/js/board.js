/**
 * Tabellone: geometria delle caselle sull'immagine, segni dei proprietari, case, pedine, dadi
 * e animazioni inviate dal server.
 */
import { BOUNDS as BD, CELLS, RULES, euro } from '../shared/board-data.js';
import * as S from '../shared/board-data.js';
import { $, closeModal, esc, openModal, sleep, toast } from './dom.js';
import { meId, pl, shown, shownJail, state } from './store.js';
import { showCellInfo } from './panels.js';
import { showMurraReveal } from './murra.js';
import { UI } from './ui-config.js';

// ------------------------------------------------------------------------
// Geometria del tabellone (percentuali sull'immagine)
// ------------------------------------------------------------------------
export function cellRect(i) {
  const box = (x0, y0, x1, y1, side) => ({ x0, y0, x1, y1, side });
  const k = i % 10;
  if (k === 0) {
    // angoli: VIA!, prigione, parcheggio, "In Prigione!"
    const [x, y] = [
      [10, 10],
      [0, 10],
      [0, 0],
      [10, 0],
    ][i / 10];
    return box(BD[x], BD[y], BD[x + 1], BD[y + 1], 'corner');
  }
  if (i < 10) return box(BD[10 - k], BD[10], BD[11 - k], BD[11], 'bottom');
  if (i < 20) return box(BD[0], BD[10 - k], BD[1], BD[11 - k], 'left');
  if (i < 30) return box(BD[k], BD[0], BD[k + 1], BD[1], 'top');
  return box(BD[10], BD[k], BD[11], BD[k + 1], 'right');
}

/** Lato esterno di ogni fila di caselle: asse e verso. */
export const OUTER_EDGE = { bottom: ['y', 1], top: ['y', -1], left: ['x', -1], right: ['x', 1] };
/** Striscia spessa t lungo il bordo esterno (verso il prezzo) o interno (fascia colorata) di una casella. */
export function strip(r, t, outer, pad = 0) {
  const [axis, dir] = OUTER_EDGE[r.side];
  const s = { x0: r.x0 + pad, y0: r.y0 + pad, x1: r.x1 - pad, y1: r.y1 - pad };
  if ((dir === 1) === outer) s[`${axis}0`] = s[`${axis}1`] - t;
  else s[`${axis}1`] = s[`${axis}0`] + t;
  return s;
}
export const place = (el, r) =>
  Object.assign(el.style, {
    left: `${r.x0}%`,
    top: `${r.y0}%`,
    width: `${r.x1 - r.x0}%`,
    height: `${r.y1 - r.y0}%`,
  });

/** Posizione (in %) della k-esima di n pedine sulla stessa casella (fino a 8). */
export function pawnSpot(i, k, n, inJail) {
  if (i === RULES.JAIL_CELL) {
    if (inJail) return { x: 8.6 + (k % 3) * 2.6, y: 89.4 + Math.floor(k / 3) * 2.8 }; // dentro il riquadro arancione
    return k < 4 ? { x: 3.3, y: 86.6 + k * 3 } : { x: 6.3 + (k - 4) * 2.6, y: 96.6 }; // lungo la fascia "Transito"
  }
  const r = cellRect(i);
  const cx = (r.x0 + r.x1) / 2,
    cy = (r.y0 + r.y1) / 2;
  const tall = r.side === 'bottom' || r.side === 'top'; // casella alta e stretta: 2 colonne, altrimenti 4
  const cols = Math.min(n, tall ? 2 : 4);
  const rows = Math.ceil(n / cols);
  const col = k % cols,
    row = Math.floor(k / cols);
  return { x: cx + (col - (cols - 1) / 2) * 3.2, y: cy + (row - (rows - 1) / 2) * 3.2 };
}

// ---------- Livello caselle (cliccabili, proprietari, case) ----------
export const cellEls = [];
export function buildCells() {
  if (cellEls.length) return;
  const layer = $('#cells-layer');
  const add = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    layer.appendChild(el);
    return el;
  };
  CELLS.forEach((cell, i) => {
    const r = cellRect(i);
    const hit = add('cell-hit');
    place(hit, r);
    hit.title = cell.name;
    // Casella usabile anche da tastiera: Invio o spazio aprono le informazioni.
    hit.tabIndex = 0;
    hit.setAttribute('role', 'button');
    hit.setAttribute('aria-label', cell.name);
    hit.onclick = () => showCellInfo(i);
    hit.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      showCellInfo(i);
    };
    cellEls[i] = { hit };
    if (!S.isBuyable(i)) return;
    // Il segno del proprietario va sul lato esterno (sopra il prezzo), le case sulla fascia colorata.
    const mark = add('owner-mark hidden');
    place(mark, strip(r, 2.4, true, 0.5));
    const houses = add('houses');
    place(houses, strip(r, 3, false));
    if (OUTER_EDGE[r.side][0] === 'x') houses.style.flexDirection = 'column';
    Object.assign(cellEls[i], { mark, houses });
  });
}

export function renderCells() {
  cellEls.forEach(({ hit, mark, houses }, i) => {
    hit.classList.toggle('highlight', state.turn?.pendingBuy === i || state.auction?.cell === i);
    const pr = state.props[i];
    if (!pr) return;
    const owner = pr.owner && pl(pr.owner);
    hit.classList.toggle('mortgaged', pr.mortgaged);
    mark.classList.toggle('hidden', !owner);
    if (owner) mark.style.background = owner.color;
    houses.innerHTML =
      pr.houses === RULES.MAX_HOUSES ? '<span class="hotel"></span>' : '<span class="house"></span>'.repeat(pr.houses);
  });
}

// ---------- Pedine ----------
export const pawnEls = {};
export function layoutPawns(activeId = null) {
  const layer = $('#pawns-layer');
  const byCell = {};
  for (const p of state.players) {
    if (!pawnEls[p.id]) {
      const el = document.createElement('div');
      el.className = 'pawn';
      el.textContent = Array.from(p.nickname)[0].toUpperCase(); // Array.from: non spezza le emoji
      el.style.background = p.color;
      layer.appendChild(el);
      pawnEls[p.id] = el;
    }
    if (shown[p.id] === undefined) {
      shown[p.id] = p.pos;
      shownJail[p.id] = p.inJail;
    }
    pawnEls[p.id].classList.toggle('hidden', p.bankrupt);
    pawnEls[p.id].classList.toggle('active', p.id === activeId);
    if (p.bankrupt) continue;
    const key = `${shown[p.id]}${shownJail[p.id] ? 'j' : ''}`;
    (byCell[key] = byCell[key] || []).push(p);
  }
  for (const list of Object.values(byCell)) {
    list.forEach((p, k) => {
      const spot = pawnSpot(shown[p.id], k, list.length, shownJail[p.id]);
      pawnEls[p.id].style.left = `${spot.x}%`;
      pawnEls[p.id].style.top = `${spot.y}%`;
    });
  }
  // Pedine di giocatori non più presenti
  for (const id of Object.keys(pawnEls)) {
    if (!pl(id)) {
      pawnEls[id].remove();
      delete pawnEls[id];
      delete shown[id];
      delete shownJail[id];
    }
  }
}

/** Fa ripartire un'animazione CSS e la rimuove dopo ms. */
export function flash(el, cls, ms) {
  el.classList.remove(cls);
  void el.offsetWidth; // forza il reflow: l'animazione riparte da capo
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

// ---------- Dadi 3D ----------
export const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }; // posizioni su griglia 3x3
export const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] }; // rotazione che porta la faccia davanti
let dice = [];
let spins = 0;
/** Disegna le sei facce dei due dadi (una volta sola). */
export function initDice() {
  dice = [$('#die1'), $('#die2')];
  for (const die of dice) {
    die.innerHTML = Object.entries(PIPS)
      .map(
        ([n, pips]) =>
          `<div class="face f${n}">${pips
            .map((c) => `<span class="pip" style="grid-area:${Math.ceil(c / 3)}/${((c - 1) % 3) + 1}"></span>`)
            .join('')}</div>`,
      )
      .join('');
  }
}
export function setDice(values) {
  dice.forEach((die, k) => {
    const [x, y] = FACE_ROT[values[k]];
    die.style.transform = `rotateX(${x + spins * 720}deg) rotateY(${y + spins * 360}deg)`;
  });
}
export async function rollDice(values) {
  $('#dice').style.opacity = 1;
  dice.forEach((d) => d.classList.add('rolling'));
  await sleep(550);
  dice.forEach((d) => d.classList.remove('rolling'));
  spins++; // giri in più: la transizione verso la nuova faccia è sempre visibile
  setDice(values);
  await sleep(950);
}

// ------------------------------------------------------------------------
// Animazioni inviate dal server (lo stato definitivo arriva subito dopo)
// ------------------------------------------------------------------------
export const setBusy = (on) => $('#screen-game').classList.toggle('busy', on);

export async function playAnim(steps) {
  if (!state || state.phase === 'lobby') return;
  setBusy(true);
  $('#actions').innerHTML = '';
  try {
    for (const step of steps) {
      const pawn = pawnEls[step.playerId];
      if (step.t === 'dice') await rollDice(step.dice);
      else if (step.t === 'card') await showCard(step);
      else if (step.t === 'murra') await showMurraReveal(step);
      else if (step.t === 'rent') showRent(step);
      else if (!pawn) continue;
      else if (step.t === 'move') {
        shownJail[step.playerId] = false;
        for (const pos of step.path) {
          shown[step.playerId] = pos;
          layoutPawns();
          flash(pawn, 'hop', 180);
          await sleep(190);
        }
        await sleep(150);
      } else if (step.t === 'jump') {
        shown[step.playerId] = step.to;
        shownJail[step.playerId] = !!step.jail;
        flash(pawn, 'jump', 600);
        layoutPawns();
        await sleep(650);
      }
    }
  } finally {
    setBusy(false); // anche in caso di errore i pulsanti tornano disponibili
  }
}

/** Animazioni saltate (scheda in background): restano comunque gli avvisi di pagamento. */
export function showSkippedNotices(steps) {
  for (const step of steps) if (step.t === 'rent') showRent(step);
}

/** Affitto pagato: chi paga vede un avviso da chiudere con OK, chi incassa un messaggio veloce. */
function showRent(step) {
  const payer = pl(step.playerId);
  const owner = pl(step.ownerId);
  const cell = CELLS[step.cell].name;
  if (!payer || !owner) return;
  if (payer.id === meId()) {
    openModal(`
      <div class="big-emoji">🏠</div>
      <h2>Affitto da pagare</h2>
      <p>Sei finito su <b>${esc(cell)}</b>, di proprietà di <b style="color:${owner.color}">${esc(owner.nickname)}</b>.</p>
      <p>Paghi <b>${euro(step.amount)}</b> di affitto.</p>
      <button class="btn btn-big btn-blue" data-close>OK</button>`);
  } else if (owner.id === meId()) {
    toast(`💰 ${payer.nickname} ti paga ${euro(step.amount)} di affitto per ${cell}`);
  }
}

export function showCard(step) {
  return new Promise((resolve) => {
    const timer = setTimeout(closeModal, UI.CARD_AUTOCLOSE_MS);
    openModal(
      `
      <div class="head ${step.deck}">${step.deck === 'chance' ? '❓' : '🎁'} ${esc(step.title)}</div>
      <div class="text">${esc(step.text)}</div>
      <div class="note">${esc(step.note || '')}</div>
      <p class="who">${esc(pl(step.playerId)?.nickname || '')}</p>
      <button class="btn btn-big btn-blue" data-close>OK!</button>`,
      'game-card',
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}
