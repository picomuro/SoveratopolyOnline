/**
 * Gestione delle proprietà del giocatore di turno: case, alberghi, ipoteche.
 */
import { CELLS, RULES, euro, groupOf, houseCost, houseSellValue, mortgageValue, unmortgageCost } from '../../shared/board-data.js';
import { fail } from './errors.js';
import { log } from './state.js';

/** action: build | sell | mortgage | unmortgage sulla casella cellIdx. */
export function manage(room, p, action, cellIdx) {
  const i = Number(cellIdx);
  const pr = room.props[i];
  if (!pr || pr.owner !== p.id) fail('NOT_OWNER', 'Questa proprietà non è tua.');
  const cell = CELLS[i];
  const group = groupOf(i).map((c) => room.props[c]);
  switch (action) {
    case 'build': {
      if (cell.type !== 'prop') fail('BAD', 'Qui non si costruisce.');
      if (!group.every((g) => g.owner === p.id)) fail('BAD', 'Devi possedere tutto il gruppo di colore.');
      if (group.some((g) => g.mortgaged)) fail('BAD', 'Il gruppo ha proprietà ipotecate.');
      if (pr.houses >= RULES.MAX_HOUSES) fail('BAD', "C'è già l'albergo.");
      if (pr.houses > Math.min(...group.map((g) => g.houses))) fail('BAD', 'Costruisci in modo uniforme sul gruppo.');
      const cost = houseCost(i);
      if (p.money < cost) fail('NO_MONEY', 'Non hai abbastanza soldi.');
      p.money -= cost;
      pr.houses++;
      log(room, `🔨 ${p.nickname} costruisce ${pr.houses === RULES.MAX_HOUSES ? 'un albergo' : 'una casa'} su ${cell.name}.`);
      break;
    }
    case 'sell': {
      if (pr.houses <= 0) fail('BAD', 'Non ci sono case.');
      if (pr.houses < Math.max(...group.map((g) => g.houses))) fail('BAD', 'Vendi in modo uniforme sul gruppo.');
      pr.houses--;
      p.money += houseSellValue(i);
      log(room, `🪓 ${p.nickname} vende una casa su ${cell.name} (+${euro(houseSellValue(i))}).`);
      break;
    }
    case 'mortgage': {
      if (pr.mortgaged) fail('BAD', 'È già ipotecata.');
      if (group.some((g) => g.houses > 0)) fail('BAD', 'Prima vendi le case del gruppo.');
      pr.mortgaged = true;
      p.money += mortgageValue(i);
      log(room, `🏦 ${p.nickname} ipoteca ${cell.name} (+${euro(mortgageValue(i))}).`);
      break;
    }
    case 'unmortgage': {
      if (!pr.mortgaged) fail('BAD', 'Non è ipotecata.');
      const cost = unmortgageCost(i);
      if (p.money < cost) fail('NO_MONEY', 'Non hai abbastanza soldi.');
      pr.mortgaged = false;
      p.money -= cost;
      log(room, `✨ ${p.nickname} riscatta ${cell.name} (-${euro(cost)}).`);
      break;
    }
    default:
      fail('BAD', 'Azione sconosciuta.');
  }
}
