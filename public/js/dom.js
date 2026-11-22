/**
 * Piccoli aiuti per il DOM: selettori, escape dell'HTML, pulsanti, finestra modale, avvisi.
 */
import { UI } from './ui-config.js';

export const $ = (sel) => document.querySelector(sel);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Modale generica ----------
export let onModalClose = null;
export function fireModalClose() {
  const f = onModalClose;
  onModalClose = null;
  if (f) f();
}
export function openModal(html, cls = '', onClose = null) {
  fireModalClose(); // la finestra precedente, se c'era, viene sostituita
  const box = $('#modal-box');
  box.className = `modal-box ${cls}`;
  box.innerHTML = html;
  onModalClose = onClose;
  $('#modal').classList.add('show');
}
/** Chiusura con clic fuori dalla finestra, sui pulsanti [data-close] o con il tasto Esc. */
export function initModal() {
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal').classList.contains('show')) closeModal();
  });
}
export function closeModal() {
  $('#modal').classList.remove('show');
  fireModalClose();
}

// ---------- Toast ----------
export let toastTimer;
export function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), UI.TOAST_MS);
}

/**
 * Pulsante d'azione: si disattiva al clic (niente doppi invii) e si riattiva se il
 * server rifiuta. Se l'azione riesce, il nuovo stato ridisegna comunque il pannello.
 */
export function button(label, cls, action, disabled = false) {
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
export function row(...children) {
  const el = document.createElement('div');
  el.className = 'row';
  el.append(...children);
  return el;
}
