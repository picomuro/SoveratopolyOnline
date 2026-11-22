/**
 * Motore di gioco: regole pure su un oggetto stanza, senza rete.
 * Le uscite verso i client passano da output.js (setOutput).
 */
export { GameError, fail } from './errors.js';
export { setOutput } from './output.js';
export { setRandom } from './random.js';
export {
  newRoomState,
  freshStats,
  publicState,
  playerById,
  current,
  alive,
  connectedCount,
  isCurrent,
  fixHost,
  log,
} from './state.js';
export { startGame, endTurn } from './turns.js';
export { doRoll, doBuy, payJail, useJailCard, calcRent } from './board.js';
export { pay, bankrupt } from './money.js';
export { doPass, placeBid, leaveAuction, challengeAuctionMurra, murraChallenger } from './auction.js';
export { respondMurra, chooseMurraOpponent, skipMurraChallenge, playMurra } from './murra.js';
export { proposeTrade, respondTrade, withdrawTrade, cancelTrade } from './trade.js';
export { manage } from './properties.js';
export { addChatMessage, reaction, cleanChat } from './chat.js';
export { playerConnected, playerDisconnected, playerLeft } from './presence.js';
