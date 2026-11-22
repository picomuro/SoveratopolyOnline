/** Dadi, movimento, prigione, turni e tempo scaduto. */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../shared/board-data.js';
import * as game from '../server/game/index.js';
import { MOVE_MS } from '../server/config.js';
import { captureOutput, closeRoom, newGame, scriptDice } from './helpers.js';

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

test('la partita parte con 1500 € a testa, tutti sul VIA!, P0 di turno in fase roll', () => {
  scriptDice();
  ({ room, players } = newGame(3));
  assert.equal(room.phase, 'playing');
  assert.deepEqual(
    players.map((p) => [p.money, p.pos]),
    players.map(() => [RULES.START_MONEY, 0]),
  );
  assert.equal(game.current(room), players[0]);
  assert.equal(room.turn.phase, 'roll');
});

test("il tiro muove la pedina casella per casella e propone l'acquisto", () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  game.doRoll(room, players[0]);
  assert.equal(players[0].pos, 3); // Sottopassaggio
  assert.equal(room.turn.phase, 'buy');
  assert.equal(room.turn.pendingBuy, 3);
  assert.deepEqual(room.anims[0], { t: 'dice', dice: [1, 2] });
  assert.deepEqual(room.anims[1], { t: 'move', playerId: players[0].id, path: [1, 2, 3] });
});

test('passando dal VIA! si ritirano 200 €', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  players[0].pos = 38;
  game.doRoll(room, players[0]);
  assert.equal(players[0].pos, 1);
  assert.equal(players[0].money, RULES.START_MONEY + RULES.GO_SALARY);
});

test('tre doppi di fila: prigione, senza muoversi al terzo tiro', () => {
  scriptDice([3, 3, 4, 4, 2, 2]);
  ({ room, players } = newGame());
  const p = players[0];
  // Le caselle 6 (Salesiani) e 14 (Tano) sono proprietà: si rinuncia all'acquisto e l'asta va deserta.
  for (let k = 0; k < 2; k++) {
    game.doRoll(room, p);
    assert.equal(room.turn.phase, 'buy');
    game.doPass(room, p);
    for (const q of players) game.leaveAuction(room, q);
    assert.equal(room.turn.phase, 'roll', 'dopo un doppio si tira ancora');
  }
  game.doRoll(room, p);
  assert.equal(p.inJail, true);
  assert.equal(p.pos, RULES.JAIL_CELL);
  assert.equal(room.turn.phase, 'end');
});

test('in prigione: senza doppio si resta, al terzo tentativo si paga la cauzione e si esce', () => {
  scriptDice([1, 2, 1, 2, 1, 3]);
  ({ room, players } = newGame());
  const p = players[0];
  Object.assign(p, { inJail: true, pos: RULES.JAIL_CELL });
  for (let k = 1; k <= 2; k++) {
    game.doRoll(room, p);
    assert.equal(p.inJail, true);
    assert.equal(p.jailTurns, k);
    room.turn.phase = 'roll'; // stesso giocatore, turno successivo
  }
  game.doRoll(room, p); // 1 + 3 = 4: paga e si muove fino a Tano (14)
  assert.equal(p.inJail, false);
  assert.equal(p.pos, 14);
  assert.equal(p.money, RULES.START_MONEY - RULES.JAIL_FINE);
});

test('pagare la cauzione o usare la carta fa uscire di prigione prima di tirare', () => {
  scriptDice();
  ({ room, players } = newGame());
  const [p] = players;
  Object.assign(p, { inJail: true, pos: RULES.JAIL_CELL });
  game.payJail(room, p);
  assert.equal(p.inJail, false);
  assert.equal(p.money, RULES.START_MONEY - RULES.JAIL_FINE);
  Object.assign(p, { inJail: true, jailCards: ['chance'] });
  game.useJailCard(room, p);
  assert.equal(p.inJail, false);
  assert.equal(p.jailCards.length, 0);
  assert.throws(() => game.useJailCard(room, p), game.GameError);
});

test('fine turno: tocca al prossimo giocatore ancora in gioco', () => {
  scriptDice();
  ({ room, players } = newGame(3));
  players[1].bankrupt = true;
  game.endTurn(room);
  assert.equal(game.current(room), players[2]);
  game.endTurn(room);
  assert.equal(game.current(room), players[0]);
});

test('tempo scaduto: il server tira al posto del giocatore', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  mock.timers.tick(MOVE_MS);
  assert.equal(players[0].pos, 3);
  assert.equal(room.turn.phase, 'buy');
  assert.ok(room.log.some((l) => l.includes('Tempo scaduto')));
});

test('giocatore di turno disconnesso: il server aspetta pochi secondi', () => {
  scriptDice();
  ({ room, players } = newGame());
  game.playerDisconnected(room, players[0]);
  assert.ok(room.turn.deadline - Date.now() <= 15000);
});
