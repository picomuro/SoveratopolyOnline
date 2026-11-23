/**
 * Soveratopoly — client.
 * Il client non decide nulla: invia intenzioni al server ("tira", "compra"...)
 * e mostra lo stato che riceve, animando dadi e pedine.
 *
 * Questo modulo collega tutto all'avvio e gestisce la coda degli aggiornamenti.
 */
import { initModal } from './dom.js';
import { initNet, socket } from './net.js';
import { applyState, initScreens } from './screens.js';
import { initDice, playAnim, showSkippedNotices } from './board.js';
import { initPanels } from './panels.js';
import { initChat, showReaction } from './chat.js';

// ------------------------------------------------------------------------
// Coda: animazioni e stati vengono mostrati nell'ordine in cui arrivano.
// ------------------------------------------------------------------------
const queue = [];
let running = false;
let waitingAnims = 0; // animazioni ancora in coda dietro quella in corso

async function runQueue() {
  if (running) return;
  running = true;
  while (queue.length) {
    try {
      await queue.shift()();
    } catch (e) {
      console.error(e);
    }
  }
  running = false;
}

initModal();
initDice();
initPanels();
initChat();
initScreens();
initNet();

// La coda parte con setTimeout: se la risposta a "crea/entra" e il primo stato arrivano
// nello stesso pacchetto, la sessione viene salvata prima di elaborare lo stato.
socket.on('room:state', (s) => {
  queue.push(() => applyState(s));
  setTimeout(runQueue);
});
socket.on('game:anim', (a) => {
  waitingAnims++;
  queue.push(() => {
    waitingAnims--;
    // Scheda in background o animazioni arretrate: si salta direttamente allo stato finale.
    if (document.hidden || waitingAnims > 0) return showSkippedNotices(a.steps);
    return playAnim(a.steps);
  });
  setTimeout(runQueue);
});
socket.on('chat:reaction', showReaction);
