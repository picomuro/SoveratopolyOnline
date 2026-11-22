/**
 * Murra: minigioco a due. A ogni mano ognuno mostra da 1 a 5 dita e dichiara la somma
 * delle due mani (2-10). Chi indovina la somma fa un punto (se indovinano entrambi, o nessuno,
 * il punto non viene assegnato). Vince chi arriva a `goal` punti.
 *
 * Si gioca in tre casi (kind):
 *  - 'auction': in un'asta rimasta a due, il rivale sfida chi ha fatto l'offerta.
 *               Lo sfidato può accettare o rifiutare; chi vince compra al prezzo offerto. Basta un punto.
 *  - 'card':    carta Imprevisti: si sceglie un avversario, che non può rifiutare (3 punti o 1, secondo la carta).
 *  - 'parking': chi arriva sul Parcheggio Gratuito può sfidare un giocatore (o rinunciare);
 *               lo sfidato non può rifiutare. In questi due casi chi perde paga la posta.
 *
 * Fasi (stage): 'choose' = chi lancia sceglie l'avversario, 'offer' = lo sfidato decide
 * se accettare, 'play' = si giocano le mani.
 */
import { MAX_FINGERS, RULES, euro } from '../../shared/board-data.js';
import {
  AUCTION_BID_MS,
  MURRA_CHOOSE_MS,
  MURRA_MAX_IDLE,
  MURRA_MAX_ROUNDS,
  MURRA_OFFER_MS,
  MURRA_PICK_MS,
  OFFLINE_MURRA_MS,
} from '../config.js';
import { fail } from './errors.js';
import { emitAnim, later } from './output.js';
import { pick, randInt } from './random.js';
import { alive, log, playerById } from './state.js';
import { finishAction } from './turns.js';
import { armAuction, endAuction } from './auction.js';
import { pay } from './money.js';

const STAGE_MS = { choose: MURRA_CHOOSE_MS, offer: MURRA_OFFER_MS, play: MURRA_PICK_MS };

/** a = chi lancia la sfida, b = lo sfidato (null finché non viene scelto). */
export const newMurra = (
  kind,
  a,
  b,
  stake = 0,
  goal = kind === 'auction' ? RULES.MURRA_AUCTION_POINTS : RULES.MURRA_POINTS,
) => ({
  kind,
  stake,
  a,
  b,
  stage: kind === 'auction' ? 'offer' : 'choose',
  goal, // punti per vincere
  picks: {}, // playerId -> { fingers, guess } della mano in corso
  round: 1,
  score: {},
  idle: 0, // mani consecutive in cui nessuno dei due ha giocato
});

/** Giocata casuale per chi non sceglie in tempo (o è scollegato): sempre una somma possibile. */
const randomMurraPick = () => {
  const fingers = randInt(1, MAX_FINGERS + 1);
  return { fingers, guess: fingers + randInt(1, MAX_FINGERS + 1) };
};

/** Mette il turno in fase "murra" e avvia la prima fase della sfida. */
export function beginMurra(room) {
  const m = room.murra;
  room.turn.phase = 'murra';
  // Carta Imprevisti con un solo avversario possibile: la scelta è obbligata.
  const others = alive(room).filter((p) => p.id !== m.a);
  if (m.kind === 'card' && others.length === 1) return setMurraOpponent(room, others[0]);
  armMurra(room);
}

/** Sfida da carta o da parcheggio: l'avversario scelto non può rifiutare. */
function setMurraOpponent(room, opponent) {
  const m = room.murra;
  m.b = opponent.id;
  log(
    room,
    `🤜 ${playerById(room, m.a).nickname} sfida ${opponent.nickname} a Murra: chi perde dà ${euro(m.stake)} a chi vince!`,
  );
  startMurraPlay(room);
}

function startMurraPlay(room) {
  const m = room.murra;
  m.stage = 'play';
  m.score = { [m.a]: 0, [m.b]: 0 };
  armMurra(room);
}

/** Avvia il conto alla rovescia della fase corrente della Murra. */
function armMurra(room) {
  clearTimeout(room.timer);
  const m = room.murra;
  const connected = (id) => playerById(room, id).connected;
  // Chi deve decidere ma è disconnesso non blocca la partita: vale come tempo scaduto.
  if ((m.stage === 'offer' && !connected(m.b)) || (m.stage === 'choose' && !connected(m.a))) return murraTimeout(room);
  if (m.stage === 'play') {
    // Chi è disconnesso gioca a caso, così la sfida non resta ferma.
    const absent = [m.a, m.b].filter((id) => !m.picks[id] && !connected(id));
    for (const id of absent) m.picks[id] = randomMurraPick();
    if (m.picks[m.a] && m.picks[m.b]) {
      if (absent.length === 2) m.idle++;
      return resolveMurraRound(room);
    }
  }
  const ms = STAGE_MS[m.stage];
  room.turn.deadline = Date.now() + ms;
  room.timer = later(room, ms, () => {
    if (room.murra === m) murraTimeout(room);
  });
}

/** Tempo scaduto: il server decide al posto di chi non l'ha fatto. */
function murraTimeout(room) {
  const m = room.murra;
  if (m.stage === 'offer') return refuseMurra(room);
  if (m.stage === 'choose') {
    if (m.kind === 'parking') return skipMurra(room); // sfida facoltativa: senza scelta non si gioca
    return setMurraOpponent(room, pick(alive(room).filter((p) => p.id !== m.a)));
  }
  if (!Object.keys(m.picks).length) m.idle++; // nessuno dei due ha giocato
  for (const id of [m.a, m.b]) m.picks[id] ??= randomMurraPick();
  resolveMurraRound(room);
}

/**
 * Chi deve decidere nella Murra si è scollegato: se non torna entro OFFLINE_MURRA_MS
 * il server decide subito per lui, invece di far aspettare tutti fino allo scadere del tempo.
 */
export function watchMurraAbsence(room, p) {
  const m = room.murra;
  const { stage, round } = m;
  const decides =
    (stage === 'offer' && m.b === p.id) ||
    (stage === 'choose' && m.a === p.id) ||
    (stage === 'play' && [m.a, m.b].includes(p.id) && !m.picks[p.id]);
  if (!decides) return;
  later(room, OFFLINE_MURRA_MS, () => {
    if (room.murra !== m || m.stage !== stage || m.round !== round || p.connected) return;
    if (stage !== 'play') return murraTimeout(room);
    m.picks[p.id] ??= randomMurraPick();
    if (m.picks[m.a] && m.picks[m.b]) resolveMurraRound(room);
  });
}

/** Asta: lo sfidato rifiuta (o non risponde). L'asta riprende e la sfida non si può riproporre sulla stessa offerta. */
function refuseMurra(room) {
  const m = room.murra;
  room.murra = null;
  room.auction.murraRefused = true;
  log(room, `🙅 ${playerById(room, m.b).nickname} rifiuta la sfida a Murra: l'asta continua.`);
  room.turn.phase = 'auction';
  armAuction(room, AUCTION_BID_MS);
}

/** Parcheggio Gratuito: chi poteva sfidare rinuncia. */
function skipMurra(room) {
  const m = room.murra;
  room.murra = null;
  log(room, `🅿️ ${playerById(room, m.a).nickname} non sfida nessuno.`);
  finishAction(room);
}

/** Entrambi hanno giocato: rivela le mani, assegna l'eventuale punto e controlla se qualcuno ha vinto. */
function resolveMurraRound(room) {
  const m = room.murra;
  const [pa, pb] = [m.picks[m.a], m.picks[m.b]];
  const [na, nb] = [playerById(room, m.a).nickname, playerById(room, m.b).nickname];
  const sum = pa.fingers + pb.fingers;
  const [hitA, hitB] = [pa.guess === sum, pb.guess === sum];
  const scorerId = hitA === hitB ? null : hitA ? m.a : m.b; // entrambi o nessuno: niente punto
  if (scorerId) m.score[scorerId]++;
  const [sa, sb] = [m.score[m.a], m.score[m.b]];

  let winnerId = sa >= m.goal ? m.a : sb >= m.goal ? m.b : null;
  // Sfida troppo lunga, o giocatori assenti: vince chi è avanti; a pari punti decide la sorte.
  const cutShort = !winnerId && (m.round >= MURRA_MAX_ROUNDS || m.idle >= MURRA_MAX_IDLE);
  if (cutShort) winnerId = sa > sb ? m.a : sb > sa ? m.b : pick([m.a, m.b]);

  emitAnim(room, [
    {
      t: 'murra',
      a: { id: m.a, ...pa },
      b: { id: m.b, ...pb },
      sum,
      scorerId,
      score: { ...m.score },
      goal: m.goal,
      winnerId,
      cutShort,
    },
  ]);
  const outcome = scorerId
    ? `punto a ${scorerId === m.a ? na : nb}`
    : hitA
      ? 'indovinano entrambi, nessun punto'
      : 'nessun punto';
  log(
    room,
    `🤜 Murra: ${na} mostra ${pa.fingers} e dice ${pa.guess}, ${nb} mostra ${pb.fingers} e dice ${pb.guess}. Somma ${sum}: ${outcome} (${sa}-${sb}).`,
  );

  if (winnerId) return finishMurra(room, winnerId, cutShort);
  m.round++;
  m.picks = {};
  armMurra(room);
}

function finishMurra(room, winnerId, cutShort = false) {
  clearTimeout(room.timer);
  const m = room.murra;
  room.murra = null;
  const winner = playerById(room, winnerId);
  const loser = playerById(room, winnerId === m.a ? m.b : m.a);
  log(
    room,
    `🏆 ${winner.nickname} vince la Murra contro ${loser.nickname} ${m.score[winner.id]}-${m.score[loser.id]}${cutShort ? ' (sfida chiusa in anticipo)' : ''}.`,
  );
  if (m.kind === 'auction') {
    room.auction.bidderId = winner.id; // chi vince la sfida si aggiudica l'asta al prezzo dell'offerta in corso
    return endAuction(room);
  }
  pay(room, loser, winner, m.stake, 'la Murra');
  finishAction(room);
}

/** Un giocatore della sfida ha lasciato la partita: la Murra salta e il gioco riprende. */
export function cancelMurra(room) {
  room.murra = null;
  log(room, '🤜 Murra annullata.');
  if (!room.auction) return finishAction(room);
  room.turn.phase = 'auction';
  armAuction(room, AUCTION_BID_MS);
}

// --- Azioni dei giocatori ------------------------------------------------------

function currentMurra(room) {
  if (!room.murra) fail('BAD', 'Nessuna Murra in corso.');
  return room.murra;
}

/** Asta: lo sfidato accetta o rifiuta la sfida. */
export function respondMurra(room, p, accept) {
  const m = currentMurra(room);
  if (m.stage !== 'offer' || m.b !== p.id) fail('BAD', 'Nessuna sfida a cui rispondere.');
  if (!accept) return refuseMurra(room);
  log(room, `🤜 ${p.nickname} accetta la sfida a Murra!`);
  startMurraPlay(room);
}

/** Carta Imprevisti o Parcheggio Gratuito: chi lancia la sfida sceglie l'avversario. */
export function chooseMurraOpponent(room, p, opponentId) {
  const m = currentMurra(room);
  if (m.stage !== 'choose' || m.a !== p.id) fail('BAD', 'Non tocca a te scegliere.');
  const opponent = playerById(room, String(opponentId));
  if (!opponent || opponent.bankrupt || opponent.id === p.id) fail('BAD', 'Scegli un giocatore ancora in gioco.');
  setMurraOpponent(room, opponent);
}

/** Parcheggio Gratuito: la sfida è facoltativa. */
export function skipMurraChallenge(room, p) {
  const m = currentMurra(room);
  if (m.stage !== 'choose' || m.kind !== 'parking' || m.a !== p.id) fail('BAD', 'Non puoi rinunciare a questa sfida.');
  skipMurra(room);
}

/** Giocata: quante dita mostro (1-5) e quale somma dichiaro (2-10), per la mano indicata. */
export function playMurra(room, p, { fingers, guess, round }) {
  const m = currentMurra(room);
  if (m.stage !== 'play' || ![m.a, m.b].includes(p.id)) fail('BAD', 'Non stai giocando questa Murra.');
  // Una giocata arrivata in ritardo non deve finire nella mano successiva.
  if (Number(round) !== m.round) fail('BAD', 'Questa mano è già finita.');
  if (m.picks[p.id]) fail('BAD', "Hai già giocato: aspetta l'avversario.");
  const [f, g] = [Number(fingers), Number(guess)];
  if (!Number.isInteger(f) || f < 1 || f > MAX_FINGERS) fail('BAD', `Mostra da 1 a ${MAX_FINGERS} dita.`);
  if (!Number.isInteger(g) || g < 2 || g > 2 * MAX_FINGERS)
    fail('BAD', `Dichiara una somma da 2 a ${2 * MAX_FINGERS}.`);
  m.picks[p.id] = { fingers: f, guess: g };
  if (m.picks[m.a] && m.picks[m.b]) resolveMurraRound(room);
}
