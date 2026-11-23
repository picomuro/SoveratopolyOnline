/**
 * Dadi, movimento, effetti delle caselle e delle carte, acquisti e prigione.
 * Ogni funzione aggiunge ad `anim` i passi da animare sui client.
 */
import { BOARD_SIZE, CELLS, RULES, euro, groupOf, propRent } from '../../shared/board-data.js';
import { JAIL_MAX_TRIES, MAX_CARD_CHAIN, MAX_DOUBLES } from '../config.js';
import { DECKS, newDeck } from './decks.js';
import { fail } from './errors.js';
import { die } from './random.js';
import { alive, log, ownedBy, playerById } from './state.js';
import { finishAction } from './turns.js';
import { pay } from './money.js';
import { newMurra } from './murra.js';

/** Tiro dei dadi del giocatore di turno. */
export function doRoll(room, p) {
  const anim = [];
  const d = [die(), die()];
  const sum = d[0] + d[1];
  const doubles = d[0] === d[1];
  room.lastDice = d;
  room.turn.rollAgain = false;
  anim.push({ t: 'dice', dice: d });
  log(room, `🎲 ${p.nickname} ha tirato ${d[0]} + ${d[1]} = ${sum}${doubles ? ' (doppio!)' : ''}`);

  if (applyJailAndDoubles(room, p, doubles, anim)) {
    moveForward(room, p, sum, anim);
    land(room, p, anim, sum);
  }
  finishAction(room, anim);
}

/** Regole di prigione e doppi. Ritorna true se dopo il tiro la pedina si muove. */
function applyJailAndDoubles(room, p, doubles, anim) {
  if (p.inJail) {
    if (doubles) {
      p.inJail = false;
      p.jailTurns = 0;
      log(room, `🔓 ${p.nickname} esce di prigione con un doppio!`);
      return true; // esce e si muove, ma senza tiro extra
    }
    if (++p.jailTurns < JAIL_MAX_TRIES) {
      log(room, `🔒 ${p.nickname} resta in prigione (tentativo ${p.jailTurns}/${JAIL_MAX_TRIES}).`);
      return false;
    }
    log(room, `🔓 Ultimo tentativo fallito: ${p.nickname} deve pagare la cauzione.`);
    p.inJail = false;
    p.jailTurns = 0;
    return pay(room, p, null, RULES.JAIL_FINE, 'la cauzione') !== 'bankrupt'; // se resta in sospeso si muove lo stesso
  }
  if (!doubles) return true;
  if (++room.turn.doubles >= MAX_DOUBLES) {
    log(room, `🚨 Tre doppi di fila! ${p.nickname} va in prigione.`);
    sendToJail(room, p, anim);
    return false;
  }
  room.turn.rollAgain = true;
  return true;
}

/** Avanti di alcune caselle, ritirando lo stipendio passando dal VIA!. */
export function moveForward(room, p, steps, anim) {
  const path = [];
  for (let k = 0; k < steps; k++) {
    p.pos = (p.pos + 1) % BOARD_SIZE;
    path.push(p.pos);
    if (p.pos === 0) {
      p.money += RULES.GO_SALARY;
      log(room, `💰 ${p.nickname} passa dal VIA! e ritira ${euro(RULES.GO_SALARY)}.`);
    }
  }
  if (path.length) anim.push({ t: 'move', playerId: p.id, path });
}

/** Indietro di alcune caselle: non si ritira nulla passando dal VIA!. */
function moveBackward(p, steps, anim) {
  const path = [];
  for (let k = 0; k < steps; k++) {
    p.pos = (p.pos - 1 + BOARD_SIZE) % BOARD_SIZE;
    path.push(p.pos);
  }
  anim.push({ t: 'move', playerId: p.id, path });
}

function sendToJail(room, p, anim) {
  Object.assign(p, { pos: RULES.JAIL_CELL, inJail: true, jailTurns: 0 });
  room.turn.rollAgain = false;
  anim.push({ t: 'jump', playerId: p.id, to: RULES.JAIL_CELL, jail: true });
}

/**
 * Effetto della casella su cui il giocatore è arrivato.
 * special (solo arrivando con una carta): { rentMult } moltiplica l'affitto,
 * { rollForRent } fa tirare i dadi apposta e pagare quel multiplo del risultato.
 */
export function land(room, p, anim, diceSum, cardDepth = 0, special = {}) {
  const cell = CELLS[p.pos];
  switch (cell.type) {
    case 'prop':
    case 'station':
    case 'utility': {
      const pr = room.props[p.pos];
      if (!pr.owner) {
        room.turn.pendingBuy = p.pos;
        break;
      }
      if (pr.owner === p.id) break;
      if (pr.mortgaged) {
        log(room, `🏚️ ${cell.name} è ipotecata: niente affitto.`);
        break;
      }
      let rent = calcRent(room, p.pos, diceSum) * (special.rentMult || 1);
      if (special.rollForRent) {
        const d = [die(), die()];
        room.lastDice = d;
        anim.push({ t: 'dice', dice: d });
        rent = (d[0] + d[1]) * special.rollForRent;
        log(
          room,
          `🎲 ${p.nickname} tira ${d[0]} + ${d[1]} per l'affitto: paga ${special.rollForRent} volte il risultato.`,
        );
      }
      const owner = playerById(room, pr.owner);
      // Chi paga vede un avviso; se il pagamento resta in sospeso compare invece l'avviso del debito.
      if (pay(room, p, owner, rent, `l'affitto di ${cell.name}`) === 'paid')
        anim.push({ t: 'rent', playerId: p.id, ownerId: owner.id, cell: p.pos, amount: rent });
      break;
    }
    case 'tax':
      pay(room, p, null, cell.amount, cell.name);
      break;
    case 'chance':
    case 'chest':
      if (cardDepth < MAX_CARD_CHAIN) drawCard(room, p, cell.type, anim, diceSum, cardDepth);
      break;
    case 'gotojail':
      log(room, `🚓 ${p.nickname} finisce In Prigione!`);
      sendToJail(room, p, anim);
      break;
    case 'parking':
      // A fine azione (vedi finishAction) chi è arrivato qui può sfidare un giocatore a Murra.
      room.murra = newMurra('parking', p.id, null, RULES.PARKING_MURRA_STAKE);
      break;
    default:
      break; // VIA!, prigione in transito: nessun effetto
  }
}

/** Affitto dovuto su una casella posseduta da qualcuno. */
export function calcRent(room, i, diceSum) {
  const { type } = CELLS[i];
  const { owner, houses } = room.props[i];
  const ownedOfType = () => ownedBy(room, owner).filter((k) => CELLS[k].type === type).length;
  if (type === 'station') return RULES.STATION_RENT[ownedOfType()];
  if (type === 'utility') return diceSum * RULES.UTILITY_MULT[ownedOfType()];
  const fullGroup = groupOf(i).every((c) => room.props[c].owner === owner);
  return propRent(i, houses, fullGroup);
}

/** Indici delle caselle di un certo tipo (stazioni, servizi). */
const cellsOfType = (type) => CELLS.map((c, i) => (c.type === type ? i : -1)).filter((i) => i >= 0);

function drawCard(room, p, deckName, anim, diceSum, cardDepth) {
  const { title } = DECKS[deckName];
  if (!room.decks[deckName].length) room.decks[deckName] = newDeck(room.players, deckName);
  const card = room.decks[deckName].shift();
  anim.push({ t: 'card', deck: deckName, title, text: card.text, note: card.note, playerId: p.id });
  log(room, `🃏 ${p.nickname} pesca ${title}: "${card.text}" (${card.note})`);

  const others = alive(room).filter((o) => o.id !== p.id);
  const landAgain = (special) => land(room, p, anim, diceSum, cardDepth + 1, special);
  switch (card.kind) {
    case 'money':
      if (card.value >= 0) p.money += card.value;
      else pay(room, p, null, -card.value, 'la carta');
      break;
    case 'goto':
      moveForward(room, p, (card.to - p.pos + BOARD_SIZE) % BOARD_SIZE, anim);
      landAgain();
      break;
    case 'nearest': {
      // stazione o servizio più vicino, andando avanti
      const cells = cellsOfType(card.type);
      const target = cells.find((c) => c > p.pos) ?? cells[0];
      moveForward(room, p, (target - p.pos + BOARD_SIZE) % BOARD_SIZE, anim);
      landAgain(card.type === 'station' ? { rentMult: 2 } : { rollForRent: 10 });
      break;
    }
    case 'jailfree':
      p.jailCards.push(deckName); // tornerà nel mazzo quando verrà usata
      break;
    case 'back':
      moveBackward(p, card.value, anim);
      landAgain();
      break;
    case 'jail':
      sendToJail(room, p, anim);
      break;
    case 'payEach':
      for (const o of others) pay(room, p, o, card.value, 'la carta'); // pay() si ferma da solo dopo una bancarotta
      break;
    case 'collectEach':
      for (const o of others) pay(room, o, p, card.value, 'il regalo');
      break;
    case 'murra':
      // La sfida parte a fine azione (vedi finishAction), dopo l'animazione della carta.
      room.murra = newMurra('card', p.id, null, card.value, card.points);
      break;
    case 'repairs': {
      const total = ownedBy(room, p.id).reduce((sum, i) => {
        const { houses } = room.props[i];
        return sum + (houses === RULES.MAX_HOUSES ? card.hotel : houses * card.house);
      }, 0);
      if (total) pay(room, p, null, total, 'i lavori');
      else log(room, `😅 ${p.nickname} non ha case: non paga nulla.`);
      break;
    }
    default:
      break;
  }
}

/** Il giocatore di turno compra la proprietà su cui è arrivato. */
export function doBuy(room, p) {
  const i = room.turn.pendingBuy;
  const cell = CELLS[i];
  if (p.money < cell.price) fail('NO_MONEY', 'Non hai abbastanza soldi.');
  p.money -= cell.price;
  room.props[i].owner = p.id;
  room.turn.pendingBuy = null;
  log(room, `🏠 ${p.nickname} compra ${cell.name} per ${euro(cell.price)}.`);
  finishAction(room);
}

/** Uscita dalla prigione pagando la cauzione, prima di tirare. */
export function payJail(room, p) {
  if (!p.inJail) fail('BAD', 'Non sei in prigione.');
  if (p.money < RULES.JAIL_FINE) fail('NO_MONEY', 'Non hai abbastanza soldi.');
  p.money -= RULES.JAIL_FINE;
  p.inJail = false;
  p.jailTurns = 0;
  log(room, `🔓 ${p.nickname} paga ${euro(RULES.JAIL_FINE)} ed esce di prigione.`);
}

/** Uscita dalla prigione con la carta, prima di tirare. */
export function useJailCard(room, p) {
  if (!p.inJail) fail('BAD', 'Non sei in prigione.');
  if (!p.jailCards.length) fail('BAD', 'Non hai la carta per uscire di prigione.');
  p.jailCards.pop(); // la carta torna nel suo mazzo al prossimo rimescolamento
  p.inJail = false;
  p.jailTurns = 0;
  log(room, `🃏 ${p.nickname} usa la carta ed esce di prigione senza pagare.`);
}
