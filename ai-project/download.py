#!/usr/bin/env python3
"""Water in a bottle – dataset downloader (for a GPU box / any Linux shell).

Pulls the bottle dataset from the private Google Drive behind /ai-project/, through the same
PIN-protected Apps Script web app the data collector uses. Nothing is public: without the PIN
the script gets nothing. It only reads (list / getSample / getImage), so phones that are
uploading at the same time are not affected.

    curl -fsSL https://www.zakatabish.online/ai-project/download.py -o aip_download.py
    python3 aip_download.py --out bottle_dataset            # asks for the PIN (not echoed)

Only the Python 3 standard library is used. Re-running resumes: files already on disk are skipped.

Layout written to --out:
    labels.csv                         one row per image: file, sample, type, weight, volume, status
    samples.json                       the sample list as Drive returned it
    type_<t>/<sampleId>/<image>.jpg    the kept images of every bottle
    type_<t>/<sampleId>/_scale.jpg     the scale photo (only with --scale)
"""
import argparse
import base64
import csv
import getpass
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ENDPOINT = ('https://script.google.com/macros/s/AKfycbw3jBoUxEuVF5vdWmNrKtxpZTqK3wNKpuUcQzmh9UDPOD'
            'gyJEYbTc0SamnMlBIds1Q1zg/exec')
FATAL = {'pin', 'locked', 'not_set_up', 'unknown_action'}   # never retried: a wrong PIN must not be repeated
MESSAGES = {
    'pin': 'Wrong PIN. Stopped after one try so the collectors are not locked out.',
    'locked': 'Too many wrong PINs: the backend is locked for 15 minutes.',
    'not_set_up': 'The Drive backend is not set up (run setup() in the Apps Script editor).',
}


class ApiError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class Client:
    def __init__(self, endpoint, pin, timeout=120, retries=6):
        self.endpoint, self.pin, self.timeout, self.retries = endpoint, pin, timeout, retries

    def call(self, action, **data):
        body = json.dumps(dict(data, action=action, pin=self.pin)).encode('utf-8')
        delay = 2.0
        for attempt in range(self.retries + 1):
            try:
                req = urllib.request.Request(self.endpoint, data=body, method='POST',
                                             headers={'Content-Type': 'text/plain;charset=utf-8'})
                # Apps Script answers 302 -> googleusercontent.com; urllib follows it with a GET, like curl -L.
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    raw = res.read()
                try:
                    j = json.loads(raw.decode('utf-8'))
                except ValueError:
                    raise ApiError('bad_response')
                if not j.get('ok'):
                    raise ApiError(j.get('error') or 'error')
                return j
            except ApiError as e:
                if e.code in FATAL or attempt == self.retries:
                    raise
                err = e.code
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                if attempt == self.retries:
                    raise ApiError('network: %s' % e)
                err = str(e)
            # busy backend (quota, simultaneous executions, network): back off and try again
            time.sleep(delay + random.random())
            delay = min(delay * 2, 60)
        raise ApiError(err)


def safe(name):
    keep = ''.join(c if c.isalnum() or c in '._-' else '_' for c in str(name)).strip('._')
    return keep or 'file'


def write_b64(path, b64):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.part'
    with open(tmp, 'wb') as f:
        f.write(base64.b64decode(b64))
    os.replace(tmp, path)


def have(path):
    return os.path.isfile(path) and os.path.getsize(path) > 0


def main():
    ap = argparse.ArgumentParser(description='Download the Water in a bottle dataset from Drive (PIN protected).')
    ap.add_argument('--out', default='bottle_dataset', help='output folder (default: bottle_dataset)')
    ap.add_argument('--status', choices=['approved', 'labeled', 'all'], default='approved',
                    help='approved = reviewed bottles only (default); labeled = every bottle with a weight; all = everything')
    ap.add_argument('--types', default='', help='only these bottle types, e.g. 1,3')
    ap.add_argument('--samples', default='', help='only these sample ids, comma separated')
    ap.add_argument('--scale', action='store_true', help='also download the scale photo of every bottle')
    ap.add_argument('--workers', type=int, default=3,
                    help='parallel downloads (default 3; keep it low so uploads from the phones stay fast)')
    ap.add_argument('--list', action='store_true', help='only list what would be downloaded')
    ap.add_argument('--endpoint', default=os.environ.get('AIP_ENDPOINT', ENDPOINT))
    a = ap.parse_args()

    pin = os.environ.get('AIP_PIN') or getpass.getpass('PIN for the bottle dataset: ')
    if not pin.strip():
        sys.exit('No PIN given.')
    api = Client(a.endpoint, pin.strip())

    def die(e):
        sys.exit('Stopped: ' + MESSAGES.get(e.code, e.code))

    try:
        api.call('ping')
        listing = api.call('list')
    except ApiError as e:
        die(e)

    types_cfg = (listing.get('config') or {}).get('types') or {}
    samples = listing.get('samples') or []
    want_types = {t.strip() for t in a.types.split(',') if t.strip()}
    want_ids = {s.strip() for s in a.samples.split(',') if s.strip()}

    def keep(s):
        if want_types and str(s.get('type')) not in want_types:
            return False
        if want_ids and s.get('sampleId') not in want_ids:
            return False
        if a.status == 'approved':
            return s.get('reviewStatus') == 'approved'
        if a.status == 'labeled':
            return s.get('weight') is not None
        return True

    chosen = [s for s in samples if keep(s)]
    if a.list:
        print('Bottle types on Drive (approved / all bottles, images):')
        for t in sorted({str(s.get('type')) for s in samples} | set(types_cfg), key=str):
            ss = [s for s in samples if str(s.get('type')) == t]
            ok = [s for s in ss if s.get('reviewStatus') == 'approved']
            print('  type %s  %-42s %3d / %3d bottles  %5d / %5d images' % (
                t, (types_cfg.get(t) or {}).get('description', '')[:42], len(ok), len(ss),
                sum(int(s.get('numImages') or 0) for s in ok), sum(int(s.get('numImages') or 0) for s in ss)))
        print()
    total_imgs = sum(int(s.get('numImages') or 0) for s in chosen)
    print('%d bottles on Drive, %d selected (%s), about %d images.' % (len(samples), len(chosen), a.status, total_imgs))
    if a.list:
        for s in chosen:
            print('  %-14s type %-3s %4s images  weight %-8s %s' % (
                s.get('sampleId'), s.get('type'), s.get('numImages'), s.get('weight'), s.get('reviewStatus')))
        return
    if not chosen:
        return

    os.makedirs(a.out, exist_ok=True)
    sj = os.path.join(a.out, 'samples.json')
    known = {}
    try:
        with open(sj, encoding='utf-8') as f:
            known = {s['sampleId']: s for s in json.load(f).get('samples', [])}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    known.update({s['sampleId']: s for s in chosen})
    with open(sj, 'w', encoding='utf-8') as f:
        json.dump({'config': listing.get('config'), 'samples': sorted(known.values(), key=lambda s: s['sampleId'])},
                  f, indent=1, ensure_ascii=False)

    # 1) image lists per bottle (small calls, no scale photo unless asked)
    jobs, rows = [], []
    for i, s in enumerate(chosen, 1):
        sid, t = s['sampleId'], str(s.get('type'))
        folder = os.path.join(a.out, 'type_' + safe(t), safe(sid))
        try:
            g = api.call('getSample', sampleId=sid, withScale=bool(a.scale))
        except ApiError as e:
            if e.code in FATAL:
                die(e)
            print('  ! %s skipped: %s' % (sid, e.code))
            continue
        info = dict(s, **(g.get('sample') or {}))
        if a.scale and g.get('scale'):
            write_b64(os.path.join(folder, '_scale.jpg'), g['scale'])
        for k, img in enumerate(g.get('images') or [], 1):
            name = safe(img.get('name') or ('%s_%04d' % (sid, k)))
            if not name.lower().endswith(('.jpg', '.jpeg')):
                name += '.jpg'
            path = os.path.join(folder, name)
            jobs.append((img['fileId'], path))
            rows.append({
                'file': os.path.relpath(path, a.out).replace(os.sep, '/'),
                'sample_id': sid, 'type': t,
                'type_description': (types_cfg.get(t) or {}).get('description', ''),
                'weight_g': info.get('weight'), 'volume_ml': info.get('volume'),
                'status': info.get('reviewStatus'), 'drive_file_id': img['fileId'],
            })
        print('  [%d/%d] %s: %d images' % (i, len(chosen), sid, len(g.get('images') or [])))

    # merge with an earlier run (other types / filters), this run's rows win
    labels = os.path.join(a.out, 'labels.csv')
    merged = {}
    if os.path.isfile(labels):
        with open(labels, newline='', encoding='utf-8') as f:
            merged = {r['file']: r for r in csv.DictReader(f) if r.get('file')}
    merged.update({r['file']: r for r in rows})
    fields = ['file', 'sample_id', 'type', 'type_description', 'weight_g', 'volume_ml', 'status', 'drive_file_id']
    with open(labels, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        w.writeheader()
        w.writerows(sorted(merged.values(), key=lambda r: r['file']))

    # 2) the images themselves, a few at a time, resuming what is already on disk
    todo = [(fid, p) for fid, p in jobs if not have(p)]
    print('%d images, %d already on disk, %d to download with %d workers.' % (
        len(jobs), len(jobs) - len(todo), len(todo), a.workers))
    done, failed, lock, t0 = 0, [], threading.Lock(), time.time()

    def fetch(fid, path):
        write_b64(path, api.call('getImage', fileId=fid)['b64'])

    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as pool:
        futs = {pool.submit(fetch, fid, p): (fid, p) for fid, p in todo}
        for fut in as_completed(futs):
            try:
                fut.result()
            except ApiError as e:
                if e.code in FATAL:
                    pool.shutdown(wait=False, cancel_futures=True)
                    die(e)
                failed.append(futs[fut][1])
            with lock:
                done += 1
                if done % 25 == 0 or done == len(todo):
                    rate = done / max(time.time() - t0, 1e-6)
                    print('  %d/%d images  (%.1f/s, %d failed)' % (done, len(todo), rate, len(failed)), flush=True)

    print('Done: %s  (%d images, labels.csv).' % (os.path.abspath(a.out), len(jobs) - len(failed)))
    if failed:
        print('%d images failed; run the same command again to fetch only those.' % len(failed))
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit('\nInterrupted. Run the same command again to resume.')
