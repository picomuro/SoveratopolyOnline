/**
 * Simulazione di una partita completa con client Socket.IO finti (bot).
 *
 * Avvia il server vero in questo processo su una porta libera, collega N bot che giocano
 * fino alla fine (comprano, vanno all'asta, sfidano a Murra, scambiano, costruiscono)
 * e controlla a ogni stato che non ci siano incoerenze o errori del server.
 *
 * Uso: npm run simulate -- [giocatori=4] [secondi massimi=90]
 */
import { pathToFileURL } from 'node:url';
import { io as connect } from 'socket.io-client';
import { BOARD_SIZE, CELLS, MAX_FINGERS, auctionStart, groupOf, houseCost } from '../shared/board-data.js';
import { startServer } from '../server/index.js';

const POLL_MS = 40;
const rnd = (n) => Math.floor(Math.random() * n);

/** Invia un evento e attende la risposta; ripete dopo una pausa se il server chiede di rallentare. */
function emit(socket, event, payload = {}) {
  return new Promise((resolve) => {
    const go = () =>
      socket.emit(event, payload, (res) => {
        if (res?.error === 'RATE_LIMIT' && /Troppe richieste/.test(res.message)) setTimeout(go, 150);
        else resolve(res);
      });
    go();
  });
}

/** Incoerenze che non devono mai comparire nello stato inviato ai client. */
function checkState(st) {
  const problems = [];
  if (st.players.some((p) => p.money < 0)) problems.push('saldo negativo');
  if (st.players.some((p) => p.pos < 0 || p.pos >= BOARD_SIZE)) problems.push('posizione fuori dal tabellone');
  if (st.phase === 'playing') {
    const phase = st.turn.phase;
    if (Boolean(st.murra) !== (phase === 'murra')) problems.push(`Murra e fase "${phase}" non coincidono`);
    if (st.auction && !['auction', 'murra'].includes(phase)) problems.push(`asta in fase "${phase}"`);
    if (!st.auction && phase === 'auction') problems.push('fase asta senza asta');
    if (st.players.find((p) => p.id === st.turn.playerId).bankrupt) problems.push('turno a un giocatore in bancarotta');
  }
  for (const [i, pr] of Object.entries(st.props)) {
    if (pr.houses && pr.mortgaged) problems.push(`case su una proprietà ipotecata (${CELLS[i].name})`);
    if (pr.owner && !st.players.some((p) => p.id === pr.owner && !p.bankrupt))
      problems.push('proprietario fuori gioco');
  }
  return problems;
}

/** Sceglie l'azione di un bot guardando l'ultimo stato ricevuto. Ritorna [evento, dati] o null. */
function decide(bot, st) {
  const me = st.players.find((p) => p.id === bot.id);
  if (!me || me.bankrupt || st.phase !== 'playing') return null;
  if (st.trade?.to === me.id) return ['trade:respond', { accept: Math.random() < 0.6 }];

  const m = st.murra;
  if (m) {
    if (m.stage === 'choose' && m.a === me.id) {
      if (m.kind === 'parking' && Math.random() < 0.5) return ['murra:skip'];
      const others = st.players.filter((p) => !p.bankrupt && p.id !== me.id);
      return ['murra:choose', { to: others[rnd(others.length)].id }];
    }
    if (m.stage === 'offer' && m.b === me.id) return ['murra:respond', { accept: Math.random() < 0.7 }];
    if (m.stage === 'play' && [m.a, m.b].includes(me.id) && !m.picked.includes(me.id)) {
      const fingers = 1 + rnd(MAX_FINGERS);
      return ['murra:play', { fingers, guess: fingers + 1 + rnd(MAX_FINGERS), round: m.round }];
    }
    return null;
  }

  const a = st.auction;
  if (a) {
    if (a.passed.includes(me.id) || a.bidderId === me.id) return null;
    const key = `${a.cell}:${a.bid}`;
    if (a.challengerId === me.id && !bot.challenged.has(key)) {
      bot.challenged.add(key);
      return ['auction:murra'];
    }
    const next = a.bidderId ? a.bid + 10 : auctionStart(a.cell);
    const limit = Math.min(me.money - 50, CELLS[a.cell].price * bot.greed);
    return next <= limit ? ['auction:bid', { amount: next }] : ['auction:pass'];
  }

  if (st.turn.playerId !== me.id || st.trade) return null;
  const { phase, pendingBuy } = st.turn;
  if (phase === 'roll') {
    if (me.inJail && me.jailCards) return ['game:useJailCard'];
    if (me.inJail && me.money > 400 && Math.random() < 0.5) return ['game:payJail'];
    return ['game:roll'];
  }
  if (phase === 'buy') {
    const price = CELLS[pendingBuy].price;
    return me.money >= price && Math.random() < 0.75 ? ['game:buy'] : ['game:pass'];
  }
  if (phase !== 'end') return null;

  const mine = Object.keys(st.props)
    .map(Number)
    .filter((i) => st.props[i].owner === me.id);
  // Riscatta le ipoteche se avanza denaro, costruisce sui gruppi completi.
  const mortgaged = mine.find((i) => st.props[i].mortgaged && me.money > CELLS[i].price);
  if (mortgaged !== undefined) return ['game:manage', { action: 'unmortgage', cell: mortgaged }];
  const buildable = mine.find((i) => {
    const group = groupOf(i);
    return (
      CELLS[i].type === 'prop' &&
      group.every((c) => st.props[c].owner === me.id && !st.props[c].mortgaged) &&
      st.props[i].houses < 5 &&
      st.props[i].houses === Math.min(...group.map((c) => st.props[c].houses)) &&
      me.money > houseCost(i) + 300
    );
  });
  if (buildable !== undefined && !bot.tried.has(`b${st.turn.deadline}:${buildable}`)) {
    bot.tried.add(`b${st.turn.deadline}:${buildable}`);
    return ['game:manage', { action: 'build', cell: buildable }];
  }
  // Una volta per turno prova a completare un gruppo comprando la proprietà che manca.
  const tradeKey = `t${st.turn.deadline}`;
  if (!bot.tried.has(tradeKey)) {
    bot.tried.add(tradeKey);
    for (const i of mine) {
      const missing = groupOf(i).find((c) => st.props[c].owner && st.props[c].owner !== me.id);
      const owner = missing !== undefined && st.players.find((p) => p.id === st.props[missing].owner);
      const offer = missing !== undefined && CELLS[missing].price * 2;
      if (owner && !owner.bankrupt && me.money > offer) {
        return ['trade:propose', { to: owner.id, getProps: [missing], giveMoney: offer }];
      }
    }
  }
  return ['game:endTurn'];
}

/**
 * Gioca una partita completa. Ritorna { finished, winner, actions, seconds, problems, serverErrors }.
 */
export async function runSimulation({ players = 4, maxSeconds = 90, log = () => {} } = {}) {
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${server.port}`;
  const bots = [];
  const problems = new Set();
  const serverErrors = [];
  let actions = 0;
  let finished = null;
  const started = Date.now();

  try {
    let code;
    for (let k = 0; k < players; k++) {
      const socket = connect(url, { forceNew: true, reconnection: false, transports: ['websocket'] });
      await new Promise((r) => socket.on('connect', r));
      const bot = { socket, state: null, busy: false, tried: new Set(), challenged: new Set(), greed: 0.5 + k * 0.1 };
      socket.on('room:state', (st) => {
        bot.state = st;
        for (const p of checkState(st)) problems.add(p);
        if (st.phase === 'finished') finished ??= st;
      });
      const res =
        k === 0
          ? await emit(socket, 'room:create', { nickname: `Bot${k}` })
          : await emit(socket, 'room:join', { code, nickname: `Bot${k}` });
      code = res.code;
      bot.id = res.playerId;
      bots.push(bot);
    }
    await emit(bots[0].socket, 'game:start');
    log(`Stanza ${code}: partita con ${players} bot`);

    // Ogni bot guarda il suo ultimo stato a intervalli regolari e fa una sola richiesta alla volta.
    while (!finished && Date.now() - started < maxSeconds * 1000) {
      for (const bot of bots) {
        if (bot.busy || !bot.state) continue;
        const action = decide(bot, bot.state);
        if (!action) continue;
        bot.busy = true;
        actions++;
        emit(bot.socket, action[0], action[1]).then((res) => {
          if (res?.error === 'SERVER') serverErrors.push(`${action[0]}: ${res.message}`);
          bot.busy = false;
        });
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally {
    for (const bot of bots) bot.socket.disconnect();
    await server.close();
  }

  const winner = finished?.players.find((p) => p.id === finished.winnerId);
  return {
    finished: Boolean(finished),
    winner: winner?.nickname ?? null,
    actions,
    seconds: Math.round((Date.now() - started) / 1000),
    problems: [...problems],
    serverErrors,
  };
}

// Avvio da riga di comando.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const players = Number(process.argv[2]) || 4;
  const maxSeconds = Number(process.argv[3]) || 90;
  const result = await runSimulation({ players, maxSeconds, log: console.log });
  console.log(
    result.finished
      ? `Partita finita in ${result.seconds} s e ${result.actions} azioni: vince ${result.winner}.`
      : `Partita non finita entro ${maxSeconds} s (${result.actions} azioni).`,
  );
  for (const p of result.problems) console.log(`INCOERENZA: ${p}`);
  for (const e of result.serverErrors) console.log(`ERRORE DEL SERVER: ${e}`);
  process.exit(result.problems.length || result.serverErrors.length ? 1 : 0);
}
