/**
 * Scambi tra giocatori: proprietà, soldi e carte "esci di prigione".
 * Senza scambi i gruppi di colore restano divisi e la partita può non finire mai.
 * Si propongono e si accettano solo a mossa ferma (fasi roll ed end del turno), uno alla volta.
 */
import { BOARD_SIZE, CELLS, groupOf, isBuyable } from '../../shared/board-data.js';
import { TRADE_MS } from '../config.js';
import { fail } from './errors.js';
import { later } from './output.js';
import { isCurrent, log, playerById } from './state.js';

/** Fasi del turno in cui gli scambi si possono proporre e accettare. */
const tradeOpenPhase = (room) => room.phase === 'playing' && ['roll', 'end'].includes(room.turn.phase);

/** Controlla che un'offerta sia (ancora) valida. Ritorna [chi propone, chi riceve]. */
function validateTrade(room, t) {
  const from = playerById(room, t.from);
  const to = playerById(room, t.to);
  if (!from || !to || from === to || from.bankrupt || to.bankrupt) fail('BAD', 'Giocatore non valido.');
  const check = (props, owner) => {
    for (const i of props) {
      if (room.props[i]?.owner !== owner.id) fail('BAD', `${CELLS[i].name} non appartiene più a ${owner.nickname}.`);
      if (groupOf(i).some((c) => room.props[c].houses > 0)) {
        fail('BAD', `Prima vanno vendute le case del gruppo di ${CELLS[i].name}.`);
      }
    }
  };
  check(t.give.props, from);
  check(t.get.props, to);
  if (from.jailCards.length < t.give.cards) fail('BAD', `${from.nickname} non ha più la carta "esci di prigione".`);
  if (to.jailCards.length < t.get.cards) fail('BAD', `${to.nickname} non ha più la carta "esci di prigione".`);
  if (from.money < t.give.money) fail('NO_MONEY', `${from.nickname} non ha abbastanza soldi.`);
  if (to.money < t.get.money) fail('NO_MONEY', `${to.nickname} non ha abbastanza soldi.`);
  return [from, to];
}

/** Chiude lo scambio in corso (se c'è), con un messaggio facoltativo in cronologia. */
export function cancelTrade(room, reason) {
  if (!room.trade) return;
  clearTimeout(room.tradeTimer);
  room.trade = null;
  if (reason) log(room, reason);
}

/** Elenco di caselle acquistabili senza doppioni, al massimo una per casella. */
const cellList = (a) => [...new Set(Array.isArray(a) ? a.slice(0, BOARD_SIZE).map(Number) : [])].filter(isBuyable);
/** Quantità intera positiva (soldi o carte); tutto il resto vale 0. */
const quantity = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Il giocatore di turno propone uno scambio a un altro giocatore. */
export function proposeTrade(room, p, { to, giveProps, getProps, giveMoney, getMoney, giveCards, getCards }) {
  if (!isCurrent(room, p)) fail('NOT_YOUR_TURN', 'Non è il tuo turno.');
  if (!tradeOpenPhase(room)) fail('BAD_PHASE', 'Azione non disponibile adesso.');
  if (room.trade) fail('BAD', "C'è già uno scambio in corso.");
  const trade = {
    from: p.id,
    to: String(to),
    give: { props: cellList(giveProps), money: quantity(giveMoney), cards: quantity(giveCards) },
    get: { props: cellList(getProps), money: quantity(getMoney), cards: quantity(getCards) },
    expires: Date.now() + TRADE_MS,
  };
  const items = (side) => side.props.length + side.cards;
  if (!items(trade.give) && !items(trade.get))
    fail('BAD', 'Lo scambio deve includere almeno una proprietà o una carta.');
  const [, other] = validateTrade(room, trade);
  room.trade = trade;
  room.tradeTimer = later(room, TRADE_MS, () => cancelTrade(room, `⌛ Lo scambio con ${other.nickname} è scaduto.`));
  log(room, `🤝 ${p.nickname} propone uno scambio a ${other.nickname}.`);
}

/** Chi riceve la proposta accetta o rifiuta. Rifiutare si può sempre; accettare solo a mossa ferma. */
export function respondTrade(room, p, accept) {
  const t = room.trade;
  if (!t || t.to !== p.id) fail('BAD', 'Nessuno scambio a cui rispondere.');
  if (!accept) return cancelTrade(room, `🙅 ${p.nickname} rifiuta lo scambio.`);
  // Come per la proposta: niente scambi mentre si decide un acquisto o durante un'asta o una Murra.
  if (!tradeOpenPhase(room)) fail('BAD_PHASE', 'Potrai accettare appena finisce la mossa in corso.');
  const [from, to] = validateTrade(room, t);
  for (const i of t.give.props) room.props[i].owner = to.id;
  for (const i of t.get.props) room.props[i].owner = from.id;
  const given = from.jailCards.splice(0, t.give.cards);
  const received = to.jailCards.splice(0, t.get.cards);
  to.jailCards.push(...given);
  from.jailCards.push(...received);
  const net = t.give.money - t.get.money; // soldi che passano da chi propone a chi accetta
  from.money -= net;
  to.money += net;
  cancelTrade(room, `✅ Scambio fatto tra ${from.nickname} e ${to.nickname}!`);
}

/** Chi ha proposto ritira la proposta. */
export function withdrawTrade(room, p) {
  if (room.trade?.from !== p.id) fail('BAD', 'Nessuno scambio da annullare.');
  cancelTrade(room, `↩️ ${p.nickname} annulla lo scambio.`);
}
