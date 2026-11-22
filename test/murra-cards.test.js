/** Carte Imprevisti/Probabilità, Parcheggio Gratuito e Murra. */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../shared/board-data.js';
import * as game from '../server/game/index.js';
import { DECKS, newDeck } from '../server/game/decks.js';
import { MURRA_PICK_MS, OFFLINE_MURRA_MS } from '../server/config.js';
import { captureOutput, closeRoom, give, newGame, scriptDice } from './helpers.js';

const PARKING = 20;
const IMPREVISTI = 7;
const card = (deck, text) => DECKS[deck].cards.find((c) => c.text.startsWith(text));

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

/** P0 arriva su `cell` con un tiro 1+2 (pescando `nextCard` se è una casella carta). */
function landOn(cell, nextCard) {
  if (nextCard) room.decks[nextCard.deck] = [nextCard.card];
  players[0].pos = cell - 3;
  game.doRoll(room, players[0]);
}

/** Mano di Murra: [dita, somma] per a e per b. */
function hand(m, pickA, pickB) {
  const pa = players.find((p) => p.id === m.a);
  const pb = players.find((p) => p.id === m.b);
  game.playMurra(room, pa, { fingers: pickA[0], guess: pickA[1], round: m.round });
  game.playMurra(room, pb, { fingers: pickB[0], guess: pickB[1], round: m.round });
}

test('carta "vai a": si avanza ritirando i 200 € del VIA! e si applica la casella', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  landOn(IMPREVISTI, { deck: 'chance', card: card('chance', 'Jati a Piazza Roma') });
  assert.equal(players[0].pos, 24);
  assert.equal(room.turn.pendingBuy, 24);
  assert.ok(room.anims.some((s) => s.t === 'card' && s.deck === 'chance'));
});

test('carta "stazione più vicina": affitto doppio', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  give(room, players[1], 15);
  landOn(IMPREVISTI, { deck: 'chance', card: card('chance', 'Jati fino ala stazione') });
  assert.equal(players[0].pos, 15);
  assert.equal(players[0].money, RULES.START_MONEY - 2 * RULES.STATION_RENT[1]);
});

test('carta "paga a tutti": 50 € a ogni altro giocatore', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame(3));
  landOn(IMPREVISTI, { deck: 'chance', card: card('chance', 'Hai u paghi i debiti') });
  assert.equal(players[0].money, RULES.START_MONEY - 100);
  assert.equal(players[1].money, RULES.START_MONEY + 50);
});

test('carta "esci di prigione": resta in mano e non torna nel mazzo finché è tenuta', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame());
  landOn(IMPREVISTI, { deck: 'chance', card: card('chance', 'Si boi u nesci') });
  assert.deepEqual(players[0].jailCards, ['chance']);
  const jailfree = (deck) => deck.filter((c) => c.kind === 'jailfree').length;
  assert.equal(jailfree(newDeck(room.players, 'chance')), 0, 'mazzo rimescolato senza la carta tenuta');
  assert.equal(jailfree(newDeck(room.players, 'chest')), 1, "l'altro mazzo conserva la sua");
  players[0].jailCards = [];
  assert.equal(jailfree(newDeck(room.players, 'chance')), 1, 'usata la carta, torna nel mazzo');
});

test('i mazzi contengono le carte del documento con le copie indicate', () => {
  scriptDice();
  ({ room, players } = newGame());
  assert.equal(newDeck(room.players, 'chance').length, 18);
  assert.equal(newDeck(room.players, 'chest').length, 15);
  for (const deck of ['chance', 'chest']) for (const c of DECKS[deck].cards) assert.ok(c.text && c.note && c.kind);
});

test("Parcheggio Gratuito: chi arriva sceglie l'avversario (o rinuncia), che non può rifiutare", () => {
  scriptDice([1, 2, 1, 2]);
  ({ room, players } = newGame(3));
  const [p0, , p2] = players;
  landOn(PARKING);
  let m = room.murra;
  assert.equal(room.turn.phase, 'murra');
  assert.deepEqual(
    [m.kind, m.stage, m.goal, m.stake],
    ['parking', 'choose', RULES.MURRA_POINTS, RULES.PARKING_MURRA_STAKE],
  );
  assert.throws(() => game.chooseMurraOpponent(room, p2, p0.id), /Non tocca a te/);
  game.skipMurraChallenge(room, p0);
  assert.equal(room.murra, null);
  assert.equal(room.turn.phase, 'end');

  room.turn.phase = 'roll';
  landOn(PARKING);
  game.chooseMurraOpponent(room, p0, p2.id);
  m = room.murra;
  assert.equal(m.stage, 'play');
  assert.throws(() => game.respondMurra(room, p2, false), /Nessuna sfida/);
});

test('Murra: punto solo a chi indovina da solo; a 3 punti chi perde paga la posta', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame(2));
  const [p0, p1] = players;
  landOn(PARKING);
  game.chooseMurraOpponent(room, p0, p1.id);
  const m = room.murra;
  hand(m, [1, 5], [1, 6]); // somma 2: nessuno indovina
  hand(m, [1, 2], [1, 2]); // somma 2: entrambi, nessun punto
  assert.deepEqual([m.score[p0.id], m.score[p1.id]], [0, 0]);
  hand(m, [2, 5], [3, 6]); // somma 5: punto a p0 (andarci vicino non conta)
  hand(m, [2, 5], [3, 6]);
  assert.equal(room.murra, m, 'a 2 punti la sfida continua');
  hand(m, [2, 5], [3, 6]);
  assert.equal(room.murra, null);
  assert.equal(p0.money, RULES.START_MONEY + RULES.PARKING_MURRA_STAKE);
  assert.equal(p1.money, RULES.START_MONEY - RULES.PARKING_MURRA_STAKE);
  const last = room.anims.filter((s) => s.t === 'murra').pop();
  assert.equal(last.winnerId, p0.id);
});

test('Murra: le giocate fuori mano o non valide sono rifiutate', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame(2));
  const [p0, p1] = players;
  landOn(PARKING);
  game.chooseMurraOpponent(room, p0, p1.id);
  assert.throws(() => game.playMurra(room, p0, { fingers: 1, guess: 2 }), /già finita/);
  assert.throws(() => game.playMurra(room, p0, { fingers: 6, guess: 7, round: 1 }), /Mostra da 1/);
  assert.throws(() => game.playMurra(room, p0, { fingers: 1, guess: 11, round: 1 }), /somma da 2/);
  game.playMurra(room, p0, { fingers: 1, guess: 2, round: 1 });
  assert.throws(() => game.playMurra(room, p0, { fingers: 1, guess: 2, round: 1 }), /già giocato/);
});

test('carte Murra: "a 3 punti" e "secca" (un punto); con un solo avversario la scelta è automatica', () => {
  scriptDice([1, 2, 1, 2]);
  ({ room, players } = newGame(2));
  landOn(IMPREVISTI, { deck: 'chance', card: card('chance', 'Murra secca') });
  let m = room.murra;
  assert.deepEqual([m.kind, m.goal, m.stage, m.b], ['card', 1, 'play', players[1].id]);
  hand(m, [2, 5], [3, 6]);
  assert.equal(room.murra, null, 'Murra secca: basta un punto');

  room.turn.phase = 'roll';
  landOn(IMPREVISTI, { deck: 'chance', card: card('chance', 'Sfida a Murra a 3 punti') });
  m = room.murra;
  assert.equal(m.goal, 3);
});

test("Murra nell'asta: va accettata, vince al primo punto e chi vince compra all'offerta", () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame(2));
  const [p0, p1] = players;
  game.doRoll(room, p0);
  game.doPass(room, p0);
  game.placeBid(room, p1, 30);
  assert.equal(game.murraChallenger(room), p0.id);
  game.challengeAuctionMurra(room, p0);
  assert.equal(room.murra.stage, 'offer');
  assert.throws(() => game.placeBid(room, p1, 100), /Murra in corso/);
  game.respondMurra(room, p1, false);
  assert.equal(room.murra, null);
  assert.equal(game.murraChallenger(room), null, 'dopo il rifiuto non si ripropone sulla stessa offerta');

  game.placeBid(room, p0, 40);
  game.challengeAuctionMurra(room, p1);
  game.respondMurra(room, p0, true);
  const m = room.murra;
  assert.equal(m.goal, RULES.MURRA_AUCTION_POINTS);
  hand(m, [2, 5], [3, 6]); // punto a chi ha lanciato la sfida (p1)
  assert.equal(room.props[3].owner, p1.id);
  assert.equal(p1.money, RULES.START_MONEY - 40);
});

test('Murra: chi non gioca in tempo gioca a caso; due mani senza giocate chiudono la sfida', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame(2));
  const [p0, p1] = players;
  landOn(PARKING);
  game.chooseMurraOpponent(room, p0, p1.id);
  mock.timers.tick(MURRA_PICK_MS);
  mock.timers.tick(MURRA_PICK_MS);
  assert.equal(room.murra, null);
  assert.ok(room.log.some((l) => l.includes('chiusa in anticipo')));
});

test('Murra: chi deve giocare si scollega e dopo pochi secondi il server gioca per lui', () => {
  scriptDice([1, 2]);
  ({ room, players } = newGame(2));
  const [p0, p1] = players;
  landOn(PARKING);
  game.chooseMurraOpponent(room, p0, p1.id);
  const m = room.murra;
  game.playMurra(room, p0, { fingers: 1, guess: 2, round: 1 });
  game.playerDisconnected(room, p1);
  mock.timers.tick(OFFLINE_MURRA_MS);
  assert.ok(m.round > 1 || room.murra === null);
});
