// Maison Lin — admin: products, adding pieces from two photos, orders, store settings.
import { CONFIG } from './config.js?v=1794321443';
import { ITEMS } from './catalog.js?v=1794321443';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let toastT;
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); };
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const CATS = [['knitwear', 'Knitwear'], ['hoodies', 'Hoodies'], ['polos', 'Polos'], ['tees', 'T-shirts'], ['jackets', 'Jackets']];
const BASES = [['knit', 'Sweater / knit'], ['hoodie', 'Hoodie'], ['hoodie-pocket', 'Hoodie with pocket'], ['polo', 'Polo / collar']];

// ---------------- not connected ----------------
if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
  app.innerHTML = `<div class="center"><div class="card login">
    <h1>Not connected yet</h1>
    <p class="muted">The admin needs the store's Supabase project. Follow <a href="https://github.com/rani43435/maison-lin/blob/main/SETUP.md">SETUP.md</a>:
    create the project, run <code>supabase/schema.sql</code>, then put the Project URL and anon key in <code>js/config.js</code>.</p>
  </div></div>`;
  throw new Error('not configured');
}

const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
let session = null, tab = 'products', settings = {};

// ---------------- auth ----------------
async function boot() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) return loginView();
  const { data: me } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (!me) return notAdminView();
  $('#tabs').hidden = false;
  await loadSettings();
  show(tab);
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') boot(); });

function loginView() {
  $('#tabs').hidden = true;
  app.innerHTML = `<div class="center"><form class="card login" id="lf">
    <h1>Sign in</h1><p class="sub">Store admin</p>
    <div class="list">
      <label>Email<input type="email" id="le" required autocomplete="email"></label>
      <label>Password<input type="password" id="lp" autocomplete="current-password"></label>
      <button class="btn primary">Sign in</button>
      <button class="btn" type="button" id="magic">Email me a sign-in link</button>
      <p class="muted">First time? Use the link — it creates your account. Then the owner adds you as admin (SETUP.md, step 4).</p>
    </div></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $('#le').value, password: $('#lp').value });
    if (error) toast(error.message);
  };
  $('#magic').onclick = async () => {
    const email = $('#le').value; if (!email) return toast('Enter your email');
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } });
    toast(error ? error.message : 'Check your inbox for the sign-in link');
  };
}

function notAdminView() {
  $('#tabs').hidden = true;
  app.innerHTML = `<div class="center"><div class="card login">
    <h1>Almost there</h1>
    <p class="muted">You are signed in as <b>${esc(session.user.email)}</b> but not an admin yet. In Supabase → SQL Editor run:</p>
    <p style="margin:12px 0"><code>insert into admins (user_id, email) values ('${session.user.id}', '${esc(session.user.email)}');</code></p>
    <p class="muted">then reload this page.</p>
    <div class="row" style="margin-top:16px"><button class="btn" id="so">Sign out</button><button class="btn primary" onclick="location.reload()">Reload</button></div>
  </div></div>`;
  $('#so').onclick = () => sb.auth.signOut();
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  if (b.dataset.tab === 'logout') { sb.auth.signOut(); return; }
  show(b.dataset.tab);
});
function show(t) {
  tab = t;
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ({ products: productsView, add: addView, orders: ordersView, settings: settingsView })[t]();
}

async function loadSettings() {
  const { data } = await sb.from('settings').select('key,value');
  settings = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}
async function saveSetting(key, value) {
  const { error } = await sb.from('settings').upsert({ key, value });
  if (error) throw error;
  settings[key] = value;
}

// ---------------- products ----------------
async function productsView() {
  app.innerHTML = `<div class="wrap"><h1>Products</h1><p class="sub">Change anything and press Save — the store updates immediately.</p>
    <div class="row" style="margin-bottom:16px"><button class="btn primary" id="toAdd">+ Add a piece from two photos</button></div>
    <div class="list" id="pl"><p class="muted">Loading…</p></div>
    <h2>Built-in pieces</h2><p class="muted" style="margin-bottom:12px">The demo collection that ships with the site. Hide them or change their price.</p>
    <div class="list" id="bl"></div></div>`;
  $('#toAdd').onclick = () => show('add');
  const { data: rows, error } = await sb.from('products').select('*').order('sort').order('created_at', { ascending: false });
  if (error) { $('#pl').innerHTML = `<p class="muted">${esc(error.message)}</p>`; return; }
  $('#pl').innerHTML = rows.length ? rows.map(productRow).join('') : '<p class="muted">No pieces yet — add your first one.</p>';
  if (rows.some((r) => r.status === 'processing')) setTimeout(() => { if (tab === 'products') productsView(); }, 15000);
  $('#pl').onclick = (e) => onProductClick(e, rows);
  // built-ins
  const B = settings.builtins || {};
  $('#bl').innerHTML = ITEMS.filter((i) => !i.photo).map((it) => {
    const o = B[it.id] || {};
    return `<div class="item" data-b="${it.id}"><div class="ph" style="background:${it.hex}"></div>
      <div><div class="n">${esc(o.name || it.name)}</div><div class="m">${esc(it.color)} · €${o.price || it.price}</div></div>
      <div class="act row"><input type="number" min="0" value="${o.price || it.price}" style="width:90px" data-bp>
      <button class="switch ${o.visible === false ? '' : 'on'}" data-bv title="Visible"></button><button class="btn small" data-bs>Save</button></div></div>`;
  }).join('');
  $('#bl').onclick = async (e) => {
    const row = e.target.closest('[data-b]'); if (!row) return;
    if (e.target.matches('[data-bv]')) { e.target.classList.toggle('on'); return; }
    if (e.target.matches('[data-bs]')) {
      const id = row.dataset.b, B2 = { ...(settings.builtins || {}) };
      B2[id] = { ...(B2[id] || {}), price: Number($('[data-bp]', row).value) || undefined, visible: $('[data-bv]', row).classList.contains('on') };
      try { await saveSetting('builtins', B2); toast('Saved'); } catch (er) { toast(er.message); }
    }
  };
}

function productRow(p) {
  const img = p.front_url ? `<img src="${esc(p.front_url)}" alt="">` : `<div class="ph" style="background:${esc(p.hex)}"></div>`;
  const stock = p.stock || {};
  return `<div class="item" data-id="${esc(p.id)}">${img}
    <div><div class="n">${esc(p.name)}</div><div class="m">${esc(p.color)} · €${p.price} · ${esc(p.category)}</div>
      <div class="row" style="margin-top:6px"><span class="pill ${p.status}">${p.status === 'processing' ? 'building 3D…' : p.status}</span>${p.badge ? `<span class="pill">${esc(p.badge)}</span>` : ''}</div>
      ${p.status === 'failed' ? `<div class="m" style="color:var(--bad)">${esc(p.error || '')}</div>` : ''}</div>
    <div class="act row"><button class="switch ${p.visible ? 'on' : ''}" data-act="vis" title="Visible in the store"></button><button class="btn small" data-act="edit">Edit</button></div>
    <div class="edit"><form data-form>
      <div class="grid3">
        <label>Name<input name="name" value="${esc(p.name)}" required></label>
        <label>Colour name<input name="color" value="${esc(p.color)}"></label>
        <label>Price (€)<input name="price" type="number" min="0" value="${p.price}" required></label>
        <label>Category<select name="category">${CATS.map(([k, n]) => `<option value="${k}" ${k === p.category ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Badge<input name="badge" value="${esc(p.badge)}" placeholder="New, Limited…"></label>
        <label>Order (lower = first)<input name="sort" type="number" value="${p.sort}"></label>
        <label>Swatch colour<input name="hex" type="color" value="${esc(p.hex || '#8a6a55')}"></label>
      </div>
      <label style="margin-top:12px">Description<textarea name="description">${esc(p.description)}</textarea></label>
      <p class="muted" style="margin:12px 0 6px">Stock per size (leave empty = always available)</p>
      <div class="grid4" style="grid-template-columns:repeat(5,1fr)">${SIZES.map((s) => `<label>${s}<input name="stock_${s}" type="number" min="0" value="${stock[s] ?? ''}"></label>`).join('')}</div>
      <div class="row" style="margin-top:14px"><button class="btn primary">Save</button><button class="btn" type="button" data-act="rebuild">Rebuild 3D</button><button class="btn danger" type="button" data-act="del">Delete</button></div>
    </form></div></div>`;
}

async function onProductClick(e, rows) {
  const row = e.target.closest('[data-id]'); if (!row) return;
  const id = row.dataset.id; const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'edit') { row.classList.toggle('open'); const f = $('[data-form]', row); f.onsubmit = (ev) => saveProduct(ev, id); return; }
  if (act === 'vis') {
    const on = !e.target.classList.contains('on');
    const { error } = await sb.from('products').update({ visible: on }).eq('id', id);
    if (error) return toast(error.message);
    e.target.classList.toggle('on', on); toast(on ? 'Visible in the store' : 'Hidden from the store'); return;
  }
  if (act === 'del') {
    if (!confirm('Delete this piece for good? This cannot be undone.')) return;
    const { error } = await sb.from('products').delete().eq('id', id);
    if (error) return toast(error.message);
    await sb.storage.from('garments').remove([`photos/${id}/front.jpg`, `photos/${id}/back.jpg`, `built/${id}/${id}.glb`, `built/${id}/${id}.jpg`, `built/${id}/${id}_fabric.jpg`]);
    toast('Deleted'); productsView(); return;
  }
  if (act === 'rebuild') { await build(id); productsView(); }
}

async function saveProduct(ev, id) {
  ev.preventDefault();
  const f = new FormData(ev.target), stock = {};
  for (const s of SIZES) { const v = f.get(`stock_${s}`); if (v !== '' && v !== null) stock[s] = Number(v); }
  const upd = { name: f.get('name'), color: f.get('color'), price: Number(f.get('price')), category: f.get('category'), badge: f.get('badge'),
    sort: Number(f.get('sort')) || 100, hex: f.get('hex'), description: f.get('description'), stock };
  const { error } = await sb.from('products').update(upd).eq('id', id);
  toast(error ? error.message : 'Saved'); if (!error) productsView();
}

async function build(id) {
  const { data: { session: s } } = await sb.auth.getSession();
  await sb.from('products').update({ status: 'processing', error: null }).eq('id', id);
  const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/build-garment`, {
    method: 'POST', headers: { Authorization: `Bearer ${s.access_token}`, apikey: CONFIG.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { await sb.from('products').update({ status: 'failed', error: j.error || `build ${r.status}` }).eq('id', id); toast(j.error || 'Could not start the 3D build'); return false; }
  toast('Building the 3D piece — about 2 minutes'); return true;
}

// ---------------- add a piece ----------------
function addView() {
  app.innerHTML = `<div class="wrap"><h1>Add a piece</h1>
    <p class="sub">Two photos — front and back, whole garment, plain background, same distance. The 3D piece builds itself (about 2 minutes) and appears on the rail, in the shop and in the fitting room.</p>
    <form class="card" id="af">
      <div class="grid2" style="max-width:520px">
        <div><p class="muted" style="margin-bottom:6px">Front</p><div class="drop" id="dF"><span>Tap to choose<br>the front photo</span><input type="file" accept="image/*" id="fF" required></div></div>
        <div><p class="muted" style="margin-bottom:6px">Back</p><div class="drop" id="dB"><span>Tap to choose<br>the back photo</span><input type="file" accept="image/*" id="fB" required></div></div>
      </div>
      <div class="grid3" style="margin-top:18px">
        <label>Name<input name="name" required placeholder="Le Pull Onyx"></label>
        <label>Colour name<input name="color" placeholder="Cacao"></label>
        <label>Price (€)<input name="price" type="number" min="0" required></label>
        <label>Category<select name="category">${CATS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
        <label>Kind of garment<select name="base">${BASES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
        <label>Badge<input name="badge" placeholder="New"></label>
      </div>
      <label style="margin-top:12px">Description<textarea name="description" placeholder="Fabric, fit, details…"></textarea></label>
      <div class="row" style="margin-top:16px"><button class="btn primary" id="ab">Add and build 3D</button><span class="muted" id="as"></span></div>
    </form></div>`;
  for (const [inp, box] of [['#fF', '#dF'], ['#fB', '#dB']]) {
    $(inp).onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      let im = $(box).querySelector('img'); if (!im) { im = document.createElement('img'); $(box).prepend(im); }
      im.src = URL.createObjectURL(f);
    };
  }
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name')).trim(), color = String(f.get('color')).trim();
    const id = `${name}-${color}`.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36).slice(-4);
    $('#ab').disabled = true;
    try {
      $('#as').textContent = 'Uploading photos…';
      const urls = {};
      for (const [k, el] of [['front', '#fF'], ['back', '#fB']]) {
        const blob = await shrink($(el).files[0], 1800);
        const path = `photos/${id}/${k}.jpg`;
        const { error } = await sb.storage.from('garments').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (error) throw error;
        urls[`${k}_url`] = sb.storage.from('garments').getPublicUrl(path).data.publicUrl;
      }
      $('#as').textContent = 'Saving…';
      const { error } = await sb.from('products').insert({ id, name, color, price: Number(f.get('price')), category: f.get('category'), base: f.get('base'),
        badge: f.get('badge'), description: f.get('description'), status: 'processing', visible: true, ...urls });
      if (error) throw error;
      $('#as').textContent = 'Starting the 3D build…';
      await build(id);
      show('products');
    } catch (er) { toast(er.message || String(er)); $('#ab').disabled = false; $('#as').textContent = ''; }
  };
}

/** downscale a photo in the browser (faster upload, same quality for the 3D build) */
async function shrink(file, max) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

// ---------------- orders ----------------
const OST = ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
async function ordersView(filter = 'open') {
  app.innerHTML = `<div class="wrap"><h1>Orders</h1><p class="sub">Paid orders arrive here automatically. Order the piece from your supplier, then mark it shipped with the tracking number.</p>
    <div class="stats" id="st"></div>
    <div class="row" style="margin-bottom:14px"><select id="of"><option value="open">To ship (paid)</option><option value="all">All orders</option>${OST.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
    <div class="list" id="ol"><p class="muted">Loading…</p></div></div>`;
  $('#of').value = filter;
  $('#of').onchange = (e) => ordersView(e.target.value);
  const { data: all, error } = await sb.from('orders').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) { $('#ol').innerHTML = `<p class="muted">${esc(error.message)}</p>`; return; }
  const paid = all.filter((o) => ['paid', 'shipped', 'delivered'].includes(o.status));
  const month = paid.filter((o) => new Date(o.created_at) > new Date(Date.now() - 30 * 864e5));
  $('#st').innerHTML = [['To ship', all.filter((o) => o.status === 'paid').length], ['Orders (30 days)', month.length],
    ['Revenue (30 days)', '€' + month.reduce((a, o) => a + (o.total || 0), 0)], ['All-time revenue', '€' + paid.reduce((a, o) => a + (o.total || 0), 0)]]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  const L = filter === 'all' ? all : filter === 'open' ? all.filter((o) => o.status === 'paid') : all.filter((o) => o.status === filter);
  $('#ol').innerHTML = L.length ? L.map((o) => {
    const a = o.address || {};
    return `<div class="ord" data-o="${o.id}"><div class="h"><div><b style="font-family:var(--serif);font-size:20px">#${o.number}</b>
      <span class="muted"> · ${new Date(o.created_at).toLocaleString()}</span></div><span class="pill ${o.status}">${o.status}</span></div>
      <table>${(o.items || []).map((i) => `<tr><td>${esc(i.name)} — ${esc(i.color)}, ${esc(i.size)}</td><td>× ${i.qty}</td><td style="text-align:right">€${i.price * i.qty}</td></tr>`).join('')}
      <tr><td colspan="2">Total${o.discount ? ` (−€${o.discount})` : ''}${o.shipping ? ` incl. €${o.shipping} delivery` : ''}</td><td style="text-align:right"><b>€${o.total}</b></td></tr></table>
      ${o.email ? `<p class="muted">${esc(o.name)} · ${esc(o.email)} · ${esc(o.phone || '')}<br>${esc([a.line1, a.line2, `${a.postal_code || ''} ${a.city || ''}`, a.state, a.country].filter((x) => x && x.trim()).join(', '))}</p>` : '<p class="muted">Not paid yet.</p>'}
      <div class="row" style="margin-top:10px"><select data-s>${OST.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input data-t placeholder="Tracking number" value="${esc(o.tracking || '')}" style="flex:1;min-width:160px"><button class="btn small primary" data-save>Save</button></div></div>`;
  }).join('') : '<p class="muted">Nothing here.</p>';
  $('#ol').onclick = async (e) => {
    if (!e.target.matches('[data-save]')) return;
    const box = e.target.closest('[data-o]');
    const { error: er } = await sb.from('orders').update({ status: $('[data-s]', box).value, tracking: $('[data-t]', box).value }).eq('id', box.dataset.o);
    toast(er ? er.message : 'Order updated'); if (!er) ordersView(filter);
  };
}

// ---------------- settings ----------------
function settingsView() {
  const st = settings.store || {}, h = settings.hero || {}, t = settings.theme || {}, an = settings.announce || [], pr = settings.promo || {};
  app.innerHTML = `<div class="wrap"><h1>Settings</h1><p class="sub">Texts, colours, delivery and discount codes of the store.</p>
    <form class="card" id="sf"><div class="list">
      <h2 style="margin-top:0">Store</h2>
      <div class="grid3"><label>Store name<input name="name" value="${esc(st.name || 'Maison Lin')}"></label>
        <label>Free delivery from (€)<input name="freeShipping" type="number" value="${st.freeShipping ?? 300}"></label>
        <label>Delivery fee (€)<input name="shippingFee" type="number" value="${st.shippingFee ?? 12}"></label></div>
      <h2>Top bar</h2>
      <label>One message per line<textarea name="announce">${esc(an.join('\n'))}</textarea></label>
      <h2>Home text</h2>
      <div class="grid2"><label>Small line<input name="eyebrow" value="${esc(h.eyebrow ?? 'Autumn — Winter 2026')}"></label>
        <label>Title<input name="title" value="${esc(h.title ?? 'Quiet pieces,')}"></label>
        <label>Title, second line (italic)<input name="titleItalic" value="${esc(h.titleItalic ?? 'made to be worn.')}"></label>
        <label>Sentence<input name="sub" value="${esc(h.sub ?? '')}"></label></div>
      <h2>Colours</h2>
      <div class="row">${[['bg', 'Background', '#E9DFD2'], ['ink', 'Text', '#2E2019'], ['accent', 'Accent', '#A26E3F'], ['cream', 'Panels', '#F5EFE6']].map(([k, n, d]) =>
        `<label>${n}<input type="color" name="${k}" value="${esc(t[k] || d)}"></label>`).join('')}<button class="btn small" type="button" id="rc">Reset colours</button></div>
      <h2>Discount codes</h2>
      <label>One per line: CODE = percent<textarea name="promo">${esc(Object.entries(pr).map(([k, v]) => `${k} = ${v}`).join('\n'))}</textarea></label>
      <div class="row"><button class="btn primary">Save settings</button></div>
    </div></form></div>`;
  $('#rc').onclick = () => { for (const [k, d] of [['bg', '#E9DFD2'], ['ink', '#2E2019'], ['accent', '#A26E3F'], ['cream', '#F5EFE6']]) $(`[name=${k}]`).value = d; };
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const promo = {};
    for (const line of String(f.get('promo')).split('\n')) { const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*[=:]\s*(\d+)/); if (m) promo[m[1].toUpperCase()] = Math.min(90, Number(m[2])); }
    try {
      await saveSetting('store', { ...st, name: f.get('name'), freeShipping: Number(f.get('freeShipping')), shippingFee: Number(f.get('shippingFee')) });
      await saveSetting('announce', String(f.get('announce')).split('\n').map((s) => s.trim()).filter(Boolean));
      await saveSetting('hero', { eyebrow: f.get('eyebrow'), title: f.get('title'), titleItalic: f.get('titleItalic'), sub: f.get('sub') });
      await saveSetting('theme', { bg: f.get('bg'), ink: f.get('ink'), accent: f.get('accent'), cream: f.get('cream') });
      await saveSetting('promo', promo);
      toast('Saved — reload the store to see it');
    } catch (er) { toast(er.message); }
  };
}

boot();
