// Talks to Supabase (products, settings, checkout). Without config the store runs in demo mode.
import { CONFIG } from './config.js?v=1794320660';

export const live = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const H = () => ({ apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${CONFIG.supabaseAnonKey}` });

async function rest(path) {
  const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${path}`, { headers: H() });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

/** products that are visible and built */
export async function fetchProducts() {
  if (!live()) return null;
  try { return await rest('products?select=*&order=sort.asc,created_at.desc'); }
  catch (e) { console.warn('products', e); return null; }
}

/** settings as {key: value} */
export async function fetchSettings() {
  if (!live()) return {};
  try { const rows = await rest('settings?select=key,value'); return Object.fromEntries(rows.map((r) => [r.key, r.value])); }
  catch (e) { console.warn('settings', e); return {}; }
}

/** create a Stripe checkout and return its url */
export async function startCheckout(items, promo) {
  const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/checkout`, {
    method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, promo, origin: location.origin + location.pathname.replace(/index\.html$/, '').replace(/\/$/, '') }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error || 'Checkout is not available right now');
  return j.url;
}
