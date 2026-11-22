/**
 * Mazzi Imprevisti (chance) e Probabilità (chest).
 */
import { shuffle } from './random.js';

// Carte scritte dall'autore del gioco, in dialetto. "note" spiega l'effetto in italiano
// (compare sotto il testo della carta); "copies" dice quante volte la carta è nel mazzo.
export const DECKS = {
  chance: {
    title: 'Imprevisti',
    cards: [
      { text: 'Jati alu Via.', note: 'Vai al VIA! e ritira 200 €.', kind: 'goto', to: 0 },
      { text: 'Jati a Piazza Roma.', note: 'Vai a Piazza Roma. Se passi dal VIA! ritiri 200 €.', kind: 'goto', to: 24 },
      { text: 'Jati ala Sisal.', note: 'Vai alla Sisal. Se passi dal VIA! ritiri 200 €.', kind: 'goto', to: 18 },
      { text: 'Chi culu e merda, jati ala Torre e Carlo V.', note: 'Vai alla Torre di Carlo V.', kind: 'goto', to: 39 },
      {
        text: "Jati a Raspa o alu Depuratore, chira cchiù vicina. Però si l'ava ‘ncunu tirati i dadi e li pagati puru ppe deci.",
        note: 'Vai al servizio più vicino (Raspa o Depuratore). Se è di un altro giocatore, tiri i dadi e paghi 10 volte il risultato.',
        kind: 'nearest',
        type: 'utility',
      },
      {
        text: 'Jati fino ala stazione cchiù vicina.',
        note: "Vai alla stazione più vicina. Se è di un altro giocatore, paghi il doppio dell'affitto.",
        kind: 'nearest',
        type: 'station',
        copies: 2,
      },
      {
        text: 'Jati alu Passaggio a livello.',
        note: 'Vai al Passaggio a Livello. Se passi dal VIA! ritiri 200 €.',
        kind: 'goto',
        to: 5,
      },
      { text: 'Chi culu, trovasti $50 supa u lungomare.', note: 'Ritiri 50 €.', kind: 'money', value: 50 },
      {
        text: 'Pijjasti nu bellu gratta vinci alu Bar Charlie, vinciati $150.',
        note: 'Ritiri 150 €.',
        kind: 'money',
        value: 150,
      },
      {
        text: 'Si boi u nesci da prigione a poi usara, sinnò ta stipi.',
        note: 'Tieni questa carta: ti fa uscire di prigione senza pagare. Puoi anche cederla in uno scambio.',
        kind: 'jailfree',
      },
      { text: "Faciti 3 passi all'ambersa.", note: 'Torni indietro di 3 caselle.', kind: 'back', value: 3 },
      {
        text: 'Jati ala caserma e dommu passati do Via.',
        note: 'Vai in prigione, senza passare dal VIA!.',
        kind: 'jail',
      },
      {
        text: 'Pagati $25 pe ogni casa e $100 pe ogni albergo, ti piazza u costruisci ah?',
        note: 'Paghi 25 € per ogni casa e 100 € per ogni albergo.',
        kind: 'repairs',
        house: 25,
        hotel: 100,
      },
      { text: 'Parcheggiasti supa i strisci cunnu, paga $20.', note: 'Paghi 20 €.', kind: 'money', value: -20 },
      {
        text: 'Hai u paghi i debiti chi dassau Gidari, paga $50 a tutti.',
        note: 'Paghi 50 € a ogni giocatore.',
        kind: 'payEach',
        value: 50,
      },
      // Le due sfide a Murra non sono nel documento delle carte: restano dal minigioco.
      {
        text: 'Sfida a Murra a 3 punti!',
        note: 'Scegli un giocatore e sfidalo: vince chi arriva a 3 punti, chi perde dà 150 € a chi vince.',
        kind: 'murra',
        value: 150,
        points: 3,
      },
      {
        text: 'Murra secca!',
        note: 'Scegli un giocatore e sfidalo: vince chi fa il primo punto, chi perde dà 150 € a chi vince.',
        kind: 'murra',
        value: 150,
        points: 1,
      },
    ],
  },
  chest: {
    title: 'Probabilità',
    cards: [
      { text: 'Jati fino alu Via.', note: 'Vai al VIA! e ritira 200 €.', kind: 'goto', to: 0 },
      {
        text: 'Nannata dissa u ti pijji u gelato. Ti dezza $200, ‘nculu.',
        note: 'Ritiri 200 €.',
        kind: 'money',
        value: 200,
      },
      { text: "Hai u paghi a visita e l'ospedale, paga $50.", note: 'Paghi 50 €.', kind: 'money', value: -50 },
      { text: 'Stasira fatigasti ala discoteca, ti facisti $60.', note: 'Ritiri 60 €.', kind: 'money', value: 60 },
      {
        text: 'Si boi u nesci da prigione a poi usara, sinnò ta stipi.',
        note: 'Tieni questa carta: ti fa uscire di prigione senza pagare. Puoi anche cederla in uno scambio.',
        kind: 'jailfree',
      },
      { text: 'Jati ala caserma.', note: 'Vai in prigione, senza passare dal VIA!.', kind: 'jail' },
      { text: "Facisti u PR alu Mama's, pijjati $100.", note: 'Ritiri 100 €.', kind: 'money', value: 100 },
      {
        text: "Facisti u tavulu alu Mama's sabato, paghi $25.",
        note: 'Paghi 25 €.',
        kind: 'money',
        value: -25,
        copies: 2,
      },
      {
        text: 'Auguri po compleanno, fatti dara $10 da busta.',
        note: 'Ogni giocatore ti dà 10 €.',
        kind: 'collectEach',
        value: 10,
      },
      { text: 'Chi culu e merda, trovasti $100 supa u corsu.', note: 'Ritiri 100 €.', kind: 'money', value: 100 },
      {
        text: 'Offristi nu burdellu e cocktail stasira, paga $100.',
        note: 'Paghi 100 €.',
        kind: 'money',
        value: -100,
        copies: 2,
      },
      {
        text: 'Accattasti nu gratta e vinci ma perdisti cunnu, paga $20.',
        note: 'Paghi 20 €.',
        kind: 'money',
        value: -20,
        copies: 2,
      },
    ],
  },
};

/**
 * Mazzo mescolato. La carta "esci di prigione" resta fuori finché un giocatore la tiene in mano
 * (ogni giocatore conserva il nome del mazzo da cui viene la sua carta).
 */
export function newDeck(players, deckName) {
  const held = players.some((p) => p.jailCards.includes(deckName));
  const cards = DECKS[deckName].cards.flatMap((c) => Array(c.copies || 1).fill(c));
  return shuffle(cards.filter((c) => c.kind !== 'jailfree' || !held));
}
