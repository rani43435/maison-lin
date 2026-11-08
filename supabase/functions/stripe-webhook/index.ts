// Stripe -> here when a payment succeeds: the order becomes "paid" with the customer's details.
// Deploy with --no-verify-jwt; set STRIPE_WEBHOOK_SECRET (whsec_…).
import { admin } from '../_shared/util.ts';

async function verify(body: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${parts.t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === parts.v1;
}

Deno.serve(async (req) => {
  const body = await req.text();
  const ok = await verify(body, req.headers.get('stripe-signature') || '', Deno.env.get('STRIPE_WEBHOOK_SECRET') || '');
  if (!ok) return new Response('bad signature', { status: 400 });
  const ev = JSON.parse(body);
  const db = admin();
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    const s = ev.data.object;
    if (s.payment_status !== 'paid' && ev.type === 'checkout.session.completed') return new Response('waiting');
    const c = s.customer_details || {};
    const ship = s.collected_information?.shipping_details || s.shipping_details || {};
    const { data: order } = await db.from('orders').update({
      status: 'paid', email: c.email, name: ship.name || c.name, phone: c.phone,
      address: ship.address || c.address, total: Math.round((s.amount_total || 0) / 100),
    }).eq('stripe_session', s.id).select('items').single();
    // count stock down where it is tracked
    for (const it of (order?.items || []) as any[]) {
      const { data: p } = await db.from('products').select('stock').eq('id', it.id).single();
      if (p?.stock && p.stock[it.size] !== undefined) {
        p.stock[it.size] = Math.max(0, Number(p.stock[it.size]) - it.qty);
        await db.from('products').update({ stock: p.stock }).eq('id', it.id);
      }
    }
  }
  if (ev.type === 'checkout.session.expired') await db.from('orders').update({ status: 'cancelled' }).eq('stripe_session', ev.data.object.id).eq('status', 'pending');
  if (ev.type === 'charge.refunded') { /* refunds are visible in Stripe; mark manually in /admin */ }
  return new Response('ok');
});
