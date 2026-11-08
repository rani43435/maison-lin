// shared helpers for the edge functions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** database client with full rights (server side only) */
export const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/** true when the request comes from a signed-in admin */
export async function isAdmin(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!jwt) return false;
  const db = admin();
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return false;
  const { data } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  return !!data;
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await admin().from('settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
