#!/usr/bin/env python3
"""Attach original files to a ProofPay record.

usage: pp_upload.py <upload_link> <file>:<kind>:<ref> [<file>:<kind>:<ref> ...]
  kind: PO | Invoice | POD | E-way bill | GRN | Other
  ref:  the document number printed on it (e.g. DC-921), used to pick the right row

Prints one line per file and exits non-zero if any upload failed.
"""
import json, mimetypes, os, sys, urllib.parse, urllib.request

MIME = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".gif": "image/gif"}


def upload(link, path, kind, ref):
    ext = os.path.splitext(path)[1].lower()
    mime = MIME.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"
    size = os.path.getsize(path)
    if size > 5_000_000:
        return False, f"over 5 MB ({size/1e6:.1f} MB)"
    q = urllib.parse.urlencode({"name": os.path.basename(path), "kind": kind, "ref": ref, "by": "claude"})
    with open(path, "rb") as fh:
        req = urllib.request.Request(f"{link.rstrip('/')}/files?{q}", data=fh.read(), method="POST",
                                     headers={"Content-Type": mime})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            docs = json.load(r).get("documents", [])
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read()[:200].decode(errors='replace')}"
    except Exception as e:  # network refused, timeout, sleeping free-tier server…
        return False, str(e)
    hit = next((d for d in docs if d.get("fileName") == os.path.basename(path)), None)
    return True, f"attached → {hit['kind']} {hit['reference']}" if hit else "attached"


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    link, failed = sys.argv[1], 0
    for spec in sys.argv[2:]:
        path, kind, ref = spec.rsplit(":", 2)
        ok, msg = upload(link, path, kind, ref)
        failed += not ok
        print(f"{'OK ' if ok else 'FAIL'} {os.path.basename(path)}: {msg}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
