// Store layer: shop grid, filters, search, wishlist, menu, size guide.
// The 3D rail stays the heart of the site: every card opens its piece on the rail.
import { CATEGORIES, SIZE_GUIDE } from './catalog.js?v=1794146158';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEART = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/></svg>';

export function initShop(api) {
  const { items } = api;
  let wish = [];
  try { wish = JSON.parse(localStorage.getItem('ml_wish') || '[]'); } catch { wish = []; }
  const state = { cat: 'all', color: null, sort: 'feat', newOnly: false };

  const thumb = (it, side = 'f') => (api.thumbs[it.id] || {})[side];
  const img = (it) => {
    const f = thumb(it, 'f'), b = thumb(it, 'b');
    return f ? `<img class="f" src="${f}" alt="${esc(it.name)} — front" loading="lazy">${b ? `<img class="b" src="${b}" alt="${esc(it.name)} — back" loading="lazy">` : ''}`
      : '<span class="ph">Maison Lin</span>';
  };
  const siblings = (it) => items.filter((o) => (o.base || o.model) === (it.base || it.model));
  const card = (it, small = false) => `
    <article class="card" data-open="${it.index}">
      <div class="img">${img(it)}${it.badge ? `<span class="badge">${esc(it.badge)}</span>` : ''}
        <button class="heart ${wish.includes(it.id) ? 'on' : ''}" data-wish="${it.id}" aria-label="Wishlist">${HEART}</button>
        ${small ? '' : `<button class="quick" data-try="${it.index}"><span class="dot" style="width:6px;height:6px;border-radius:50%;background:var(--caramel)"></span>Try it on</button>`}</div>
      <div class="meta"><div class="n">${esc(it.name)}</div><div class="c">${esc(it.color)}</div><div class="pr">€${it.price}</div>
        ${small ? '' : `<div class="dots">${siblings(it).map((s) => `<i style="background:${s.hex}"></i>`).join('')}</div>`}</div>
    </article>`;

  // ---------- shop ----------
  const colorsOf = () => {
    const seen = new Map();
    for (const it of items) { const k = family(it.hex); if (!seen.has(k)) seen.set(k, it.hex); }
    return [...seen.entries()];
  };
  function family(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const l = (r + g + b) / 3;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 18) return l > 160 ? 'light' : l > 90 ? 'grey' : 'dark';
    return l > 175 ? 'cream' : l > 120 ? 'camel' : 'brown';
  }
  function list() {
    let L = items.filter((it) => (state.cat === 'all' || it.category === state.cat) && (!state.color || family(it.hex) === state.color));
    if (state.newOnly) L = L.filter((it) => it.badge === 'New' || it.badge === 'Atelier' || it.added >= items.length - 4);
    const s = state.sort;
    if (s === 'low') L = [...L].sort((a, b) => a.price - b.price);
    if (s === 'high') L = [...L].sort((a, b) => b.price - a.price);
    if (s === 'new') L = [...L].sort((a, b) => b.added - a.added);
    return L;
  }
  function renderShop() {
    const t = state.newOnly ? 'New in' : (CATEGORIES.find((c) => c[0] === state.cat) || [0, 'All pieces'])[1];
    $('#shopTitle').textContent = t;
    $('#shopChips').innerHTML = CATEGORIES.map(([k, n]) => `<button data-cat="${k}" class="${!state.newOnly && k === state.cat ? 'on' : ''}">${n}</button>`).join('')
      + `<button data-cat="new" class="${state.newOnly ? 'on' : ''}">New in</button>`;
    $('#shopColors').innerHTML = colorsOf().map(([k, hex]) => `<button data-col="${k}" title="${k}" class="${state.color === k ? 'on' : ''}" style="background:${hex}"></button>`).join('');
    const L = list();
    $('#shopCount').textContent = `${L.length} piece${L.length === 1 ? '' : 's'}`;
    $('#shopGrid').innerHTML = L.map((it) => card(it)).join('') || '<p class="empty">No pieces match — try another colour.</p>';
    document.querySelectorAll('.menu-links [data-shop]').forEach((a) => a.classList.toggle('on', a.dataset.shop === (state.newOnly ? 'new' : state.cat)));
  }
  function openShop(cat = 'all') {
    state.newOnly = cat === 'new'; state.cat = cat === 'new' ? 'all' : cat; state.color = null;
    closeOverlays(); renderShop();
    $('#shop').classList.add('open'); $('#shop').scrollTop = 0;
    document.body.classList.add('shop-open'); api.onShop(true);
  }
  function closeShop() {
    if (!$('#shop').classList.contains('open')) return;
    $('#shop').classList.remove('open'); document.body.classList.remove('shop-open'); api.onShop(false);
    document.querySelectorAll('.menu-links .on').forEach((a) => a.classList.remove('on'));
  }
  $('#shopChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    if (b.dataset.cat === 'new') { state.newOnly = true; state.cat = 'all'; } else { state.newOnly = false; state.cat = b.dataset.cat; }
    renderShop();
  });
  $('#shopColors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-col]'); if (!b) return;
    state.color = state.color === b.dataset.col ? null : b.dataset.col; renderShop();
  });
  $('#shopSort').addEventListener('change', (e) => { state.sort = e.target.value; renderShop(); });

  // cards anywhere (shop, search, wishlist, related)
  document.addEventListener('click', (e) => {
    const w = e.target.closest('[data-wish]');
    if (w) { e.stopPropagation(); toggleWish(w.dataset.wish); return; }
    const t = e.target.closest('[data-try]');
    if (t) { e.stopPropagation(); const it = items[+t.dataset.try]; closeShop(); closeOverlays(); api.tryOn(it); return; }
    const o = e.target.closest('[data-open]');
    if (o) { const i = +o.dataset.open; closeShop(); closeOverlays(); api.openOnRail(i); return; }
    const s = e.target.closest('[data-shop]');
    if (s) { e.preventDefault(); openShop(s.dataset.shop); }
  });

  // ---------- wishlist ----------
  function saveWish() { try { localStorage.setItem('ml_wish', JSON.stringify(wish)); } catch {} renderWish(); }
  function toggleWish(id) {
    const k = wish.indexOf(id);
    if (k >= 0) wish.splice(k, 1); else wish.push(id);
    saveWish();
    const it = items.find((i) => i.id === id);
    if (it) api.toast(k >= 0 ? 'Removed from wishlist' : `${it.name} saved to wishlist`);
    document.querySelectorAll(`[data-wish="${id}"]`).forEach((b) => b.classList.toggle('on', k < 0));
    api.onWish();
  }
  function renderWish() {
    const c = $('#wishCount'); c.textContent = wish.length; c.classList.toggle('on', wish.length > 0);
    const L = wish.map((id) => items.find((i) => i.id === id)).filter(Boolean);
    $('#wishItems').innerHTML = L.length ? L.map((it) => `<div class="bag-item" data-open="${it.index}" style="cursor:pointer">
        <div class="sw">${thumb(it) ? `<img src="${thumb(it)}" alt="">` : ''}</div>
        <div><div class="n">${esc(it.name)}</div><div class="m">${esc(it.color)}</div></div>
        <div class="r">€${it.price}<button class="rm" data-wish="${it.id}">Remove</button></div></div>`).join('')
      : '<p class="bag-empty">Nothing saved yet. Tap the heart on any piece.</p>';
  }

  // ---------- search ----------
  function runSearch(q) {
    q = q.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const L = !words.length ? items : items.filter((it) => {
      const hay = `${it.name} ${it.color} ${it.category} ${it.line} ${it.desc} ${it.fabric}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return words.every((w) => hay.includes(w.normalize('NFD').replace(/[̀-ͯ]/g, '')));
    });
    $('#searchGrid').innerHTML = L.length ? L.map((it) => card(it, true)).join('') : `<p class="empty">Nothing found for “${esc(q)}”.</p>`;
  }
  $('#searchIn').addEventListener('input', (e) => runSearch(e.target.value));
  $('#searchSugg').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (!b) return; $('#searchIn').value = b.dataset.q; runSearch(b.dataset.q); });
  function openSearch() { closeOverlays(); $('#search').classList.add('open'); document.body.classList.add('search-open'); runSearch($('#searchIn').value); setTimeout(() => $('#searchIn').focus(), 200); api.onShop(true); }
  function closeSearch() { if (!$('#search').classList.contains('open')) return; $('#search').classList.remove('open'); document.body.classList.remove('search-open'); if (!$('#shop').classList.contains('open')) api.onShop(false); }

  // ---------- size guide ----------
  function openSize(cur) {
    $('#sizeTable').innerHTML = `<tr>${SIZE_GUIDE.head.map((h) => `<th>${h}</th>`).join('')}</tr>` +
      SIZE_GUIDE.rows.map((r) => `<tr class="${r[0] === cur ? 'on' : ''}">${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    $('#sizeModal').classList.add('open');
  }
  $('#sizeModal').addEventListener('click', (e) => { if (e.target.id === 'sizeModal') $('#sizeModal').classList.remove('open'); });

  // ---------- drawers ----------
  function closeOverlays() {
    ['#wish', '#menu'].forEach((s) => $(s).classList.remove('open'));
    $('#scrim').classList.remove('on');
    closeSearch();
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'menu') { $('#menu').classList.add('open'); $('#scrim').classList.add('on'); }
    if (act === 'closeMenu') { $('#menu').classList.remove('open'); $('#scrim').classList.remove('on'); }
    if (act === 'wish') { $('#menu').classList.remove('open'); renderWish(); $('#wish').classList.add('open'); $('#scrim').classList.add('on'); }
    if (act === 'closeWish') { $('#wish').classList.remove('open'); $('#scrim').classList.remove('on'); }
    if (act === 'closeAll') closeOverlays();
    if (act === 'search') openSearch();
    if (act === 'closeSearch') closeSearch();
    if (act === 'sizeGuide') { e.preventDefault(); $('#menu').classList.remove('open'); $('#scrim').classList.remove('on'); openSize(api.getSize()); }
    if (act === 'closeSize') $('#sizeModal').classList.remove('open');
    if (act === 'atelier' || act === 'home') { closeShop(); closeOverlays(); }
    if (act === 'acc') a.parentElement.classList.toggle('open');
  });
  $('#news').addEventListener('submit', (e) => { e.preventDefault(); e.target.reset(); api.toast('Thank you — see you in the atelier'); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#sizeModal').classList.remove('open'); closeOverlays(); } if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); openSearch(); } });

  renderWish();
  return {
    openShop, closeShop, renderShop, isWished: (id) => wish.includes(id), toggleWish, card,
    refreshThumbs() { if ($('#shop').classList.contains('open')) renderShop(); renderWish(); if ($('#search').classList.contains('open')) runSearch($('#searchIn').value); },
    isOpen: () => $('#shop').classList.contains('open') || $('#search').classList.contains('open'),
  };
}
