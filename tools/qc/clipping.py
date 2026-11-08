#!/usr/bin/env python3
"""
QC: how much of a garment the AR occluder punches through, in standard arm poses.

Renders each garment twice per pose and angle in a headless browser with the site's own code:
once normally, once with the AR body occluder on over a magenta background. Magenta inside the
garment = where the live camera would show through in the fitting room (your arm or hand "through" the sleeve).

  python3 tools/qc/clipping.py <product id> [<product id> ...] [--save renders/]   # serve the repo first, see below
Needs: pip install playwright && playwright install chromium. Starts its own static server on a free port.
Fails (exit 1) when any pose/angle is above --limit percent (default 0.2).
"""
import argparse, base64, functools, http.server, io, json, os, socketserver, sys, threading
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
POSES = ['hang', 'tight', 'front']
ANGLES = [0, 90]


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=ROOT)
    s = socketserver.TCPServer(('127.0.0.1', 0), h); threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, s.server_address[1]


def decode(u): return np.array(Image.open(io.BytesIO(base64.b64decode(u.split(',')[1]))).convert('RGB')).astype(int)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('ids', nargs='+'); ap.add_argument('--limit', type=float, default=0.2); ap.add_argument('--save', default=None)
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    srv, port = serve(); results = []; worst = 0.0
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 1500, 'height': 1000})
        pg.goto(f'http://127.0.0.1:{port}/tools/qc/clip.html'); pg.wait_for_function('window.ready', timeout=60000)
        for gid in a.ids:
            for pose in POSES:
                base = [decode(u) for u in pg.evaluate(f"run('{gid}','{pose}',{ANGLES},0)")]
                occ = [decode(u) for u in pg.evaluate(f"run('{gid}','{pose}',{ANGLES},1)")]
                outer = [decode(u) for u in pg.evaluate(f"run('{gid}','{pose}',{ANGLES},2)")]
                for ang, im0, im1, im2 in zip(ANGLES, base, occ, outer):
                    garment = np.abs(im0 - np.array([0xE9, 0xDF, 0xD2])).sum(2) > 30
                    hole = garment & (np.abs(im1 - np.array([255, 0, 255])).sum(2) < 90)
                    # tears or flipped normals: places where the outside faces are missing and only the inside shows
                    tear = garment & (np.abs(im2 - np.array([255, 0, 255])).sum(2) < 90)
                    pct = 100 * hole.sum() / max(garment.sum(), 1); tp = 100 * tear.sum() / max(garment.sum(), 1)
                    worst = max(worst, pct)
                    results.append(dict(id=gid, pose=pose, angle=ang, see_through_pct=round(pct, 3), tear_pct=round(tp, 3), ok=pct <= a.limit))
                    print(f'{gid:34s} {pose:6s} {ang:3d}°  see-through {pct:5.2f}%  (outside faces missing: tears or flipped normals {tp:5.2f}%)  {"ok" if pct <= a.limit else "FAIL"}')
                    if a.save:
                        os.makedirs(a.save, exist_ok=True)
                        Image.fromarray(im1.astype(np.uint8)).save(os.path.join(a.save, f'{gid}_{pose}_{ang}_occ.png'))
                        Image.fromarray(im0.astype(np.uint8)).save(os.path.join(a.save, f'{gid}_{pose}_{ang}.png'))
        b.close()
    srv.shutdown()
    print(json.dumps(dict(limit_pct=a.limit, worst_pct=round(worst, 3), results=results), indent=1) if os.environ.get('QC_JSON') else '')
    sys.exit(0 if worst <= a.limit else 1)


if __name__ == '__main__':
    main()
