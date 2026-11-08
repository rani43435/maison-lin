#!/usr/bin/env python3
"""GitHub Action: build the 3D piece for one product row in Supabase (photos -> GLB) and publish it.
env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; arg: product id"""
import json, os, subprocess, sys, tempfile, time, urllib.request

URL = os.environ['SUPABASE_URL'].rstrip('/'); KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}


def req(method, path, body=None, headers=None, raw=False):
    h = dict(H); h.update(headers or {})
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    if not raw and body is not None: h['Content-Type'] = 'application/json'
    r = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=120) as res:
        t = res.read()
        return json.loads(t) if t and res.headers.get('Content-Type', '').startswith('application/json') else t


def update(pid, fields):
    req('PATCH', f'/rest/v1/products?id=eq.{pid}', fields, {'Prefer': 'return=minimal'})


def main(pid):
    rows = req('GET', f'/rest/v1/products?id=eq.{pid}&select=*')
    if not rows: sys.exit(f'no product {pid}')
    p = rows[0]
    tmp = tempfile.mkdtemp()
    try:
        files = {}
        for k in ('front', 'back'):
            u = p.get(f'{k}_url')
            if not u: raise RuntimeError(f'missing {k} photo')
            fn = os.path.join(tmp, f'{k}.jpg'); urllib.request.urlretrieve(u, fn); files[k] = fn
        out = os.path.join(tmp, 'out')
        cmd = [sys.executable, os.path.join(os.path.dirname(__file__), 'ai_garment.py'), files['front'], files['back'],
               '--name', p['name'], '--color', p.get('color') or '', '--price', str(p['price']),
               '--type', p.get('base') or 'knit', '--id', pid, '--out', out, '--no-catalog']
        subprocess.run(cmd, check=True)
        ver = int(time.time()); urls = {}
        for suffix, field, ctype in (('.glb', 'glb_url', 'model/gltf-binary'), ('.jpg', 'texture_url', 'image/jpeg'), ('_fabric.jpg', 'fabric_url', 'image/jpeg')):
            path = f'built/{pid}/{pid}{suffix}'
            with open(os.path.join(out, f'{pid}{suffix}'), 'rb') as f:
                req('POST', f'/storage/v1/object/garments/{path}', f.read(), {'Content-Type': ctype, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000'}, raw=True)
            urls[field] = f'{URL}/storage/v1/object/public/garments/{path}?v={ver}'
        res = json.load(open(os.path.join(out, f'{pid}.json')))
        fields = dict(urls, model=res['model'], status='ready', error=None)
        if not p.get('hex') or p['hex'] == '#8a6a55': fields['hex'] = res['hex']
        update(pid, fields)
        print('ready', pid)
    except Exception as e:
        update(pid, {'status': 'failed', 'error': str(e)[:500]})
        raise


if __name__ == '__main__':
    main(sys.argv[1])
