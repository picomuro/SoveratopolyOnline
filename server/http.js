/**
 * Server HTTP: file statici del client, dati condivisi, health check, header di sicurezza.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Codice sempre rivalidato (dopo un deploy client e server restano allineati), immagini in cache un giorno. */
const cacheHeaders = (res, file) =>
  res.setHeader('Cache-Control', /[\\/]img[\\/]/.test(file) ? 'public, max-age=86400' : 'no-cache');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // La CSP ammette solo risorse proprie, più il font di Google Fonts;
  // gli stili inline servono per colori e posizioni calcolati dal client.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'frame-ancestors': ["'self'"],
          'upgrade-insecure-requests': null, // Render serve già in HTTPS; in locale si usa HTTP
        },
      },
    }),
  );
  app.use(compression()); // gzip per HTML, CSS e JS: su rete mobile si sente
  app.get('/health', (_req, res) => res.status(200).send('ok')); // health check di Render
  app.use('/shared', express.static(path.join(root, 'shared'), { setHeaders: cacheHeaders }));
  app.use(express.static(path.join(root, 'public'), { setHeaders: cacheHeaders }));
  return app;
}
