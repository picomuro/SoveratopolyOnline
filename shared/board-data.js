/**
 * Dati e formule condivisi di Soveratopoly.
 * Modulo ES caricato sia dal server (import) sia dal browser (<script type="module">):
 * caselle, prezzi, affitti e reazioni sono definiti in un solo posto.
 *
 * Le caselle sono 40, numerate da 0 (VIA!) in senso orario:
 *   0-10  riga in basso (da destra verso sinistra)
 *   10-20 colonna sinistra (dal basso verso l'alto)
 *   20-30 riga in alto (da sinistra verso destra)
 *   30-39 colonna destra (dall'alto verso il basso)
 */
// Gruppi di colore: colore della fascia sul tabellone e costo di una casa.
export const GROUPS = {
  brown: { name: 'Marroni', color: '#8f5e4a', house: 50 },
  lightblue: { name: 'Azzurre', color: '#9fe8f5', house: 50 },
  pink: { name: 'Rosa', color: '#ff6ac8', house: 100 },
  orange: { name: 'Arancioni', color: '#ff9a50', house: 100 },
  red: { name: 'Rosse', color: '#f02020', house: 150 },
  yellow: { name: 'Gialle', color: '#ffd84a', house: 150 },
  green: { name: 'Verdi', color: '#00b860', house: 200 },
  blue: { name: 'Blu', color: '#0047ab', house: 200 },
};

// type: go | prop | station | utility | tax | chance | chest | jail | parking | gotojail
export const CELLS = [
  { name: 'VIA!', type: 'go' },
  { name: 'Case Popolari', type: 'prop', group: 'brown', price: 60 },
  { name: 'Probabilità', type: 'chest' },
  { name: 'Sottopassaggio', type: 'prop', group: 'brown', price: 60 },
  { name: 'Mazzo di rose di Rosario', type: 'tax', amount: 200 },
  { name: 'Passaggio a Livello', type: 'station', price: 200 },
  { name: 'Salesiani', type: 'prop', group: 'lightblue', price: 100 },
  { name: 'Imprevisti', type: 'chance' },
  { name: 'Geometra', type: 'prop', group: 'lightblue', price: 100 },
  { name: 'Via Carlo Amirante', type: 'prop', group: 'lightblue', price: 120 },

  { name: 'Prigione / Transito', type: 'jail' },
  { name: '10 Bis', type: 'prop', group: 'pink', price: 140 },
  { name: 'Raspa Elettrodomestici', type: 'utility', price: 150 },
  { name: 'Lo Spuntino Calabrese', type: 'prop', group: 'pink', price: 140 },
  { name: 'Tano', type: 'prop', group: 'pink', price: 160 },
  { name: 'Stazione degli Autobus', type: 'station', price: 200 },
  { name: 'Piazza delle Banane', type: 'prop', group: 'orange', price: 180 },
  { name: 'Probabilità', type: 'chest' },
  { name: 'Sisal', type: 'prop', group: 'orange', price: 180 },
  { name: 'Ippica', type: 'prop', group: 'orange', price: 200 },

  { name: 'Parcheggio Gratuito', type: 'parking' },
  { name: 'Piazza Maria Ausiliatrice', type: 'prop', group: 'red', price: 220 },
  { name: 'Imprevisti', type: 'chance' },
  { name: 'Oratorio', type: 'prop', group: 'red', price: 220 },
  { name: 'Piazza Roma', type: 'prop', group: 'red', price: 240 },
  { name: 'Stazione dei Treni', type: 'station', price: 200 },
  { name: 'Miramare', type: 'prop', group: 'yellow', price: 260 },
  { name: 'Giardinetti', type: 'prop', group: 'yellow', price: 260 },
  { name: 'Depuratore', type: 'utility', price: 150 },
  { name: 'Loft', type: 'prop', group: 'yellow', price: 280 },

  { name: 'In Prigione!', type: 'gotojail' },
  { name: 'Corso Umberto I', type: 'prop', group: 'green', price: 300 },
  { name: 'Lungomare', type: 'prop', group: 'green', price: 300 },
  { name: 'Probabilità', type: 'chest' },
  { name: 'Morè', type: 'prop', group: 'green', price: 320 },
  { name: 'Marcello', type: 'station', price: 200 },
  { name: 'Imprevisti', type: 'chance' },
  { name: 'Villa Ersilia', type: 'prop', group: 'blue', price: 350 },
  { name: 'Posto di Blocco', type: 'tax', amount: 100 },
  { name: 'Torre di Carlo V', type: 'prop', group: 'blue', price: 400 },
];

// Regole economiche (nostre, ispirate ai classici giochi di proprietà).
export const RULES = {
  START_MONEY: 1500,
  GO_SALARY: 200,
  JAIL_FINE: 50,
  JAIL_CELL: 10,
  BASE_RENT_RATE: 0.08, // affitto base = 8% del prezzo
  FULL_GROUP_MULT: 2, // gruppo completo, senza case
  HOUSE_MULT: [0, 4, 11, 28, 36, 45], // indice = numero di case (5 = albergo)
  STATION_RENT: [0, 25, 50, 100, 200], // per numero di "stazioni" possedute
  UTILITY_MULT: [0, 4, 10], // dadi x 4 (una) o x 10 (entrambe)
  MAX_HOUSES: 5,
  MURRA_POINTS: 3, // la Murra si vince a 3 punti...
  MURRA_AUCTION_POINTS: 1, // ...ma nelle aste basta il primo punto, per non rallentare il gioco
  PARKING_MURRA_STAKE: 150, // posta della sfida lanciata dal Parcheggio Gratuito
  MAX_PLAYERS: 8,
  AUCTION_MIN_STEP: 10, // rilancio minimo in un'asta
  CHAT_MAX_LENGTH: 120,
};

// Reazioni della chat rapida: il client invia solo l'indice.
export const REACTIONS = ['👍', '😂', '😱', '🔥', '😭', '🎉', '😎', '🤑', '💸', '🙏', '👏', '🍦'];

// Murra: le dita che si possono mostrare (indice + 1 = numero di dita).
// Non esiste un'emoji con 4 dita esatte: accanto all'emoji compare sempre il numero.
export const FINGERS = ['☝️', '✌️', '🤟', '🖖', '🖐️'];

// Indici delle caselle per gruppo, calcolati una volta sola.
const byGroup = {};
CELLS.forEach((c, i) => {
  if (c.group) (byGroup[c.group] = byGroup[c.group] || []).push(i);
});

export const euro = (n) => `${n} €`;
export const isBuyable = (i) => ['prop', 'station', 'utility'].includes(CELLS[i]?.type);
/** Caselle dello stesso gruppo di colore (per stazioni e servizi: solo la casella stessa). */
export const groupOf = (i) => (CELLS[i].group ? byGroup[CELLS[i].group] : [i]);
export const colorOf = (i) => (CELLS[i].group ? GROUPS[CELLS[i].group].color : '#9aa0b5');
const baseRent = (i) => Math.round(CELLS[i].price * RULES.BASE_RENT_RATE);
/** Affitto di una via, in base alle case e al gruppo completo. */
export const propRent = (i, houses, fullGroup) =>
  baseRent(i) * (houses > 0 ? RULES.HOUSE_MULT[houses] : fullGroup ? RULES.FULL_GROUP_MULT : 1);
export const houseCost = (i) => (CELLS[i].group ? GROUPS[CELLS[i].group].house : 0);
export const houseSellValue = (i) => Math.floor(houseCost(i) / 2);
export const mortgageValue = (i) => Math.floor(CELLS[i].price / 2);
export const unmortgageCost = (i) => Math.ceil(mortgageValue(i) * 1.1);
/** Base d'asta: la prima offerta deve valere almeno metà del prezzo di listino. */
export const auctionStart = (i) => Math.floor(CELLS[i].price / 2);

// Bordi delle caselle sull'immagine del tabellone, in % (misurati sul PDF originale).
// 12 valori: bordo esterno, fine angolo, 9 caselle, fine angolo, bordo esterno.
export const BOUNDS = [1.2, 14.74, 22.4, 30.37, 38.1, 45.89, 53.69, 61.52, 69.28, 77.28, 85.08, 98.45];

/** Numero di caselle del tabellone. */
export const BOARD_SIZE = CELLS.length;
/** Murra: quante dita si possono mostrare al massimo (le somme vanno da 2 a 2 × MAX_FINGERS). */
export const MAX_FINGERS = FINGERS.length;
