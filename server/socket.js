/**
 * Livello di rete: traduce gli eventi Socket.IO in azioni del motore di gioco.
 * Ogni richiesta del client riceve un ack { ok: true, ... } oppure { ok: false, error, message }.
 * Il server è l'unica autorità: il client invia solo intenzioni ("tira", "compra"…).
 */
import * as game from './game/index.js';
import { addPlayer, createRoom, deleteRoom, findRoom, playerByNick, rooms } from './rooms.js';
import { clientIp, createBucket, ipAllowed } from './limits.js';

const { GameError, fail, playerById, isCurrent, connectedCount, publicState } = game;

/** Collega il motore di gioco e gli handler a un server Socket.IO. */
export function registerSocketHandlers(io) {
  const broadcast = (room) => io.to(room.code).emit('room:state', publicState(room));
  game.setOutput({
    state: broadcast,
    anim: (room, steps) => io.to(room.code).emit('game:anim', { steps }),
  });

  // Troppe connessioni dallo stesso indirizzo: rifiutate prima di arrivare al gioco.
  io.use((socket, next) => {
    if (ipAllowed('connect', clientIp(socket.handshake))) return next();
    next(new Error('Troppe connessioni: riprova tra un minuto.'));
  });

  /** Collega un socket a un giocatore e invia lo stato aggiornato a tutta la stanza. */
  function attach(socket, room, player) {
    // Questo socket occupava un altro posto (es. un'altra stanza): prima lo libero.
    if (socket.data.playerId && socket.data.playerId !== player.id) detach(socket);
    // Stesso giocatore già aperto in un'altra scheda: la vecchia viene avvisata e scollegata.
    const old = player.socketId && player.socketId !== socket.id && io.sockets.sockets.get(player.socketId);
    if (old) {
      old.leave(room.code);
      old.data = {};
      old.emit('session:replaced');
    }
    socket.join(room.code);
    socket.data = { code: room.code, playerId: player.id };
    game.playerConnected(room, player, socket.id);
    // Lo stato parte dopo la risposta (ack), così il client conosce già il proprio id.
    setImmediate(() => broadcast(room));
    return { code: room.code, playerId: player.id, token: player.token, chat: room.chat };
  }

  /** Scollega un socket dal suo giocatore: il posto resta riservato per il rientro. */
  function detach(socket) {
    const room = rooms.get(socket.data.code);
    const player = room && playerById(room, socket.data.playerId);
    socket.data = {};
    if (!player || player.socketId !== socket.id) return;
    socket.leave(room.code);
    game.playerDisconnected(room, player);
    broadcast(room);
  }

  io.on('connection', (socket) => {
    const ip = clientIp(socket.handshake);
    const takeToken = createBucket();

    /** Registra un handler con ack, limite di frequenza e gestione degli errori. */
    const on = (event, fn) =>
      socket.on(event, (payload, cb) => {
        if (typeof payload === 'function') [cb, payload] = [payload, null];
        if (typeof cb !== 'function') cb = () => {};
        if (!payload || typeof payload !== 'object') payload = {};
        if (!takeToken())
          return cb({ ok: false, error: 'RATE_LIMIT', message: 'Troppe richieste: rallenta un attimo.' });
        try {
          cb({ ok: true, ...fn(payload) });
        } catch (e) {
          if (e instanceof GameError) return cb({ ok: false, error: e.code, message: e.message });
          console.error(event, e);
          cb({ ok: false, error: 'SERVER', message: 'Errore del server.' });
        }
      });

    /** Stanza e giocatore associati a questo socket. */
    const ctx = () => {
      const room = rooms.get(socket.data.code);
      const player = room && playerById(room, socket.data.playerId);
      if (!player) fail('ROOM_NOT_FOUND', 'La stanza non esiste più.');
      room.lastActivity = Date.now();
      return { room, player };
    };
    /** Come ctx(), ma richiede che sia il turno del giocatore, in una delle fasi indicate. */
    const myTurn = (...phases) => {
      const c = ctx();
      if (!isCurrent(c.room, c.player)) fail('NOT_YOUR_TURN', 'Non è il tuo turno.');
      if (!phases.includes(c.room.turn.phase)) fail('BAD_PHASE', 'Azione non disponibile adesso.');
      return c;
    };
    /** Esegue un'azione sulla stanza del giocatore e invia il nuovo stato. */
    const act = (getCtx, fn) => {
      const { room, player } = getCtx();
      fn(room, player);
      broadcast(room);
    };
    const limitIp = (kind) => {
      if (!ipAllowed(kind, ip)) fail('RATE_LIMIT', 'Troppi tentativi: riprova tra un minuto.');
    };

    // --- Stanze -------------------------------------------------------------
    on('room:create', ({ nickname }) => {
      limitIp('create');
      const room = createRoom();
      return attach(socket, room, addPlayer(room, nickname));
    });

    on('room:join', ({ code, nickname }) => {
      limitIp('join');
      const room = findRoom(code);
      if (!room) fail('NO_SUCH_ROOM', 'Nessuna stanza con questo codice.');
      // Stesso nickname di un giocatore disconnesso: riprende il suo posto, con soldi e proprietà.
      const same = playerByNick(room, nickname);
      if (same && !same.connected) return attach(socket, room, same);
      if (room.phase === 'playing') {
        fail(
          'GAME_STARTED',
          same
            ? `${same.nickname} risulta ancora collegato. Se sei tu, riprova tra qualche secondo.`
            : 'La partita è già iniziata: puoi rientrare solo con il nickname che avevi.',
        );
      }
      const player = addPlayer(room, nickname);
      game.log(room, `👋 ${player.nickname} è entrato.`);
      return attach(socket, room, player);
    });

    // Rientro dopo disconnessione o ricarica della pagina: stesso posto, stessi soldi.
    on('room:rejoin', ({ code, token }) => {
      limitIp('join');
      const room = findRoom(code);
      if (!room) fail('ROOM_NOT_FOUND', 'Il server si è riavviato oppure la stanza è rimasta inattiva troppo a lungo.');
      const player = room.players.find((p) => p.token === token);
      if (!player) fail('ROOM_NOT_FOUND', 'Non fai più parte di questa stanza.');
      return attach(socket, room, player);
    });

    on('room:leave', () => {
      const { room, player } = ctx();
      socket.leave(room.code);
      socket.data = {};
      game.playerLeft(room, player);
      if (!connectedCount(room)) return deleteRoom(room);
      broadcast(room);
    });

    // --- Partita ------------------------------------------------------------
    on('game:start', () =>
      act(ctx, (room, player) => {
        if (player.id !== room.hostId) fail('NOT_HOST', "Solo l'host può avviare la partita.");
        if (room.phase === 'playing') fail('BAD_PHASE', 'La partita è già in corso.');
        if (connectedCount(room) < 2) fail('NOT_ENOUGH', 'Servono almeno 2 giocatori connessi.');
        game.startGame(room);
      }),
    );
    on('game:roll', () => act(() => myTurn('roll'), game.doRoll));
    on('game:buy', () => act(() => myTurn('buy'), game.doBuy));
    on('game:pass', () => act(() => myTurn('buy'), game.doPass));
    on('game:endTurn', () =>
      act(
        () => myTurn('end'),
        (room) => game.endTurn(room),
      ),
    );
    on('game:payJail', () => act(() => myTurn('roll'), game.payJail));
    on('game:useJailCard', () => act(() => myTurn('roll'), game.useJailCard));
    // Case e ipoteche: nel proprio turno a mossa ferma, oppure per pagare un debito (vedi manageProperty).
    on('game:manage', ({ action, cell }) => act(ctx, (room, p) => game.manageProperty(room, p, action, cell)));

    // --- Scambi -------------------------------------------------------------
    on('trade:propose', (offer) => act(ctx, (room, p) => game.proposeTrade(room, p, offer)));
    on('trade:respond', ({ accept }) => act(ctx, (room, p) => game.respondTrade(room, p, Boolean(accept))));
    on('trade:cancel', () => act(ctx, game.withdrawTrade));

    // --- Aste ---------------------------------------------------------------
    on('auction:bid', ({ amount }) => act(ctx, (room, p) => game.placeBid(room, p, amount)));
    on('auction:pass', () => act(ctx, game.leaveAuction));
    on('auction:murra', () => act(ctx, game.challengeAuctionMurra));

    // --- Murra --------------------------------------------------------------
    on('murra:respond', ({ accept }) => act(ctx, (room, p) => game.respondMurra(room, p, Boolean(accept))));
    on('murra:choose', ({ to }) => act(ctx, (room, p) => game.chooseMurraOpponent(room, p, to)));
    on('murra:skip', () => act(ctx, game.skipMurraChallenge));
    on('murra:play', (move) => act(ctx, (room, p) => game.playMurra(room, p, move)));

    // --- Chat ---------------------------------------------------------------
    on('chat:send', ({ text }) => {
      const { room, player } = ctx();
      io.to(room.code).emit('chat:message', game.addChatMessage(room, player, text));
    });
    on('chat:react', ({ id }) => {
      const { room, player } = ctx();
      io.to(room.code).emit('chat:reaction', game.reaction(player, id));
    });

    socket.on('disconnect', () => detach(socket));
  });

  return { broadcast };
}
