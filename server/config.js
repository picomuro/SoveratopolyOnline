/**
 * Configurazione del server: variabili d'ambiente, tempi e limiti.
 * Le regole economiche del gioco (soldi, affitti, Murra…) stanno in shared/board-data.js.
 */

const env = process.env;

// --- Ambiente ---------------------------------------------------------------
export const PORT = Number(env.PORT) || 3000;
export const HOST = env.HOST || '0.0.0.0';
/** Origini (oltre a quella del sito stesso) da cui si accettano connessioni Socket.IO. */
export const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// --- Stanze -----------------------------------------------------------------
export const MAX_ROOMS = 300; // protezione della memoria sul piano gratuito
export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // niente I e O per evitare confusione
export const CODE_LENGTH = 4;
export const NICK_MAX = 14;
export const PAWN_COLORS = ['#ff3b6b', '#2f80ff', '#22c55e', '#ffb000', '#a855f7', '#00c2c7', '#92400e', '#334155'];
export const LOG_KEEP = 60; // righe di cronologia conservate
export const LOG_SENT = 40; // righe inviate ai client
export const CHAT_HISTORY = 40; // messaggi conservati per chi entra o rientra

// --- Tempi (ms) ---------------------------------------------------------------
export const MOVE_MS = 2 * 60 * 1000; // tempo massimo per ogni mossa: tirare, decidere un acquisto, chiudere il turno
/** Se chi deve muovere è disconnesso, il server aspetta molto meno prima di giocare al posto suo. */
export const OFFLINE_MOVE_MS = { roll: 15000, buy: 8000, end: 4000 };
export const TRADE_MS = 45000; // tempo per rispondere a uno scambio
export const AUCTION_START_MS = 15000; // tempo per la prima offerta di un'asta
export const AUCTION_BID_MS = 10000; // dopo ogni rilancio il tempo riparte da qui
export const MURRA_CHOOSE_MS = 20000; // tempo per scegliere chi sfidare a Murra
export const MURRA_OFFER_MS = 15000; // tempo per accettare una sfida a Murra in un'asta
export const MURRA_PICK_MS = 20000; // tempo per scegliere dita e somma
export const OFFLINE_MURRA_MS = 5000; // Murra: chi deve decidere ed è scollegato da 5 s viene sostituito dal server
export const OFFLINE_LOG_MS = 5000; // disconnessioni più brevi (es. ricarica della pagina) non finiscono in cronologia
export const HOST_GRACE_MS = 10000; // l'host che ricarica la pagina non perde il ruolo
export const LOBBY_GHOST_MS = 60 * 1000; // in sala d'attesa un disconnesso viene rimosso dopo 60 s
export const ROOM_EMPTY_MS = 5 * 60 * 1000; // stanza eliminata dopo 5 min con tutti disconnessi
export const ROOM_IDLE_MS = 30 * 60 * 1000; // ...o dopo 30 min senza attività
export const CLEANUP_EVERY_MS = 30 * 1000;
export const CHAT_COOLDOWN_MS = 1500; // un messaggio ogni 1,5 s per giocatore
export const REACTION_COOLDOWN_MS = 800;

// --- Regole di turno --------------------------------------------------------
export const JAIL_MAX_TRIES = 3;
export const MAX_DOUBLES = 3; // al terzo doppio di fila si va in prigione
export const MAX_CARD_CHAIN = 2; // una carta può portare su un'altra casella "carta": al massimo due di fila
export const MURRA_MAX_ROUNDS = 30; // oltre 30 mani la sfida viene chiusa: vince chi è avanti
export const MURRA_MAX_IDLE = 2; // ...e così dopo 2 mani in cui nessuno dei due ha giocato

// --- Limiti anti-abuso ------------------------------------------------------
export const MAX_MESSAGE_BYTES = 16 * 1024; // nessun evento del gioco supera pochi KB
export const EVENT_BURST = 20; // eventi consecutivi ammessi da una connessione...
export const EVENT_RATE = 10; // ...che poi si ricaricano a 10 al secondo
export const IP_WINDOW_MS = 60 * 1000;
export const IP_LIMITS = { connect: 40, create: 20, join: 60 }; // per indirizzo IP, ogni minuto
