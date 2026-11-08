// POST {id} from /admin -> asks GitHub to build the 3D piece from its two photos (GitHub Action "build-garment").
// Secrets: GH_TOKEN (fine-grained token, repo "Contents: read & write" + "Actions: read & write"), GH_REPO (owner/name).
import { cors, json, isAdmin } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await isAdmin(req))) return json({ error: 'Not allowed' }, 401);
  const { id } = await req.json();
  if (!id) return json({ error: 'Missing id' }, 400);
  const r = await fetch(`https://api.github.com/repos/${Deno.env.get('GH_REPO')}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('GH_TOKEN')}`, Accept: 'application/vnd.github+json', 'User-Agent': 'maison-lin' },
    body: JSON.stringify({ event_type: 'build-garment', client_payload: { id } }),
  });
  if (!r.ok) return json({ error: `GitHub: ${r.status} ${await r.text()}` }, 502);
  return json({ ok: true });
});
