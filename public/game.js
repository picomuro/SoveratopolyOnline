/**
 * Soveratopoly — client.
 * Il client non decide nulla: invia intenzioni al server ("tira", "compra"...)
 * e mostra lo stato che riceve, animando dadi e pedine.
 */
(() => {
  const { CELLS, RULES, BOUNDS: BD, REACTIONS, FINGERS, euro, ...S } = window.SOVERATO;
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------------
  // Sessione salvata nel browser: permette di rientrare nello stesso posto.
  // ------------------------------------------------------------------------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage non disponibile */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };
  let session = store.get('sov_session'); // { code, token, playerId }
  const setSession = (s) => { session = s; store.set('sov_session', s); };
  const clearSession = () => { session = null; store.del('sov_session'); };

  // Un link di invito a un'altra stanza vince sulla sessione salvata.
  const urlCode = (new URLSearchParams(location.search).get('r') || '').toUpperCase().slice(0, 4);
  if (urlCode && session && session.code !== urlCode) clearSession();

  let state = null;        // ultimo stato ricevuto dal server
  let clockOffset = 0;     // differenza orologio server/client per i countdown
  let replaced = false;    // la partita è stata aperta in un'altra scheda
  const shown = {};        // casella su cui è disegnata ogni pedina (può precedere lo stato durante le animazioni)
  const shownJail = {};    // la pedina è disegnata dentro la prigione?

  const meId = () => session?.playerId;
  const pl = (id) => state.players.find((p) => p.id === id);
  const isMyTurn = () => state?.phase === 'playing' && state.turn.playerId === meId();
  /** Case, ipoteche e scambi: solo nel proprio turno, non durante un acquisto o un'asta. */
  const canManage = () => isMyTurn() && ['roll', 'end'].includes(state.turn.phase);
  const propsOf = (id) => Object.keys(state.props).map(Number).filter((i) => state.props[i].owner === id);
  const groupHasHouses = (i) => S.groupOf(i).some((c) => state.props[c].houses > 0);

  // ------------------------------------------------------------------------
  // Connessione con retry progressivo (1 s → 10 s, all'infinito).
  // Stessa origine: nessun indirizzo scritto a mano.
  // ------------------------------------------------------------------------
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.4,
    timeout: 20000,
  });
  let everConnected = false;

  function showWake(text, sub = '') {
    $('#wake-text').textContent = text;
    $('#wake-sub').textContent = sub;
    $('#wake').classList.add('show');
  }

  socket.on('connect', () => {
    everConnected = true;
    $('#wake').classList.remove('show');
    if (session && !replaced) rejoin(); // una scheda sostituita non si riprende il posto da sola
  });
  socket.on('disconnect', () => showWake('Connessione persa, mi riconnetto…'));
  socket.on('connect_error', () => {
    if (!everConnected) showWake('Sto svegliando il server, attendi qualche secondo…',
      'Il server gratuito si addormenta dopo 15 minuti: può volerci fino a un minuto.');
  });
  socket.io.on('reconnect_attempt', (n) => { $('#wake-sub').textContent = `Tentativo ${n}…`; });

  /**
   * Invia un'azione al server e attende la risposta.
   * Ritorna la risposta, oppure null in caso di errore (già mostrato all'utente, salvo quiet).
   */
  function send(event, payload = {}, { quiet = false } = {}) {
    if (replaced && event !== 'room:rejoin') { showReplaced(); return Promise.resolve(null); }
    return new Promise((resolve) => {
      socket.timeout(10000).emit(event, payload, (err, res) => {
        if (!err && res.ok) return resolve(res);
        if (!quiet) {
          if (err) toast('Il server non risponde, riprova.');
          else if (res.error === 'ROOM_NOT_FOUND') roomGone(res.message);
          else toast(res.message || 'Errore');
        }
        resolve(null);
      });
    });
  }

  async function rejoin() {
    replaced = false;
    const res = await send('room:rejoin', { code: session.code, token: session.token });
    if (res) setChat(res.chat);
  }

  /** Crea una stanza o entra in una esistente. */
  let entering = false;
  async function enter(event, payload) {
    if (entering) return; // evita doppi clic
    entering = true;
    const res = await send(event, payload);
    entering = false;
    if (!res) return;
    setSession({ code: res.code, token: res.token, playerId: res.playerId });
    setChat(res.chat);
    history.replaceState(null, '', `?r=${res.code}`);
  }

  function backToLobby() {
    clearSession();
    state = null;
    setChat([]);
    history.replaceState(null, '', location.pathname);
    $('#victory').classList.remove('show');
    showScreen('lobby');
  }

  /** La stanza non esiste più (riavvio del server, stanza scaduta, posto perso). */
  function roomGone(message) {
    const code = session?.code || '';
    backToLobby();
    openModal(`
      <div class="big-emoji">😴</div>
      <h2>La stanza ${esc(code)} non è più disponibile</h2>
      <p>${esc(message)}</p>
      <button class="btn btn-big btn-pink" id="m-new">✨ Crea una nuova stanza</button>
      <button class="btn btn-ghost" data-close>Torna alla home</button>`);
    $('#m-new').onclick = () => { closeModal(); createRoom(); };
  }

  /** Lo stesso giocatore ha aperto la partita in un'altra scheda: questa si ferma. */
  function showReplaced() {
    openModal(`
      <div class="big-emoji">🪟</div>
      <h2>Partita aperta in un'altra scheda</h2>
      <p>Puoi continuare lì, oppure riprendere a giocare qui.</p>
      <button class="btn btn-big btn-blue" id="m-here">Gioca qui</button>`);
    $('#m-here').onclick = () => { closeModal(); rejoin(); };
  }
  socket.on('session:replaced', () => { replaced = true; showReplaced(); });

  // ------------------------------------------------------------------------
  // Coda: animazioni e stati vengono mostrati nell'ordine in cui arrivano.
  // ------------------------------------------------------------------------
  const queue = [];
  let running = false;
  let waitingAnims = 0;
  async function runQueue() {
    if (running) return;
    running = true;
    while (queue.length) {
      try { await queue.shift()(); } catch (e) { console.error(e); }
    }
    running = false;
  }
  // La coda parte con setTimeout: se la risposta a "crea/entra" e il primo stato arrivano
  // nello stesso pacchetto, la sessione viene salvata prima di elaborare lo stato.
  socket.on('room:state', (s) => { queue.push(() => applyState(s)); setTimeout(runQueue); });
  socket.on('game:anim', (a) => {
    waitingAnims++;
    queue.push(() => { waitingAnims--; return playAnim(a.steps); });
    setTimeout(runQueue);
  });
  socket.on('chat:reaction', showReaction);

  // ------------------------------------------------------------------------
  // Schermate
  // ------------------------------------------------------------------------
  function showScreen(name) {
    for (const s of ['lobby', 'wait', 'game']) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  }

  function applyState(s) {
    if (!session) return; // stato in arrivo mentre stavamo uscendo
    if (!s.players.some((p) => p.id === meId())) return backToLobby(); // il nostro posto è stato liberato
    const prev = state;
    state = s;
    clockOffset = s.serverNow - Date.now();
    if (s.phase === 'lobby') { showScreen('wait'); renderWait(); return; }
    showScreen('game');
    renderGame(prev);
    renderVictory();
  }

  // ---------- Lobby ----------
  const nickInput = $('#nick');
  const codeInput = $('#code');
  nickInput.value = store.get('sov_nick') || '';
  codeInput.value = urlCode;

  function getNick() {
    const n = nickInput.value.trim();
    if (!n) { toast('Scrivi prima il tuo nickname 😉'); nickInput.focus(); return null; }
    store.set('sov_nick', n);
    return n;
  }
  function createRoom() {
    const nickname = getNick();
    if (nickname) enter('room:create', { nickname });
  }
  function joinRoom() {
    const nickname = getNick();
    if (!nickname) return;
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return toast('Il codice ha 4 lettere');
    enter('room:join', { code, nickname });
  }
  $('#btn-create').onclick = createRoom;
  $('#btn-join').onclick = joinRoom;
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeInput.value.trim() ? joinRoom : createRoom)(); });

  // ---------- Sala d'attesa ----------
  function renderWait() {
    $('#wait-code').textContent = state.code;
    $('#wait-players').innerHTML = state.players.map((p) => `
      <li><span class="dot" style="background:${p.color}"></span>
      <b>${esc(p.nickname)}</b>${p.id === meId() ? ' (tu)' : ''} ${p.id === state.hostId ? '👑' : ''} ${p.connected ? '' : '📴'}</li>`).join('');
    const isHost = state.hostId === meId();
    const ready = state.players.filter((p) => p.connected).length;
    $('#btn-start').classList.toggle('hidden', !isHost);
    $('#btn-start').disabled = ready < 2;
    $('#wait-hint').textContent = ready < 2 ? 'Condividi il codice: servono almeno 2 giocatori.'
      : isHost ? `${ready} giocatori pronti!` : 'In attesa che l\'host avvii la partita…';
  }
  $('#btn-share').onclick = async () => {
    const url = `${location.origin}${location.pathname}?r=${state.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Soveratopoly', text: `Gioca con me a Soveratopoly! Codice ${state.code}`, url });
      else { await navigator.clipboard.writeText(url); toast('Link copiato! 📋'); }
    } catch { /* condivisione annullata */ }
  };
  $('#btn-start').onclick = () => send('game:start');
  $('#btn-rematch').onclick = () => send('game:start');

  async function leave() {
    await send('room:leave', {}, { quiet: true }); // se la stanza non c'è più va bene lo stesso
    backToLobby();
  }
  $('#btn-leave-wait').onclick = leave;
  $('#btn-victory-exit').onclick = leave;
  $('#btn-leave-game').onclick = () => {
    const me = pl(meId());
    if (state.phase === 'playing' && !me.bankrupt && !confirm('Vuoi abbandonare? Le tue proprietà torneranno libere.')) return;
    leave();
  };

  // ------------------------------------------------------------------------
  // Geometria del tabellone (percentuali sull'immagine)
  // ------------------------------------------------------------------------
  function cellRect(i) {
    const box = (x0, y0, x1, y1, side) => ({ x0, y0, x1, y1, side });
    const k = i % 10;
    if (k === 0) { // angoli: VIA!, prigione, parcheggio, "In Prigione!"
      const [x, y] = [[10, 10], [0, 10], [0, 0], [10, 0]][i / 10];
      return box(BD[x], BD[y], BD[x + 1], BD[y + 1], 'corner');
    }
    if (i < 10) return box(BD[10 - k], BD[10], BD[11 - k], BD[11], 'bottom');
    if (i < 20) return box(BD[0], BD[10 - k], BD[1], BD[11 - k], 'left');
    if (i < 30) return box(BD[k], BD[0], BD[k + 1], BD[1], 'top');
    return box(BD[10], BD[k], BD[11], BD[k + 1], 'right');
  }

  /** Lato esterno di ogni fila di caselle: asse e verso. */
  const OUTER_EDGE = { bottom: ['y', 1], top: ['y', -1], left: ['x', -1], right: ['x', 1] };
  /** Striscia spessa t lungo il bordo esterno (verso il prezzo) o interno (fascia colorata) di una casella. */
  function strip(r, t, outer, pad = 0) {
    const [axis, dir] = OUTER_EDGE[r.side];
    const s = { x0: r.x0 + pad, y0: r.y0 + pad, x1: r.x1 - pad, y1: r.y1 - pad };
    if ((dir === 1) === outer) s[`${axis}0`] = s[`${axis}1`] - t;
    else s[`${axis}1`] = s[`${axis}0`] + t;
    return s;
  }
  const place = (el, r) => Object.assign(el.style, {
    left: `${r.x0}%`, top: `${r.y0}%`, width: `${r.x1 - r.x0}%`, height: `${r.y1 - r.y0}%`,
  });

  /** Posizione (in %) della k-esima di n pedine sulla stessa casella (fino a 8). */
  function pawnSpot(i, k, n, inJail) {
    if (i === RULES.JAIL_CELL) {
      if (inJail) return { x: 8.6 + (k % 3) * 2.6, y: 89.4 + Math.floor(k / 3) * 2.8 };  // dentro il riquadro arancione
      return k < 4 ? { x: 3.3, y: 86.6 + k * 3 } : { x: 6.3 + (k - 4) * 2.6, y: 96.6 };   // lungo la fascia "Transito"
    }
    const r = cellRect(i);
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const tall = r.side === 'bottom' || r.side === 'top'; // casella alta e stretta: 2 colonne, altrimenti 4
    const cols = Math.min(n, tall ? 2 : 4);
    const rows = Math.ceil(n / cols);
    const col = k % cols, row = Math.floor(k / cols);
    return { x: cx + (col - (cols - 1) / 2) * 3.2, y: cy + (row - (rows - 1) / 2) * 3.2 };
  }

  // ---------- Livello caselle (cliccabili, proprietari, case) ----------
  const cellEls = [];
  function buildCells() {
    if (cellEls.length) return;
    const layer = $('#cells-layer');
    const add = (cls) => { const el = document.createElement('div'); el.className = cls; layer.appendChild(el); return el; };
    CELLS.forEach((cell, i) => {
      const r = cellRect(i);
      const hit = add('cell-hit');
      place(hit, r);
      hit.title = cell.name;
      hit.onclick = () => showCellInfo(i);
      cellEls[i] = { hit };
      if (!S.isBuyable(i)) return;
      // Il segno del proprietario va sul lato esterno (sopra il prezzo), le case sulla fascia colorata.
      const mark = add('owner-mark hidden');
      place(mark, strip(r, 2.4, true, 0.5));
      const houses = add('houses');
      place(houses, strip(r, 3, false));
      if (OUTER_EDGE[r.side][0] === 'x') houses.style.flexDirection = 'column';
      Object.assign(cellEls[i], { mark, houses });
    });
  }

  function renderCells() {
    cellEls.forEach(({ hit, mark, houses }, i) => {
      hit.classList.toggle('highlight', state.turn?.pendingBuy === i || state.auction?.cell === i);
      const pr = state.props[i];
      if (!pr) return;
      const owner = pr.owner && pl(pr.owner);
      hit.classList.toggle('mortgaged', pr.mortgaged);
      mark.classList.toggle('hidden', !owner);
      if (owner) mark.style.background = owner.color;
      houses.innerHTML = pr.houses === RULES.MAX_HOUSES ? '<span class="hotel"></span>' : '<span class="house"></span>'.repeat(pr.houses);
    });
  }

  // ---------- Pedine ----------
  const pawnEls = {};
  function layoutPawns(activeId = null) {
    const layer = $('#pawns-layer');
    const byCell = {};
    for (const p of state.players) {
      if (!pawnEls[p.id]) {
        const el = document.createElement('div');
        el.className = 'pawn';
        el.textContent = Array.from(p.nickname)[0].toUpperCase(); // Array.from: non spezza le emoji
        el.style.background = p.color;
        layer.appendChild(el);
        pawnEls[p.id] = el;
      }
      if (shown[p.id] === undefined) { shown[p.id] = p.pos; shownJail[p.id] = p.inJail; }
      pawnEls[p.id].classList.toggle('hidden', p.bankrupt);
      pawnEls[p.id].classList.toggle('active', p.id === activeId);
      if (p.bankrupt) continue;
      const key = `${shown[p.id]}${shownJail[p.id] ? 'j' : ''}`;
      (byCell[key] = byCell[key] || []).push(p);
    }
    for (const list of Object.values(byCell)) {
      list.forEach((p, k) => {
        const spot = pawnSpot(shown[p.id], k, list.length, shownJail[p.id]);
        pawnEls[p.id].style.left = `${spot.x}%`;
        pawnEls[p.id].style.top = `${spot.y}%`;
      });
    }
    // Pedine di giocatori non più presenti
    for (const id of Object.keys(pawnEls)) {
      if (!pl(id)) { pawnEls[id].remove(); delete pawnEls[id]; delete shown[id]; delete shownJail[id]; }
    }
  }

  /** Fa ripartire un'animazione CSS e la rimuove dopo ms. */
  function flash(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth; // forza il reflow: l'animazione riparte da capo
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  // ---------- Dadi 3D ----------
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }; // posizioni su griglia 3x3
  const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };             // rotazione che porta la faccia davanti
  const dice = [$('#die1'), $('#die2')];
  let spins = 0;
  for (const die of dice) {
    die.innerHTML = Object.entries(PIPS).map(([n, pips]) => `<div class="face f${n}">${
      pips.map((c) => `<span class="pip" style="grid-area:${Math.ceil(c / 3)}/${((c - 1) % 3) + 1}"></span>`).join('')}</div>`).join('');
  }
  function setDice(values) {
    dice.forEach((die, k) => {
      const [x, y] = FACE_ROT[values[k]];
      die.style.transform = `rotateX(${x + spins * 720}deg) rotateY(${y + spins * 360}deg)`;
    });
  }
  async function rollDice(values) {
    $('#dice').style.opacity = 1;
    dice.forEach((d) => d.classList.add('rolling'));
    await sleep(550);
    dice.forEach((d) => d.classList.remove('rolling'));
    spins++; // giri in più: la transizione verso la nuova faccia è sempre visibile
    setDice(values);
    await sleep(950);
  }

  // ------------------------------------------------------------------------
  // Animazioni inviate dal server (lo stato definitivo arriva subito dopo)
  // ------------------------------------------------------------------------
  const setBusy = (on) => $('#screen-game').classList.toggle('busy', on);

  async function playAnim(steps) {
    if (!state || state.phase === 'lobby') return;
    // Scheda in background o animazioni arretrate: si salta direttamente allo stato finale.
    if (document.hidden || waitingAnims > 0) return;
    setBusy(true);
    $('#actions').innerHTML = '';
    try {
      for (const step of steps) {
        const pawn = pawnEls[step.playerId];
        if (step.t === 'dice') await rollDice(step.dice);
        else if (step.t === 'card') await showCard(step);
        else if (step.t === 'murra') await showMurraReveal(step);
        else if (!pawn) continue;
        else if (step.t === 'move') {
          shownJail[step.playerId] = false;
          for (const pos of step.path) {
            shown[step.playerId] = pos;
            layoutPawns();
            flash(pawn, 'hop', 180);
            await sleep(190);
          }
          await sleep(150);
        } else if (step.t === 'jump') {
          shown[step.playerId] = step.to;
          shownJail[step.playerId] = !!step.jail;
          flash(pawn, 'jump', 600);
          layoutPawns();
          await sleep(650);
        }
      }
    } finally {
      setBusy(false); // anche in caso di errore i pulsanti tornano disponibili
    }
  }

  function showCard(step) {
    return new Promise((resolve) => {
      const timer = setTimeout(closeModal, 7000);
      openModal(`
        <div class="head ${step.deck}">${step.deck === 'chance' ? '❓' : '🎁'} ${esc(step.title)}</div>
        <div class="text">${esc(step.text)}</div>
        <div class="note">${esc(step.note || '')}</div>
        <p class="who">${esc(pl(step.playerId)?.nickname || '')}</p>
        <button class="btn btn-big btn-blue" data-close>OK!</button>`, 'game-card', () => { clearTimeout(timer); resolve(); });
    });
  }

  // ------------------------------------------------------------------------
  // Render partita
  // ------------------------------------------------------------------------
  function renderGame(prev) {
    buildCells();
    $('#game-code').textContent = state.code;
    // Allinea le pedine allo stato (dopo un'animazione sono già al posto giusto).
    for (const p of state.players) {
      if (pawnEls[p.id] && shown[p.id] !== p.pos) flash(pawnEls[p.id], 'jump', 600);
      shown[p.id] = p.pos;
      shownJail[p.id] = p.inJail;
    }
    $('#dice').style.opacity = state.lastDice ? 1 : 0;
    if (state.lastDice) setDice(state.lastDice);
    renderCells();
    layoutPawns(state.turn?.playerId);
    renderBanner();
    renderActions();
    renderPlayers(prev);
    renderMyProps();
    $('#log').innerHTML = state.log.map((text) => `<li>${esc(text)}</li>`).join('');
  }

  function renderBanner() {
    const b = $('#turn-banner');
    if (!state.turn) {
      b.className = 'turn-banner';
      b.style.background = '';
      b.textContent = '🏁 Partita finita';
      return;
    }
    const cur = pl(state.turn.playerId);
    const special = state.murra ? '🤜 Murra!' : state.auction ? '🔨 Asta in corso!' : '';
    const mine = cur.id === meId() && !special;
    b.className = `turn-banner${mine ? ' mine' : ''}`;
    b.style.background = special ? '' : cur.color;
    b.innerHTML = `<span>${special || (mine ? '🎯 Tocca a TE!' : `Tocca a ${esc(cur.nickname)}`)}</span>
      <span class="timer" data-deadline="${state.turn.deadline}"></span>`;
    tickTimers();
  }
  /** Aggiorna tutti i conti alla rovescia (turno e scambio). */
  function tickTimers() {
    const now = Date.now() + clockOffset;
    document.querySelectorAll('[data-deadline]').forEach((el) => {
      el.textContent = `⏱ ${Math.max(0, Math.ceil((el.dataset.deadline - now) / 1000))}s`;
    });
  }
  setInterval(tickTimers, 250);

  /**
   * Pulsante d'azione: si disattiva al clic (niente doppi invii) e si riattiva se il
   * server rifiuta. Se l'azione riesce, il nuovo stato ridisegna comunque il pannello.
   */
  function button(label, cls, action, disabled = false) {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = async () => {
      b.disabled = true;
      if (!(await action())) b.disabled = false;
    };
    return b;
  }
  function row(...children) {
    const el = document.createElement('div');
    el.className = 'row';
    el.append(...children);
    return el;
  }

  function renderActions() {
    const box = $('#actions');
    box.innerHTML = '';
    if (!state.turn) return;
    renderTradeBox(box);
    if (state.murra) return renderMurraBox(box);
    if (state.auction) return renderAuctionBox(box);
    const { phase, pendingBuy } = state.turn;
    if (!isMyTurn()) {
      const what = { roll: 'sta per tirare i dadi', buy: `decide se comprare ${CELLS[pendingBuy]?.name}`, end: 'sta gestendo le sue proprietà' }[phase];
      box.insertAdjacentHTML('beforeend', `<div class="waiting">⏳ ${esc(pl(state.turn.playerId).nickname)} ${esc(what)}…</div>`);
      return;
    }
    const me = pl(meId());
    if (phase === 'roll' && me.inJail) {
      box.append(row(
        button('🎲 Tenta il doppio', 'btn-blue', () => send('game:roll')),
        button(`🔓 Paga ${euro(RULES.JAIL_FINE)}`, 'btn-yellow', () => send('game:payJail'), me.money < RULES.JAIL_FINE),
        ...(me.jailCards ? [button('🃏 Usa la carta', 'btn-green', () => send('game:useJailCard'))] : []),
      ));
    } else if (phase === 'roll') {
      box.append(button('🎲 Tira i dadi', 'btn-big btn-pink', () => send('game:roll')));
    } else if (phase === 'buy') {
      const cell = CELLS[pendingBuy];
      const card = document.createElement('div');
      card.className = 'buy-card';
      card.innerHTML = `<div class="band" style="background:${S.colorOf(pendingBuy)}"></div>
        <div class="body"><div class="name">${esc(cell.name)}</div>
        <div>Prezzo <b>${euro(cell.price)}</b> · hai ${euro(me.money)}</div></div>`;
      card.querySelector('.body').append(row(
        button('🛒 Compra', 'btn-green', () => send('game:buy'), me.money < cell.price),
        button('Passa', 'btn-ghost', () => send('game:pass')),
      ));
      box.append(card);
    } else {
      box.append(button('✅ Fine turno', 'btn-big btn-blue', () => send('game:endTurn')));
    }
  }

  // ---------- Aste ----------
  /** Riquadro dell'asta: lo vedono tutti; chi è ancora in gara può rilanciare o ritirarsi. */
  function renderAuctionBox(box) {
    const a = state.auction;
    const me = pl(meId());
    const leader = a.bidderId && pl(a.bidderId);
    const winning = a.bidderId === me.id;
    const out = me.bankrupt || a.passed.includes(me.id);
    const card = document.createElement('div');
    card.className = 'buy-card auction';
    card.innerHTML = `<div class="band" style="background:${S.colorOf(a.cell)}"></div>
      <div class="body"><div class="name">🔨 ${esc(CELLS[a.cell].name)}</div>
      <div>${leader
        ? `Offerta più alta: <b>${euro(a.bid)}</b> di <b style="color:${leader.color}">${esc(leader.nickname)}</b>`
        : `Nessuna offerta: si parte da <b>${euro(S.auctionStart(a.cell))}</b>`}</div>
      <div class="who">Prezzo di listino ${euro(CELLS[a.cell].price)} · ${
        winning ? `stai vincendo tu! 🎉${a.challengerId ? ' Ma può sfidarti a Murra…' : ''}` : out ? 'sei fuori da questa asta' : `hai ${euro(me.money)}`}</div></div>`;
    if (!winning && !out) {
      // Rilanci rapidi: +10, +50, +100 sull'offerta in corso; senza offerte, base d'asta, +50, +100
      const raises = leader
        ? [1, 5, 10].map((k) => a.bid + k * RULES.AUCTION_MIN_STEP)
        : [0, 5, 10].map((k) => S.auctionStart(a.cell) + k * RULES.AUCTION_MIN_STEP);
      card.querySelector('.body').append(
        row(...raises.map((v) => button(euro(v), 'btn-green', () => send('auction:bid', { amount: v }), v > me.money))),
        // Asta rimasta a due: invece di rilanciare si può sfidare a Murra chi ha fatto l'offerta
        ...(a.challengerId === me.id ? [button(`🤜 Sfida a Murra per comprarla a ${euro(a.bid)}`, 'btn-pink', () => send('auction:murra'))] : []),
        button('Mi ritiro', 'btn-ghost', () => send('auction:pass')),
      );
    }
    box.append(card);
  }

  // ---------- Murra ----------
  // Scelta in corso (dita e somma): sopravvive ai ridisegni del pannello e si azzera a ogni nuova mano.
  let murraSel = { key: '', fingers: 0, guess: 0 };
  /** Con n dita mie, la somma delle due mani può valere solo da n+1 a n+5. */
  const sumPossible = (sum, fingers) => !fingers || (sum > fingers && sum <= fingers + FINGERS.length);

  /** Riquadro della sfida: lo vedono tutti. Cambia con la fase: scelta dell'avversario, sfida da accettare, mani da giocare. */
  function renderMurraBox(box) {
    const m = state.murra;
    const me = pl(meId());
    const a = pl(m.a), b = m.b && pl(m.b);
    const name = (p) => `<b style="color:${p.color}">${esc(p.nickname)}</b>`;
    const prize = m.kind === 'auction'
      ? `Chi vince compra ${esc(CELLS[state.auction.cell].name)} a ${euro(state.auction.bid)}.`
      : `Chi perde dà ${euro(m.stake)} a chi vince.`;
    const card = document.createElement('div');
    card.className = 'buy-card murra';
    const body = document.createElement('div');
    body.className = 'body';
    card.append(body);
    box.append(card);

    if (m.stage === 'choose') { // carta Imprevisti o Parcheggio Gratuito: chi lancia sceglie l'avversario
      const mine = a.id === me.id;
      const optional = m.kind === 'parking'; // dal parcheggio la sfida è facoltativa
      body.innerHTML = `<div class="name">🤜 Murra!</div>
        <div>${!mine ? `${name(a)} sta scegliendo chi sfidare…`
          : optional ? 'Sei al Parcheggio Gratuito: vuoi sfidare qualcuno?' : 'Scegli chi sfidare:'}</div>
        <div class="who">${prize} Si vince a ${RULES.MURRA_POINTS} punti.</div>`;
      if (!mine) return;
      body.append(row(...state.players.filter((p) => !p.bankrupt && p.id !== me.id).map((p) => {
        const btn = button(p.nickname, '', () => send('murra:choose', { to: p.id }));
        btn.style.background = p.color;
        return btn;
      })));
      if (optional) body.append(button('Non sfido nessuno', 'btn-ghost', () => send('murra:skip')));
      return;
    }

    if (m.stage === 'offer') { // asta: lo sfidato decide se accettare
      const mine = b.id === me.id;
      body.innerHTML = `<div class="name">🤜 Murra!</div>
        <div>${mine ? `${name(a)} ti sfida a Murra: accetti?` : `In attesa che ${name(b)} risponda alla sfida di ${name(a)}…`}</div>
        <div class="who">${prize}${mine ? ' Se rifiuti, l\'asta continua.' : ''}</div>`;
      if (mine) {
        body.append(row(
          button('✅ Accetto', 'btn-green', () => send('murra:respond', { accept: true })),
          button('❌ Rifiuto', 'btn-pink', () => send('murra:respond', { accept: false })),
        ));
      }
      return;
    }

    const mark = (p) => (m.picked.includes(p.id) ? '✅' : '⏳');
    const playing = [a.id, b.id].includes(me.id);
    body.innerHTML = `<div class="name">🤜 Murra! <small>mano ${m.round}</small></div>
      <div class="versus">${name(a)} ${mark(a)} <strong>${m.score[a.id]} – ${m.score[b.id]}</strong> ${mark(b)} ${name(b)}</div>
      <div class="who">${prize} Chi indovina la somma fa un punto: si vince a ${RULES.MURRA_POINTS}.</div>`;
    if (playing && !m.picked.includes(me.id)) body.append(murraControls(m));
    else body.insertAdjacentHTML('beforeend', `<div class="who">${playing ? 'Hai giocato: in attesa dell\'avversario…' : 'Stanno scegliendo…'}</div>`);
  }

  /** Pulsanti per scegliere quante dita mostrare (1-5) e quale somma dichiarare (2-10). */
  function murraControls(m) {
    const key = `${m.a}:${m.b}:${m.round}`;
    if (murraSel.key !== key) murraSel = { key, fingers: 0, guess: 0 };
    const wrap = document.createElement('div');
    wrap.className = 'murra-controls';
    const pick = (html, on, onClick) => {
      const btn = document.createElement('button');
      btn.className = `pick${on ? ' on' : ''}`;
      btn.innerHTML = html;
      btn.onclick = onClick;
      return btn;
    };
    const draw = () => {
      wrap.innerHTML = '<small>1. Quante dita mostri?</small><div class="murra-fingers"></div>'
        + '<small>2. Quanto fa la somma delle due mani?</small><div class="murra-sums"></div>';
      FINGERS.forEach((emoji, k) => {
        const n = k + 1;
        const btn = pick(`<span>${emoji}</span>${n}`, murraSel.fingers === n, () => {
          murraSel.fingers = n;
          if (!sumPossible(murraSel.guess, n)) murraSel.guess = 0; // la somma scelta prima non è più possibile
          draw();
        });
        btn.setAttribute('aria-label', `${n} ${n === 1 ? 'dito' : 'dita'}`);
        wrap.querySelector('.murra-fingers').append(btn);
      });
      for (let sum = 2; sum <= 2 * FINGERS.length; sum++) {
        const btn = pick(sum, murraSel.guess === sum, () => { murraSel.guess = sum; draw(); });
        btn.disabled = !sumPossible(sum, murraSel.fingers);
        wrap.querySelector('.murra-sums').append(btn);
      }
      wrap.append(button('🤜 Gioca!', 'btn-big btn-pink',
        () => send('murra:play', { fingers: murraSel.fingers, guess: murraSel.guess }), !murraSel.fingers || !murraSel.guess));
    };
    draw();
    return wrap;
  }

  /** Rivelazione di una mano: le due mani, le somme dichiarate, il punto e il punteggio. */
  function showMurraReveal(step) {
    return new Promise((resolve) => {
      const winner = step.winnerId && pl(step.winnerId);
      const scorer = step.scorerId && pl(step.scorerId);
      const timer = setTimeout(closeModal, winner ? 6000 : 3500); // le mani intermedie scorrono più veloci
      const side = (s) => {
        const p = pl(s.id);
        const points = step.score[s.id];
        return `<div class="murra-side${step.scorerId === s.id ? ' win' : ''}">
          <b style="color:${p?.color}">${esc(p?.nickname || '')}</b>
          <div class="murra-hand">${FINGERS[s.fingers - 1]}</div>
          <div>${s.fingers} ${s.fingers === 1 ? 'dito' : 'dita'}</div>
          <div class="said">dice <b>${s.guess}</b></div>
          <div class="points" aria-label="${points} punti">${'●'.repeat(points)}${'○'.repeat(Math.max(0, RULES.MURRA_POINTS - points))}</div></div>`;
      };
      const bothRight = step.a.guess === step.sum && step.b.guess === step.sum;
      const hand = scorer ? `Punto a ${esc(scorer.nickname)}! 🎯`
        : bothRight ? 'Indovinano entrambi: nessun punto.' : 'Nessuno indovina: nessun punto.';
      const final = !winner ? ''
        : `<p class="murra-final">${step.cutShort ? 'Sfida chiusa in anticipo: vince' : 'Vince la Murra'} ${esc(winner.nickname)}! 🏆</p>`;
      openModal(`
        <h2>🤜 Murra! 🤛</h2>
        <div class="murra-reveal">${side(step.a)}<div class="murra-sum">Somma<b>${step.sum}</b></div>${side(step.b)}</div>
        <p class="murra-outcome">${hand}</p>${final}
        <button class="btn btn-blue" data-close>OK!</button>`, 'murra-modal', () => { clearTimeout(timer); resolve(); });
    });
  }

  // ---------- Scambi ----------
  const chip = (i) => `<span class="chip" style="--c:${S.colorOf(i)}">${esc(CELLS[i].name)}</span>`;
  /** Un lato dello scambio: proprietà e soldi. */
  const offer = ({ props, money, cards }) => (props.map(chip).join('')
    + '<span class="chip">🃏 Esci di prigione</span>'.repeat(cards)
    + (money ? `<span class="chip money">${euro(money)}</span>` : '')) || '<i>niente</i>';

  /** Riquadro dello scambio in corso, mostrato in cima alle azioni. */
  function renderTradeBox(box) {
    const t = state.trade;
    if (!t) return;
    const from = pl(t.from), to = pl(t.to);
    const el = document.createElement('div');
    el.className = 'trade-card';
    const sides = (giveLabel, getLabel, give, get) => `
      <div><small>${giveLabel}</small><div class="chips">${offer(give)}</div></div>
      <div><small>${getLabel}</small><div class="chips">${offer(get)}</div></div>`;
    const timer = `<span class="timer" data-deadline="${t.expires}"></span>`;
    if (t.to === meId()) {
      el.innerHTML = `<b>🤝 ${esc(from.nickname)} ti propone uno scambio ${timer}</b>${sides('Tu ricevi', 'Tu dai', t.give, t.get)}`;
      el.append(row(
        button('✅ Accetta', 'btn-green', () => send('trade:respond', { accept: true })),
        button('❌ Rifiuta', 'btn-pink', () => send('trade:respond', { accept: false })),
      ));
    } else if (t.from === meId()) {
      el.innerHTML = `<b>🤝 In attesa della risposta di ${esc(to.nickname)}… ${timer}</b>${sides('Tu dai', 'Tu ricevi', t.give, t.get)}`;
      el.append(button('Annulla scambio', 'btn-ghost', () => send('trade:cancel')));
    } else {
      el.innerHTML = `<b>🤝 ${esc(from.nickname)} propone uno scambio a ${esc(to.nickname)}…</b>`;
    }
    box.append(el);
  }

  function openTrade(otherId) {
    const other = pl(otherId), me = pl(meId());
    const column = (title, who, name) => {
      const checks = propsOf(who.id).map((i) => {
        const locked = groupHasHouses(i);
        return `<label class="tcheck${locked ? ' off' : ''}"><input type="checkbox" name="${name}" value="${i}"${locked ? ' disabled' : ''}>
          <span class="sw" style="background:${S.colorOf(i)}"></span>${esc(CELLS[i].name)}${state.props[i].mortgaged ? ' 🏦' : ''}</label>`;
      }).join('') || '<i>nessuna proprietà</i>';
      const cards = `<label class="tcheck"><input type="checkbox" name="${name}-card">🃏 Esci di prigione</label>`.repeat(who.jailCards);
      return `<div><h4>${title}</h4>${checks}${cards}
        <label class="tmoney">💶 <input type="number" name="${name}-money" min="0" max="${who.money}" value="0" inputmode="numeric"></label></div>`;
    };
    openModal(`
      <h2>🤝 Scambio con ${esc(other.nickname)}</h2>
      <div class="trade-cols">${column('Tu dai', me, 'give')}${column('Ricevi', other, 'get')}</div>
      <small class="who">Le proprietà con case nel gruppo non si possono scambiare.</small>
      <button class="btn btn-big btn-green" id="t-send">Proponi scambio</button>
      <button class="btn btn-ghost" data-close>Annulla</button>`, 'trade-modal');
    const box = $('#modal-box');
    const picked = (name) => [...box.querySelectorAll(`input[name=${name}]:checked`)].map((c) => Number(c.value));
    const amount = (name) => Number(box.querySelector(`input[name=${name}-money]`).value) || 0;
    const cards = (name) => box.querySelectorAll(`input[name=${name}-card]:checked`).length;
    $('#t-send').onclick = async () => {
      const res = await send('trade:propose', {
        to: other.id, giveProps: picked('give'), getProps: picked('get'), giveMoney: amount('give'), getMoney: amount('get'),
        giveCards: cards('give'), getCards: cards('get'),
      });
      if (res) closeModal();
    };
  }

  function renderPlayers(prev) {
    const ul = $('#players');
    const tradeOpen = canManage() && !state.trade;
    ul.innerHTML = state.players.map((p) => `
      <li data-id="${p.id}" class="${state.turn?.playerId === p.id ? 'current' : ''} ${p.bankrupt ? 'bankrupt' : ''}">
        <span class="dot" style="background:${p.color}"></span>
        <span class="name">${esc(p.nickname)}${p.id === meId() ? ' (tu)' : ''}
          <span class="tag">${p.id === state.hostId ? '👑' : ''}${p.inJail ? ' 🔒' : ''}${p.connected ? '' : ' 📴'}${p.bankrupt ? ' ☠️' : ''}${p.jailCards ? ' 🃏' : ''}</span></span>
        <span class="money">${euro(p.money)}</span>
        ${tradeOpen && p.id !== meId() && !p.bankrupt ? `<button class="btn btn-yellow btn-small" data-trade="${p.id}" title="Proponi uno scambio">🤝</button>` : ''}
      </li>`).join('');
    ul.querySelectorAll('[data-trade]').forEach((b) => { b.onclick = () => openTrade(b.dataset.trade); });
    // Variazione di soldi (+200, -50...) rispetto allo stato precedente della stessa partita
    if (prev?.phase !== 'playing') return;
    for (const p of state.players) {
      const old = prev.players.find((q) => q.id === p.id);
      const d = old ? p.money - old.money : 0;
      if (!d) continue;
      const span = document.createElement('span');
      span.className = `delta ${d > 0 ? 'plus' : 'minus'}`;
      span.textContent = `${d > 0 ? '+' : ''}${euro(d)}`;
      ul.querySelector(`[data-id="${p.id}"]`).appendChild(span);
    }
  }

  function renderMyProps() {
    const box = $('#my-props');
    const mine = propsOf(meId());
    box.innerHTML = mine.length ? '' : '<div class="empty">Nessuna proprietà… ancora! 🏝️</div>';
    box.insertAdjacentHTML('beforeend', '<div class="prop-row"><span class="pn">🃏 Esci di prigione<small>carta da usare o scambiare</small></span></div>'
      .repeat(pl(meId()).jailCards));
    const can = canManage();
    const me = pl(meId());
    for (const i of mine) {
      const cell = CELLS[i];
      const pr = state.props[i];
      const fullGroup = cell.type === 'prop' && S.groupOf(i).every((c) => state.props[c].owner === me.id);
      const info = pr.mortgaged ? 'ipotecata' : pr.houses === RULES.MAX_HOUSES ? '🏨 albergo' : pr.houses ? `🏠 × ${pr.houses}` : fullGroup ? 'gruppo completo!' : '';
      const el = document.createElement('div');
      el.className = `prop-row${pr.mortgaged ? ' mort' : ''}`;
      el.innerHTML = `<span class="sw" style="background:${S.colorOf(i)}"></span>
        <span class="pn">${esc(cell.name)}<small>${info}</small></span><span class="ops"></span>`;
      el.querySelector('.pn').onclick = () => showCellInfo(i);
      const op = (label, action, cls, title, affordable = true) => {
        const b = button(label, cls, () => send('game:manage', { action, cell: i }), !can || !affordable);
        b.title = title;
        el.querySelector('.ops').append(b);
      };
      if (fullGroup && !pr.mortgaged && pr.houses < RULES.MAX_HOUSES) op('+🏠', 'build', 'btn-green', `Costruisci (${euro(S.houseCost(i))})`, me.money >= S.houseCost(i));
      if (pr.houses > 0) op('−🏠', 'sell', 'btn-yellow', `Vendi casa (+${euro(S.houseSellValue(i))})`);
      if (!pr.mortgaged && !groupHasHouses(i)) op('🏦', 'mortgage', 'btn-ghost', `Ipoteca (+${euro(S.mortgageValue(i))})`);
      if (pr.mortgaged) op('✨', 'unmortgage', 'btn-blue', `Riscatta (-${euro(S.unmortgageCost(i))})`, me.money >= S.unmortgageCost(i));
      box.append(el);
    }
  }

  // ---------- Chat ----------
  // Lo stesso riquadro compare in sala d'attesa e in partita: [data-chat] li aggiorna entrambi.
  const CHAT_KEEP = 50;
  const chatBoxes = [...document.querySelectorAll('[data-chat]')];
  let chat = [];

  function setChat(messages) {
    chat = messages.slice(-CHAT_KEEP);
    for (const box of chatBoxes) {
      const list = box.querySelector('.chat-list');
      list.replaceChildren(...chat.map((m) => {
        const li = document.createElement('li');
        const who = document.createElement('b');
        who.textContent = `${m.nickname}: `;
        who.style.color = m.color;
        li.append(who, m.text); // testo inserito come testo, mai come HTML
        if (m.playerId === meId()) li.className = 'mine';
        return li;
      }));
      if (!chat.length) list.innerHTML = '<li class="empty">Nessun messaggio: rompi il ghiaccio! 👋</li>';
      list.scrollTop = list.scrollHeight;
    }
  }
  /** La chat è sullo schermo in questo momento? (Su telefono può essere sotto il tabellone.) */
  const chatOnScreen = () => chatBoxes.some((box) => {
    const r = box.getBoundingClientRect();
    return r.height > 0 && r.top < innerHeight && r.bottom > 0;
  });
  socket.on('chat:message', (m) => {
    setChat([...chat, m]);
    if (m.playerId !== meId() && !chatOnScreen()) toast(`💬 ${m.nickname}: ${m.text}`);
  });
  for (const box of chatBoxes) {
    const input = box.querySelector('input');
    input.maxLength = RULES.CHAT_MAX_LENGTH;
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text && await send('chat:send', { text })) input.value = '';
    };
  }
  setChat([]);

  // ---------- Reazioni (emoji predefinite) ----------
  $('#reactions').innerHTML = REACTIONS.map((e, i) => `<button data-r="${i}" aria-label="Reazione ${e}">${e}</button>`).join('');
  $('#reactions').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (b) send('chat:react', { id: Number(b.dataset.r) });
  };
  function showReaction({ playerId, emoji }) {
    const p = state && pl(playerId);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'reaction-float';
    el.style.left = `${30 + Math.random() * 40}%`;
    el.innerHTML = `${esc(emoji)}<small style="color:${p.color}">${esc(p.nickname)}</small>`;
    $('#reaction-layer').appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  // ---------- Info casella ----------
  function showCellInfo(i) {
    const cell = CELLS[i];
    const pr = state?.props[i];
    const owner = pr?.owner && pl(pr.owner);
    const table = (rows) => `<table class="info-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
    let details = '';
    if (cell.type === 'prop') {
      details = table([
        ['Affitto', euro(S.propRent(i, 0, false))],
        ['Con tutto il gruppo', euro(S.propRent(i, 0, true))],
        ...[1, 2, 3, 4].map((h) => [`Con ${h} ${h === 1 ? 'casa' : 'case'}`, euro(S.propRent(i, h))]),
        ['Con albergo', euro(S.propRent(i, RULES.MAX_HOUSES))],
        ['Costo di una casa', euro(S.houseCost(i))],
        ['Ipoteca', euro(S.mortgageValue(i))],
      ]);
    } else if (cell.type === 'station') {
      details = table([1, 2, 3, 4].map((n) => [`Con ${n} stazion${n === 1 ? 'e' : 'i'}`, euro(RULES.STATION_RENT[n])]));
    } else if (cell.type === 'utility') {
      details = table([['Con una', `dadi × ${RULES.UTILITY_MULT[1]}`], ['Con entrambe', `dadi × ${RULES.UTILITY_MULT[2]}`]]);
    }
    const desc = {
      go: `Ogni volta che passi dal VIA! ritiri ${euro(RULES.GO_SALARY)}.`,
      tax: `Paghi ${euro(cell.amount)} alla banca.`,
      chance: 'Pesca una carta Imprevisti.',
      chest: 'Pesca una carta Probabilità.',
      jail: 'Se sei solo di passaggio non succede nulla.',
      parking: `Puoi sfidare un giocatore a Murra: chi perde dà ${euro(RULES.PARKING_MURRA_STAKE)} a chi vince. 🤜`,
      gotojail: 'Vai dritto in prigione senza passare dal VIA!.',
    }[cell.type];
    openModal(`
      <div class="info-band" style="background:${S.colorOf(i)}"></div>
      <h2>${esc(cell.name)}</h2>
      ${cell.price ? `<p>Prezzo <b>${euro(cell.price)}</b></p>` : ''}
      ${desc ? `<p>${desc}</p>` : ''}
      ${details}
      ${pr ? `<p>${owner ? `Proprietario: <b style="color:${owner.color}">${esc(owner.nickname)}</b>` : 'Libera 🟢'}${pr.mortgaged ? ' · ipotecata' : ''}</p>` : ''}
      <button class="btn btn-blue" data-close>Chiudi</button>`);
  }

  // ---------- Modale generica ----------
  let onModalClose = null;
  function fireModalClose() {
    const f = onModalClose;
    onModalClose = null;
    if (f) f();
  }
  function openModal(html, cls = '', onClose = null) {
    fireModalClose(); // la finestra precedente, se c'era, viene sostituita
    const box = $('#modal-box');
    box.className = `modal-box ${cls}`;
    box.innerHTML = html;
    onModalClose = onClose;
    $('#modal').classList.add('show');
  }
  function closeModal() {
    $('#modal').classList.remove('show');
    fireModalClose();
  }
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
  });

  // ---------- Vittoria ----------
  function renderVictory() {
    const ov = $('#victory');
    const finished = state.phase === 'finished';
    $('#btn-rematch').classList.toggle('hidden', state.hostId !== meId());
    if (finished === ov.classList.contains('show')) return; // già nello stato giusto
    ov.classList.toggle('show', finished);
    if (!finished) return;
    const w = state.winnerId && pl(state.winnerId);
    $('#victory-title').textContent = !w ? 'Partita finita' : w.id === meId() ? 'Hai vinto! 🎉' : `${w.nickname} ha vinto!`;
    $('#victory-sub').textContent = w ? `Il re di Soverato chiude con ${euro(w.money)} 🤑` : '';
    confetti();
  }

  function confetti() {
    const box = $('#confetti');
    box.innerHTML = '';
    const colors = ['#ff3b8d', '#2f80ff', '#ffd23f', '#22c55e', '#a855f7', '#ff9a50'];
    for (let k = 0; k < 120; k++) {
      const c = document.createElement('div');
      c.className = 'confetto';
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[k % colors.length];
      c.style.animationDuration = `${2.5 + Math.random() * 2.5}s`;
      c.style.animationDelay = `${Math.random() * 1.5}s`;
      box.appendChild(c);
    }
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
})();
