/**
 * Soldi, debiti, bancarotta e fine partita.
 *
 * Chi deve pagare più contanti di quanti ne ha, ma potrebbe coprire la cifra vendendo case
 * e ipotecando, non paga subito: il pagamento resta in sospeso in `room.debts` e il turno
 * si ferma (fase 'debt') finché il debitore non raccoglie i soldi con ipoteche, vendite o scambi.
 * Se nemmeno ipotecando tutto si arriva alla cifra, è bancarotta immediata.
 */
import { CELLS, euro, groupOf, houseSellValue, mortgageValue } from '../../shared/board-data.js';
import { alive, log, ownedBy, playerById } from './state.js';
import { cancelTrade } from './trade.js';

/** Totale dei pagamenti in sospeso di un giocatore. */
export const owedBy = (room, p) => room.debts.filter((d) => d.playerId === p.id).reduce((sum, d) => sum + d.amount, 0);

/** Contanti più tutto quello che si può ottenere vendendo le case e ipotecando le proprietà. */
export function assets(room, p) {
  return ownedBy(room, p.id).reduce((sum, i) => {
    const { houses, mortgaged } = room.props[i];
    return sum + houses * houseSellValue(i) + (mortgaged ? 0 : mortgageValue(i));
  }, p.money);
}

function transfer(room, from, to, amount, reason) {
  from.money -= amount;
  if (to) to.money += amount;
  log(room, `💸 ${from.nickname} paga ${euro(amount)} ${to ? `a ${to.nickname} ` : ''}per ${reason}.`);
}

/**
 * Pagamento verso un giocatore (to) o verso la banca (to = null).
 * Ritorna 'paid' (pagato subito), 'debt' (in sospeso: il debitore deve ipotecare o scambiare),
 * 'bankrupt' (nemmeno ipotecando tutto si arriva alla cifra) oppure 'skip' (niente da pagare).
 */
export function pay(room, from, to, amount, reason) {
  if (amount <= 0 || from.bankrupt) return 'skip';
  if (to && to.bankrupt) return 'skip'; // nessun pagamento a chi è già fuori
  const owed = owedBy(room, from);
  if (!owed && from.money >= amount) {
    transfer(room, from, to, amount, reason);
    return 'paid';
  }
  if (assets(room, from) - owed >= amount) {
    room.debts.push({ playerId: from.id, to: to ? to.id : null, amount, reason });
    log(
      room,
      `😰 ${from.nickname} deve pagare ${euro(amount)} ${to ? `a ${to.nickname} ` : ''}per ${reason}, ma non ha abbastanza contanti: deve ipotecare o fare uno scambio.`,
    );
    return 'debt';
  }
  goBankrupt(room, from, to, amount, reason);
  return 'bankrupt';
}

/** Non c'è modo di pagare: i contanti rimasti vanno al creditore e il giocatore è fuori. */
function goBankrupt(room, from, to, amount, reason) {
  if (to) to.money += from.money;
  from.money = 0;
  log(room, `💥 ${from.nickname} non riesce a pagare ${euro(amount)} per ${reason}!`);
  bankrupt(room, from, to);
}

/**
 * Paga i debiti in sospeso che ora sono coperti dai contanti, nell'ordine in cui sono nati.
 * Chi non può più arrivare alla cifra (es. ha ceduto proprietà in uno scambio) va in bancarotta.
 */
export function settleDebts(room) {
  if (!room.debts.length) return;
  const waiting = new Set(); // debitori con un debito ancora scoperto: i successivi aspettano
  room.debts = room.debts.filter((d) => {
    const from = playerById(room, d.playerId);
    const to = d.to && playerById(room, d.to);
    if (!from || from.bankrupt || (to && to.bankrupt)) return false;
    if (waiting.has(from.id) || from.money < d.amount) {
      waiting.add(from.id);
      return true;
    }
    transfer(room, from, to, d.amount, d.reason);
    return false;
  });
  for (const id of waiting) {
    const p = playerById(room, id);
    const first = room.debts.find((d) => d.playerId === id);
    if (p.bankrupt || !first) continue;
    const owed = owedBy(room, p);
    if (assets(room, p) < owed) goBankrupt(room, p, first.to && playerById(room, first.to), owed, first.reason);
  }
}

/**
 * Raccolta automatica di soldi per coprire un debito (solo per chi è scollegato), con le stesse
 * regole delle azioni manuali: prima ipoteca le proprietà dei gruppi senza case (dalla più
 * economica), poi vende una casa alla volta (liberando così altri gruppi).
 */
export function liquidate(room, p, target) {
  const mine = ownedBy(room, p.id);
  const { props } = room;
  let mortgaged = 0;
  let sold = 0;
  let raised = 0;
  while (p.money < target) {
    const free = mine
      .filter((i) => !props[i].mortgaged && groupOf(i).every((c) => props[c].houses === 0))
      .sort((a, b) => CELLS[a].price - CELLS[b].price)[0];
    if (free !== undefined) {
      props[free].mortgaged = true;
      p.money += mortgageValue(free);
      raised += mortgageValue(free);
      mortgaged++;
      continue;
    }
    const built = mine.filter((i) => props[i].houses > 0).sort((a, b) => props[b].houses - props[a].houses)[0];
    if (built === undefined) break; // non resta più nulla da vendere
    props[built].houses--;
    p.money += houseSellValue(built);
    raised += houseSellValue(built);
    sold++;
  }
  if (!raised) return;
  const parts = [
    mortgaged && `ipoteca ${mortgaged} proprietà`,
    sold && `vende ${sold} ${sold === 1 ? 'casa' : 'case'}`,
  ].filter(Boolean);
  log(room, `🏦 ${p.nickname} ${parts.join(' e ')} per raccogliere ${euro(raised)}.`);
}

/** Bancarotta: le proprietà vanno al creditore, oppure tornano libere se il debito era con la banca. */
export function bankrupt(room, p, creditor) {
  p.bankrupt = true;
  p.inJail = false;
  for (const i of ownedBy(room, p.id)) {
    Object.assign(
      room.props[i],
      creditor
        ? { owner: creditor.id, houses: 0 } // l'eventuale ipoteca resta
        : { owner: null, houses: 0, mortgaged: false },
    );
  }
  if (creditor) creditor.jailCards.push(...p.jailCards);
  p.jailCards = []; // senza creditore tornano nei mazzi al prossimo rimescolamento
  // I suoi debiti in sospeso spariscono, e così quelli degli altri verso di lui.
  room.debts = room.debts.filter((d) => d.playerId !== p.id && d.to !== p.id);
  log(
    room,
    `☠️ ${p.nickname} è in bancarotta! ${creditor ? `Le sue proprietà vanno a ${creditor.nickname}.` : 'Le sue proprietà tornano libere.'}`,
  );
  if (room.trade && [room.trade.from, room.trade.to].includes(p.id)) cancelTrade(room);
  if (room.auction?.bidderId === p.id) Object.assign(room.auction, { bid: 0, bidderId: null }); // l'asta riparte dalla base d'asta
  checkWinner(room);
}

/** Se resta un solo giocatore con dei soldi, la partita finisce. */
function checkWinner(room) {
  const left = alive(room);
  if (room.phase !== 'playing' || left.length > 1) return;
  room.phase = 'finished';
  room.winnerId = left[0]?.id || null;
  room.turn = null;
  room.auction = null;
  room.murra = null;
  room.debts = [];
  clearTimeout(room.timer);
  cancelTrade(room);
  if (left[0]) log(room, `🏆 ${left[0].nickname} vince Soveratopoly!`);
}
