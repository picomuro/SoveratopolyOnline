/**
 * Test di integrazione: server vero su una porta libera e client Socket.IO finti.
 * Controllano permessi, stanze, rientro e una partita completa.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/index.js';
import { runSimulation } from '../scripts/simulate.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${server.port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
});

/** Client finto: ricorda l'ultimo stato ricevuto. */
async function client(headers = {}) {
  const s = connect(url, { forceNew: true, reconnection: false, transports: ['websocket'], extraHeaders: headers });
  sockets.push(s);
  s.on('room:state', (st) => {
    s.last = st;
  });
  await new Promise((resolve, reject) => {
    s.on('connect', resolve);
    s.on('connect_error', reject);
  });
  return s;
}
const emit = (s, event, payload = {}) => new Promise((resolve) => s.emit(event, payload, resolve));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('health check e header di sicurezza', async () => {
  const res = await fetch(`${url}/health`);
  assert.equal(res.status, 200);
  const page = await fetch(url);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const shared = await fetch(`${url}/shared/board-data.js`);
  assert.equal(shared.status, 200);
});

test("stanza: creazione, ingresso, nickname ripulito, solo l'host avvia", async () => {
  const a = await client();
  const b = await client();
  const ra = await emit(a, 'room:create', { nickname: '<b>Anna</b>' });
  assert.ok(ra.ok && /^[A-Z]{4}$/.test(ra.code));
  const rb = await emit(b, 'room:join', { code: ` ${ra.code.toLowerCase()} `, nickname: 'Bruno' });
  assert.ok(rb.ok);
  await wait(50);
  assert.deepEqual(
    a.last.players.map((p) => p.nickname),
    ['bAnna/b', 'Bruno'],
  );
  assert.equal((await emit(b, 'game:start')).error, 'NOT_HOST');
  assert.ok((await emit(a, 'game:start')).ok);
  await wait(50);
  assert.equal(a.last.phase, 'playing');
  assert.ok(!JSON.stringify(a.last).includes(ra.token), 'il token non viene mai inviato agli altri');
});

test("il server è l'unica autorità: fuori turno, fuori fase o fuori stanza si viene rifiutati", async () => {
  const a = await client();
  const b = await client();
  const ra = await emit(a, 'room:create', { nickname: 'A' });
  await emit(b, 'room:join', { code: ra.code, nickname: 'B' });
  await emit(a, 'game:start');
  await wait(50);
  const [cur, other] = a.last.turn.playerId === ra.playerId ? [a, b] : [b, a];
  assert.equal((await emit(other, 'game:roll')).error, 'NOT_YOUR_TURN');
  assert.equal((await emit(cur, 'game:buy')).error, 'BAD_PHASE');
  assert.equal((await emit(cur, 'game:endTurn')).error, 'BAD_PHASE');
  const outsider = await client();
  assert.equal((await emit(outsider, 'game:roll')).error, 'ROOM_NOT_FOUND');
  assert.equal((await emit(outsider, 'room:join', { code: 'ZZZZ', nickname: 'X' })).error, 'NO_SUCH_ROOM');
  // Payload strani non fanno cadere nulla
  assert.equal((await emit(cur, 'game:manage', { action: 'build', cell: 'x' })).error, 'NOT_OWNER');
  assert.equal((await emit(cur, 'auction:bid', { amount: '1e9' })).ok, false);
});

test('rientro: con il token, oppure da un altro dispositivo con lo stesso nickname', async () => {
  const a = await client();
  const b = await client();
  const ra = await emit(a, 'room:create', { nickname: 'Anna' });
  const rb = await emit(b, 'room:join', { code: ra.code, nickname: 'Bruno' });
  await emit(a, 'game:start');
  b.disconnect();
  await wait(50);
  const b2 = await client();
  const again = await emit(b2, 'room:join', { code: ra.code, nickname: 'bruno' });
  assert.equal(again.playerId, rb.playerId);
  assert.equal((await emit(await client(), 'room:join', { code: ra.code, nickname: 'Anna' })).error, 'GAME_STARTED');
  b2.disconnect();
  await wait(50);
  const b3 = await client();
  assert.equal((await emit(b3, 'room:rejoin', { code: ra.code, token: rb.token })).playerId, rb.playerId);
});

test('limite di frequenza per connessione', async () => {
  const s = await client({ 'x-forwarded-for': '203.0.113.7' });
  const replies = await Promise.all(Array.from({ length: 40 }, () => emit(s, 'game:roll')));
  assert.ok(replies.filter((r) => r.error === 'RATE_LIMIT').length >= 15);
});

test('partita completa tra 3 bot, senza incoerenze né errori del server', { timeout: 120000 }, async () => {
  const result = await runSimulation({ players: 3, maxSeconds: 100 });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.serverErrors, []);
  assert.ok(result.finished, `partita non finita in ${result.seconds} s`);
});
