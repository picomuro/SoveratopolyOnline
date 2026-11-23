/** Pagamenti non coperti dai contanti: debito in sospeso, tempo fermo, ipoteche e scambi per pagare. */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, RULES, mortgageValue, propRent } from '../shared/board-data.js';
import * as game from '../server/game/index.js';
import { MOVE_MS, OFFLINE_DEBT_MS } from '../server/config.js';
import { captureOutput, closeRoom, give, newGame, scriptDice } from './helpers.js';

const SOTTOPASSAGGIO = 3;
const ROSE = 4; // tassa da 200 €
const VILLA_ERSILIA = 37;
const TORRE = 39;

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

/** P0 senza contanti, con la Torre di Carlo V (ipoteca 200 €), arriva sulla tassa da 200 €. */
function broke() {
  scriptDice([1, 3]);
  ({ room, players } = newGame());
  give(room, players[0], TORRE);
  players[0].money = 0;
  game.doRoll(room, players[0]); // 0 + 4 = Mazzo di rose di Rosario
}

test("affitto pagato con i contanti: chi paga riceve l'avviso", () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  give(room, players[1], SOTTOPASSAGGIO);
  game.doRoll(room, players[0]);
  const rent = propRent(SOTTOPASSAGGIO, 0, false);
  assert.deepEqual(
    room.anims.find((a) => a.t === 'rent'),
    { t: 'rent', playerId: players[0].id, ownerId: players[1].id, cell: SOTTOPASSAGGIO, amount: rent },
  );
  assert.equal(players[1].money, RULES.START_MONEY + rent);
  assert.equal(room.turn.phase, 'end');
});

test('contanti insufficienti ma ipoteche sufficienti: niente ipoteca automatica, il tempo si ferma', () => {
  broke();
  const [p0] = players;
  assert.equal(room.turn.phase, 'debt');
  assert.deepEqual(room.debts, [{ playerId: p0.id, to: null, amount: 200, reason: CELLS[ROSE].name }]);
  assert.equal(room.props[TORRE].mortgaged, false, 'nessuna ipoteca fatta dal server');
  assert.equal(room.turn.deadline, 0);
  mock.timers.tick(MOVE_MS * 3);
  assert.equal(room.turn.phase, 'debt', 'il tempo resta fermo finché il giocatore è collegato');
  assert.equal(p0.bankrupt, false);
  assert.ok(room.anims.every((a) => a.t !== 'rent'));
});

test('durante il debito si può solo ipotecare o vendere; ipotecando si paga e il turno riprende', () => {
  broke();
  const [p0, p1] = players;
  assert.throws(() => game.manageProperty(room, p1, 'mortgage', TORRE), /debito/);
  assert.throws(() => game.manageProperty(room, p0, 'unmortgage', TORRE), /ipotecare o vendere/);
  game.manageProperty(room, p0, 'mortgage', TORRE);
  assert.equal(room.debts.length, 0);
  assert.equal(p0.money, mortgageValue(TORRE) - 200);
  assert.equal(room.turn.phase, 'end');
  assert.ok(room.turn.deadline > Date.now(), 'il tempo del turno riparte');
});

test('durante il debito chi deve pagare può fare soldi con uno scambio', () => {
  broke();
  const [p0, p1] = players;
  game.proposeTrade(room, p0, { to: p1.id, giveProps: [TORRE], getMoney: 300 });
  game.respondTrade(room, p1, true);
  assert.equal(room.props[TORRE].owner, p1.id);
  assert.equal(p0.money, 100);
  assert.equal(room.debts.length, 0);
  assert.equal(room.turn.phase, 'end');
});

test('chi cede in uno scambio quello che gli serviva per pagare va in bancarotta', () => {
  broke();
  const [p0, p1] = players;
  game.proposeTrade(room, p0, { to: p1.id, giveProps: [TORRE] });
  game.respondTrade(room, p1, true);
  assert.equal(p0.bankrupt, true);
  assert.equal(room.phase, 'finished');
  assert.equal(room.winnerId, p1.id);
});

test('debito verso un giocatore: i soldi arrivano a lui solo quando il debito è pagato', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  const [p0, p1] = players;
  give(room, p1, SOTTOPASSAGGIO);
  give(room, p0, VILLA_ERSILIA);
  p0.money = 2;
  game.doRoll(room, p0);
  assert.equal(room.turn.phase, 'debt');
  assert.equal(p1.money, RULES.START_MONEY);
  game.manageProperty(room, p0, 'mortgage', VILLA_ERSILIA);
  assert.equal(p1.money, RULES.START_MONEY + propRent(SOTTOPASSAGGIO, 0, false));
});

test('debitore scollegato: dopo pochi secondi il server ipoteca al posto suo e il gioco riprende', () => {
  broke();
  const [p0] = players;
  game.playerDisconnected(room, p0);
  mock.timers.tick(OFFLINE_DEBT_MS);
  assert.equal(room.props[TORRE].mortgaged, true);
  assert.equal(room.debts.length, 0);
  assert.equal(room.turn.phase, 'end');
});

test('debitore che rientra in tempo: niente ipoteca automatica', () => {
  broke();
  const [p0] = players;
  game.playerDisconnected(room, p0);
  game.playerConnected(room, p0, 'socket-0b');
  mock.timers.tick(OFFLINE_DEBT_MS * 2);
  assert.equal(room.props[TORRE].mortgaged, false);
  assert.equal(room.turn.phase, 'debt');
});

test('in bancarotta si possono ancora usare chat e reazioni', () => {
  broke();
  const [p0] = players;
  game.bankrupt(room, p0, null);
  assert.equal(game.addChatMessage(room, p0, 'ciao').text, 'ciao');
  assert.equal(game.reaction(p0, 0).playerId, p0.id);
});
