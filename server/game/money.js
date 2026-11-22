/**
 * Soldi, debiti, bancarotta e fine partita.
 */
import { CELLS, euro, groupOf, houseSellValue, mortgageValue } from '../../shared/board-data.js';
import { alive, log, ownedBy } from './state.js';
import { cancelTrade } from './trade.js';

/**
 * Pagamento verso un giocatore (to) o verso la banca (to = null).
 * Se i soldi non bastano, il server ipoteca e vende case in automatico.
 * Se ancora non basta, chi paga va in bancarotta. Ritorna false in caso di bancarotta.
 */
export function pay(room, from, to, amount, reason) {
  if (amount <= 0 || from.bankrupt) return true;
  if (to && to.bankrupt) return true; // nessun affitto a chi è già fuori
  if (from.money < amount) liquidate(room, from, amount);
  if (from.money >= amount) {
    from.money -= amount;
    if (to) to.money += amount;
    log(room, `💸 ${from.nickname} paga ${euro(amount)} ${to ? `a ${to.nickname} ` : ''}per ${reason}.`);
    return true;
  }
  if (to) to.money += from.money;
  from.money = 0;
  log(room, `💥 ${from.nickname} non riesce a pagare ${euro(amount)} per ${reason}!`);
  bankrupt(room, from, to);
  return false;
}

/**
 * Raccolta automatica di soldi per coprire un debito, con le stesse regole delle
 * azioni manuali: prima ipoteca le proprietà dei gruppi senza case (dalla più
 * economica), poi vende una casa alla volta (liberando così altri gruppi).
 */
function liquidate(room, p, target) {
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
  clearTimeout(room.timer);
  cancelTrade(room);
  if (left[0]) log(room, `🏆 ${left[0].nickname} vince Soveratopoly!`);
}
