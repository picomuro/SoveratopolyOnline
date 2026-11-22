/**
 * Casualità del gioco: dadi, mazzi, scelte automatiche.
 * Usa crypto.randomInt (imprevedibile per i client); i test possono sostituirla con setRandom.
 */
import crypto from 'node:crypto';

/** randomInt(min, max): intero in [min, max). */
let randomInt = (min, max) => crypto.randomInt(min, max);

/** Sostituisce il generatore (solo test e strumenti di sviluppo). Senza argomenti torna a crypto. */
export function setRandom(fn) {
  randomInt = fn || ((min, max) => crypto.randomInt(min, max));
}

/** Intero in [min, max). */
export const randInt = (min, max) => randomInt(min, max);

/** Un dado a sei facce. */
export const die = () => randomInt(1, 7);

/** Elemento a caso di un array non vuoto. */
export const pick = (arr) => arr[randomInt(0, arr.length)];

/** Copia mescolata (Fisher-Yates). */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
