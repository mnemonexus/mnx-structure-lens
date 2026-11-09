"""Blank the labels of every `label` activity.

Reads content/labels/*.json. For each activity writes
  assets/fig/<id>.png        the original with every label box painted over by one flat colour
                             (the median of a 6 px ring just outside the box)
  assets/fig/<id>-full.png   the original, re-saved as an optimised PNG
An activity may also list `cover`: [x, y, w, h] boxes painted the same way but not numbered (slide notes that
would give a label away).

Run from the add-on folder:  python dev/blank_figures.py [--only <id>]
Needs Pillow. Idempotent.
"""
import json
import os
import statistics
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LABELS = os.path.join(ROOT, 'content', 'labels')
OUT = os.path.join(ROOT, 'assets', 'fig')
RING = 6


def load_activities():
    out = []
    if not os.path.isdir(LABELS):
        return out
    for name in sorted(os.listdir(LABELS)):
        if name.endswith('.json') and name not in ('skills.json', 'single-terms.json'):
            with open(os.path.join(LABELS, name), 'rb') as f:
                data = json.loads(f.read().decode('utf-8'))
            if isinstance(data, dict):
                out.extend(data.get('activities', []))
    return out


def ring_colour(img, box):
    """Median RGB of the pixels in a ring of RING px just outside the box."""
    x, y, w, h = box
    W, H = img.size
    x0, y0, x1, y1 = max(0, x - RING), max(0, y - RING), min(W, x + w + RING), min(H, y + h + RING)
    px = img.load()
    rs, gs, bs = [], [], []
    for yy in range(y0, y1):
        for xx in range(x0, x1):
            inside = x <= xx < x + w and y <= yy < y + h
            if inside:
                continue
            r, g, b = px[xx, yy][:3]
            rs.append(r)
            gs.append(g)
            bs.append(b)
    if not rs:
        return (255, 255, 255)
    return (int(statistics.median(rs)), int(statistics.median(gs)), int(statistics.median(bs)))


def blank(src_path, boxes):
    img = Image.open(src_path).convert('RGB')
    colours = [ring_colour(img, b) for b in boxes]  # sample from the untouched original
    d = ImageDraw.Draw(img)
    for (x, y, w, h), c in zip(boxes, colours):
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=c)
    return img


def main():
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
    os.makedirs(OUT, exist_ok=True)
    n = 0
    for a in load_activities():
        if only and a['id'] != only:
            continue
        src = os.path.join(ROOT, 'content', a['figure']['src'])
        boxes = [tuple(int(v) for v in l['box']) for l in a['labels']]
        boxes += [tuple(int(v) for v in c) for c in a.get('cover', [])]  # unnumbered: hides text that would give a label away
        blank(src, boxes).save(os.path.join(OUT, a['id'] + '.png'), optimize=True)
        Image.open(src).convert('RGB').save(os.path.join(OUT, a['id'] + '-full.png'), optimize=True)
        n += 1
    print('blanked %d figure(s)' % n)


if __name__ == '__main__':
    main()
