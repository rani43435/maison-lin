// POST {items:[{id,size,qty}], promo, origin} -> {url} of a Stripe Checkout page.
// Prices always come from the database, never from the browser.
import { cors, json, admin, setting } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    if (!key) return json({ error: 'Payments are not set up yet' }, 503);
    const { items = [], promo = '', origin = '' } = await req.json();
    if (!Array.isArray(items) || !items.length || items.length > 30) return json({ error: 'Your bag is empty' }, 400);
    const db = admin();
    const ids = [...new Set(items.map((i: any) => String(i.id)))];
    const { data: products, error } = await db.from('products').select('id,name,color,price,visible,status,stock,texture_url').in('id', ids);
    if (error) throw error;
    const store = await setting('store', { freeShipping: 300, shippingFee: 12, currency: 'eur', name: 'Maison Lin' } as any);
    const promos = await setting('promo', {} as Record<string, number>);
    const lines: any[] = [];
    let subtotal = 0;
    for (const it of items) {
      const p = products!.find((x) => x.id === it.id);
      const qty = Math.max(1, Math.min(10, parseInt(it.qty) || 1));
      const size = String(it.size || 'M').slice(0, 4);
      if (!p || !p.visible || p.status !== 'ready') return json({ error: `A piece is no longer available` }, 409);
      const left = p.stock && p.stock[size] !== undefined ? Number(p.stock[size]) : Infinity;
      if (left < qty) return json({ error: `${p.name} in ${size} is sold out` }, 409);
      subtotal += p.price * qty;
      lines.push({ id: p.id, name: p.name, color: p.color, size, qty, price: p.price });
    }
    const pct = promos[String(promo).toUpperCase()] || 0;
    const discount = Math.round(subtotal * pct / 100);
    const shipping = subtotal - discount >= (store.freeShipping ?? 300) ? 0 : (store.shippingFee ?? 12);
    const total = subtotal - discount + shipping;
    const { data: order, error: e2 } = await db.from('orders').insert({ items: lines, subtotal, discount, shipping, total, currency: store.currency || 'eur' }).select('id,number').single();
    if (e2) throw e2;

    // Stripe Checkout Session (REST, form encoded)
    const f = new URLSearchParams();
    const back = (origin || req.headers.get('origin') || '').replace(/\/$/, '');
    f.set('mode', 'payment');
    f.set('success_url', `${back}/?order=success&n=${order.number}`);
    f.set('cancel_url', `${back}/?order=cancelled`);
    f.set('client_reference_id', order.id);
    f.set('metadata[order_id]', order.id);
    f.set('phone_number_collection[enabled]', 'true');
    f.set('billing_address_collection', 'auto');
    for (const c of ['DE', 'AT', 'CH', 'NL', 'BE', 'FR', 'IT', 'ES', 'LU', 'DK', 'PL', 'CZ', 'SE', 'IL', 'GB']) f.append('shipping_address_collection[allowed_countries][]', c);
    lines.forEach((l, k) => {
      // discount spread over the pieces so Stripe shows the real total
      const unit = Math.round(l.price * 100 * (1 - pct / 100));
      f.set(`line_items[${k}][quantity]`, String(l.qty));
      f.set(`line_items[${k}][price_data][currency]`, store.currency || 'eur');
      f.set(`line_items[${k}][price_data][unit_amount]`, String(unit));
      f.set(`line_items[${k}][price_data][product_data][name]`, `${l.name} — ${l.color}, ${l.size}`);
    });
    if (shipping) {
      f.set('shipping_options[0][shipping_rate_data][display_name]', 'Standard delivery');
      f.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
      f.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(shipping * 100));
      f.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', store.currency || 'eur');
    } else {
      f.set('shipping_options[0][shipping_rate_data][display_name]', 'Complimentary delivery');
      f.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
      f.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', '0');
      f.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', store.currency || 'eur');
    }
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', body: f,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const s = await r.json();
    if (!r.ok) { await db.from('orders').update({ status: 'cancelled', note: s.error?.message }).eq('id', order.id); return json({ error: s.error?.message || 'Stripe error' }, 502); }
    await db.from('orders').update({ stripe_session: s.id }).eq('id', order.id);
    return json({ url: s.url });
  } catch (e) {
    console.error(e);
    return json({ error: 'Checkout failed, please try again' }, 500);
  }
});
