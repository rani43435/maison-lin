#!/usr/bin/env python3
"""Turns every folder in inbox/ into a garment: inbox/<any-name>/front.jpg, back.jpg, info.json
info.json: {"name": "Le Hoodie Gris", "color": "Gris", "price": 240, "type": "hoodie"}"""
import json, os, glob, shutil, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
done = 0
for d in sorted(glob.glob(os.path.join(ROOT, 'inbox', '*/'))):
    pics = {k: next(iter(glob.glob(os.path.join(d, k + '.*'))), None) for k in ('front', 'back')}
    info_p = os.path.join(d, 'info.json')
    if not (pics['front'] and pics['back'] and os.path.exists(info_p)):
        print('skip', d, '(needs front.*, back.* and info.json)'); continue
    info = json.load(open(info_p))
    cmd = [sys.executable, os.path.join(ROOT, 'tools', 'add_garment.py'), pics['front'], pics['back'],
           '--type', info.get('type', 'hoodie'), '--name', info['name'], '--color', info.get('color', ''), '--price', str(info.get('price', 200))]
    if info.get('desc'): cmd += ['--desc', info['desc']]
    subprocess.run(cmd, check=True)
    shutil.rmtree(d); done += 1
print(f'{done} garment(s) added')
