/** Acquisti, affitti, aste, bancarotta, scambi, case e ipoteche. */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, RULES, auctionStart, propRent } from '../shared/board-data.js';
import * as game from '../server/game/index.js';
import { AUCTION_START_MS } from '../server/config.js';
import { captureOutput, closeRoom, give, newGame, scriptDice } from './helpers.js';

const SOTTOPASSAGGIO = 3;
const CASE_POPOLARI = 1; // stesso gruppo marrone
const PASSAGGIO_A_LIVELLO = 5; // stazione
const STAZIONE_AUTOBUS = 15;
const RASPA = 12; // servizio

let room, players;
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  captureOutput();
});
afterEach(() => {
  if (room) closeRoom(room);
  mock.timers.reset();
  game.setRandom();
});

/** Porta P0 sulla casella `cell` partendo da `cell - 3` con un tiro 1+2. */
function landOn(cell) {
  players[0].pos = cell - 3;
  game.doRoll(room, players[0]);
}

test('comprare: soldi scalati, proprietà assegnata, poi fine turno', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  game.doRoll(room, players[0]);
  game.doBuy(room, players[0]);
  assert.equal(room.props[SOTTOPASSAGGIO].owner, players[0].id);
  assert.equal(players[0].money, RULES.START_MONEY - CELLS[SOTTOPASSAGGIO].price);
  assert.equal(room.turn.phase, 'end');
});

test('affitto base, raddoppiato con il gruppo completo, moltiplicato dalle case', () => {
  scriptDice([1, 2, 1, 2, 1, 2]);
  ({ room, players } = newGame());
  const [p0, p1] = players;
  give(room, p1, SOTTOPASSAGGIO);
  landOn(SOTTOPASSAGGIO);
  const base = propRent(SOTTOPASSAGGIO, 0, false);
  assert.equal(p0.money, RULES.START_MONEY - base);
  assert.equal(p1.money, RULES.START_MONEY + base);

  give(room, p1, CASE_POPOLARI);
  assert.equal(game.calcRent(room, SOTTOPASSAGGIO, 3), 2 * base);
  room.props[SOTTOPASSAGGIO].houses = 2;
  assert.equal(game.calcRent(room, SOTTOPASSAGGIO, 3), base * RULES.HOUSE_MULT[2]);
});

test('stazioni: affitto secondo quante ne ha il proprietario; servizi: dadi × moltiplicatore', () => {
  scriptDice();
  ({ room, players } = newGame());
  const [, p1] = players;
  give(room, p1, PASSAGGIO_A_LIVELLO);
  assert.equal(game.calcRent(room, PASSAGGIO_A_LIVELLO, 7), RULES.STATION_RENT[1]);
  give(room, p1, STAZIONE_AUTOBUS);
  assert.equal(game.calcRent(room, PASSAGGIO_A_LIVELLO, 7), RULES.STATION_RENT[2]);
  give(room, p1, RASPA);
  assert.equal(game.calcRent(room, RASPA, 7), 7 * RULES.UTILITY_MULT[1]);
});

test('su una proprietà ipotecata non si paga affitto', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  give(room, players[1], SOTTOPASSAGGIO);
  room.props[SOTTOPASSAGGIO].mortgaged = true;
  landOn(SOTTOPASSAGGIO);
  assert.equal(players[0].money, RULES.START_MONEY);
});

test("asta: base a metà prezzo, rilancio minimo, chi vince paga l'offerta", () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame(3));
  const [p0, p1, p2] = players;
  game.doRoll(room, p0);
  game.doPass(room, p0);
  assert.equal(room.turn.phase, 'auction');
  const start = auctionStart(SOTTOPASSAGGIO);
  assert.throws(() => game.placeBid(room, p1, start - 1), /offerta minima/);
  game.placeBid(room, p1, start);
  assert.throws(() => game.placeBid(room, p2, start + 5), /offerta minima/);
  assert.throws(() => game.placeBid(room, p1, start + 10), /già tua/);
  assert.throws(
    () => game.placeBid(room, p2, 99999),
    (e) => e.code === 'NO_MONEY',
  );
  game.placeBid(room, p2, start + 10);
  game.leaveAuction(room, p0);
  game.leaveAuction(room, p1);
  assert.equal(room.auction, null);
  assert.equal(room.props[SOTTOPASSAGGIO].owner, p2.id);
  assert.equal(p2.money, RULES.START_MONEY - start - 10);
  assert.equal(room.turn.phase, 'end');
});

test('asta senza offerte entro il tempo: la proprietà resta libera', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  game.doRoll(room, players[0]);
  game.doPass(room, players[0]);
  mock.timers.tick(AUCTION_START_MS);
  assert.equal(room.auction, null);
  assert.equal(room.props[SOTTOPASSAGGIO].owner, null);
  assert.ok(room.log.some((l) => l.includes('Asta deserta')));
});

test("debito non coperto: ipoteche automatiche, poi bancarotta e vittoria dell'ultimo rimasto", () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  const [p0, p1] = players;
  give(room, p1, SOTTOPASSAGGIO, CASE_POPOLARI);
  room.props[SOTTOPASSAGGIO].houses = 5; // albergo: affitto altissimo
  room.props[CASE_POPOLARI].houses = 5;
  give(room, p0, 39); // Torre di Carlo V: verrà ipotecata in automatico
  p0.money = 10;
  landOn(SOTTOPASSAGGIO);
  assert.equal(p0.bankrupt, true);
  assert.equal(room.props[39].owner, p1.id, 'le proprietà vanno al creditore');
  assert.equal(room.phase, 'finished');
  assert.equal(room.winnerId, p1.id);
});

test('pagamento coperto vendendo le ipoteche: niente bancarotta', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  const [p0, p1] = players;
  give(room, p1, SOTTOPASSAGGIO);
  give(room, p0, 39);
  p0.money = 0;
  landOn(SOTTOPASSAGGIO);
  assert.equal(p0.bankrupt, false);
  assert.equal(room.props[39].mortgaged, true);
  assert.equal(p1.money, RULES.START_MONEY + propRent(SOTTOPASSAGGIO, 0, false));
});

test('case: solo con il gruppo completo e in modo uniforme; ipoteca solo senza case', () => {
  scriptDice();
  ({ room, players } = newGame());
  const [p0] = players;
  give(room, p0, SOTTOPASSAGGIO);
  assert.throws(() => game.manage(room, p0, 'build', SOTTOPASSAGGIO), /tutto il gruppo/);
  give(room, p0, CASE_POPOLARI);
  game.manage(room, p0, 'build', SOTTOPASSAGGIO);
  assert.throws(() => game.manage(room, p0, 'build', SOTTOPASSAGGIO), /uniforme/);
  assert.throws(() => game.manage(room, p0, 'mortgage', CASE_POPOLARI), /vendi le case/);
  game.manage(room, p0, 'sell', SOTTOPASSAGGIO);
  game.manage(room, p0, 'mortgage', CASE_POPOLARI);
  assert.equal(room.props[CASE_POPOLARI].mortgaged, true);
  assert.throws(
    () => game.manage(room, players[1], 'build', SOTTOPASSAGGIO),
    (e) => e.code === 'NOT_OWNER',
  );
});

test('scambio: proprietà, soldi e carte passano di mano', () => {
  scriptDice();
  ({ room, players } = newGame());
  const [p0, p1] = players;
  give(room, p0, SOTTOPASSAGGIO);
  p1.jailCards = ['chest'];
  game.proposeTrade(room, p0, { to: p1.id, giveProps: [SOTTOPASSAGGIO], getMoney: 100, getCards: 1 });
  game.respondTrade(room, p1, true);
  assert.equal(room.props[SOTTOPASSAGGIO].owner, p1.id);
  assert.equal(p0.money, RULES.START_MONEY + 100);
  assert.deepEqual(p0.jailCards, ['chest']);
  assert.equal(room.trade, null);
});

test("scambio proposto prima del tiro: non si accetta durante l'acquisto, si rifiuta sempre", () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  const [p0, p1] = players;
  give(room, p0, 39);
  game.proposeTrade(room, p0, { to: p1.id, giveProps: [39] });
  game.doRoll(room, p0); // fase buy
  assert.throws(
    () => game.respondTrade(room, p1, true),
    (e) => e.code === 'BAD_PHASE',
  );
  game.respondTrade(room, p1, false);
  assert.equal(room.trade, null);
  assert.equal(room.props[39].owner, p0.id);
});

test('lo scambio deve contenere almeno una proprietà o una carta e solo cose possedute', () => {
  scriptDice();
  ({ room, players } = newGame());
  const [p0, p1] = players;
  assert.throws(() => game.proposeTrade(room, p0, { to: p1.id, giveMoney: 10 }), /almeno una proprietà/);
  assert.throws(() => game.proposeTrade(room, p0, { to: p1.id, giveProps: [39] }), /non appartiene/);
  assert.throws(
    () => game.proposeTrade(room, p1, { to: p0.id, giveProps: [39] }),
    (e) => e.code === 'NOT_YOUR_TURN',
  );
});
