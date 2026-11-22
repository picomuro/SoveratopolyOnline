/** Errore "previsto" di un'azione di gioco: diventa una risposta { ok: false, error, message } al client. */
export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Interrompe l'azione corrente con un errore da mostrare al giocatore. */
export const fail = (code, message) => {
  throw new GameError(code, message);
};
