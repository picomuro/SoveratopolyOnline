/**
 * Soveratopoly — avvio del server multiplayer.
 * Express serve i file statici, Socket.IO gestisce le partite.
 * Tutto lo stato è in memoria: un riavvio cancella le stanze.
 *
 * `node server/index.js` avvia il server; test e simulazioni usano startServer() con una porta a scelta.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { ALLOWED_ORIGINS, CLEANUP_EVERY_MS, HOST, MAX_MESSAGE_BYTES, PORT } from './config.js';
import { createApp } from './http.js';
import { registerSocketHandlers } from './socket.js';
import { cleanupRooms, deleteRoom, rooms } from './rooms.js';
import { sweepIpHits } from './limits.js';

/** Solo pagine dello stesso sito (o di ALLOWED_ORIGINS). I client senza Origin (script, test) passano. */
function allowRequest(req, cb) {
  const { origin } = req.headers;
  let sameSite = false;
  try {
    sameSite = new URL(origin).host === req.headers.host;
  } catch {
    /* origine assente o non valida */
  }
  cb(null, !origin || sameSite || ALLOWED_ORIGINS.includes(origin));
}

/**
 * Avvia HTTP + Socket.IO. Ritorna una promessa con { port, io, close }.
 * port = 0 sceglie una porta libera (utile nei test).
 */
export function startServer({ port = PORT, host = HOST } = {}) {
  const server = http.createServer(createApp());
  const io = new Server(server, {
    pingInterval: 20000,
    pingTimeout: 20000,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    allowRequest,
  });
  const { broadcast } = registerSocketHandlers(io);

  // Pulizia periodica: posti abbandonati in sala d'attesa, stanze vuote o inattive, contatori anti-abuso.
  const cleanup = setInterval(() => {
    sweepIpHits();
    for (const room of cleanupRooms()) broadcast(room);
  }, CLEANUP_EVERY_MS);
  cleanup.unref();

  const close = () =>
    new Promise((resolve) => {
      clearInterval(cleanup);
      for (const room of rooms.values()) deleteRoom(room);
      io.close(() => resolve());
    });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ port: server.address().port, io, close }));
  });
}

// Avvio da riga di comando (npm start).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port, close } = await startServer();
  console.log(`Soveratopoly in ascolto su http://${HOST}:${port}`);
  // Render manda SIGTERM a ogni deploy: chiude le connessioni in modo ordinato (le partite in memoria si perdono comunque).
  const shutdown = (signal) => {
    console.log(`${signal}: chiusura del server`);
    close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
