#!/usr/bin/env python3
"""End-to-end API smoke test. Usage: python3 scripts/api-test.py [base_url]"""
import json, sys, urllib.request, urllib.error, urllib.parse

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
passed, failed = [], []

def call(method, path, body=None, raw=None):
    data = None
    headers = {}
    if raw is not None:
        data = raw.encode()
        headers["Content-Type"] = "text/plain"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, txt

def check(name, cond):
    (passed if cond else failed).append(name)
    print(("  \u2714 " if cond else "  \u2716 ") + name)

print(f"BASE={BASE}\n")

s, h = call("GET", "/api/health")
print("health:", h)
check("health ok", s == 200 and h and h.get("ok") is True)

s, m = call("GET", "/api/meta")
check("meta has coordinators", s == 200 and len(m.get("coordinators", [])) >= 1)
check("meta has statuses", "completed" in m.get("statuses", []))

s, d = call("GET", "/api/dashboard")
check("dashboard kpi.shoots>0", s == 200 and d["kpi"]["shoots"] >= 1)
check("dashboard monthly non-empty", len(d.get("monthly", [])) >= 1)
check("dashboard byCoordinator", len(d.get("byCoordinator", [])) >= 1)
check("dashboard byType", len(d.get("byType", [])) >= 1)

s, rows = call("GET", "/api/shoots")
check("shoots list >0", s == 200 and len(rows) >= 1)

s, r4 = call("GET", "/api/shoots?month=2026-04")
check(f"month=2026-04 filter ({len(r4)} rows)", s == 200 and len(r4) >= 1)
check("month filter all April", all(r["shoot_date"].startswith("2026-04") for r in r4))

s, meta = call("GET", "/api/meta")
coord_names = [c["name"] for c in meta.get("coordinators", [])]
rc_name = coord_names[0] if coord_names else "Riya Saha"
s, rc = call("GET", "/api/shoots?coordinator=" + urllib.parse.quote(rc_name))
check("coordinator filter works", s == 200 and len(rc) >= 1)
check("coordinator filter correct", all((r.get("coordinator") or "") == rc_name for r in rc))

s, rs = call("GET", "/api/shoots?status=completed")
check("status filter works", s == 200 and all(r["status"] == "completed" for r in rs))

s, allrows = call("GET", "/api/shoots")
probe = (allrows[0]["title"].split() or ["shoot"])[0]
s, rq = call("GET", "/api/shoots?q=" + urllib.parse.quote(probe))
check(f"search q={probe} works", s == 200 and len(rq) >= 1)

s, d4 = call("GET", "/api/dashboard?month=2026-04")
check("dashboard month filter", s == 200 and d4["kpi"]["shoots"] >= 1)

# fee range
s, rf = call("GET", "/api/shoots?minFee=40000&maxFee=50000")
check("fee range filter", s == 200 and all(40000 <= float(r["fee"]) <= 50000 for r in rf))

# payment status
s, rp = call("GET", "/api/shoots?paymentStatus=paid")
check("paymentStatus=paid", s == 200 and all(r["payment_status"] == "paid" for r in rp))

print("\n-- CRUD --")
s, created = call("POST", "/api/shoots", {
    "title": "API Test Wedding", "client_name": "Test Client", "shoot_date": "2026-10-01",
    "fee": 10000, "coordinator": "New Coord", "status": "confirmed", "venue": "Test Hall", "location": "Kolkata"})
sid = created.get("id") if created else None
check("create returns id", s == 201 and sid)

# media
s, mm = call("POST", f"/api/shoots/{sid}/media", {"file_url": "https://drive.example/album1", "caption": "Highlights"})
mid = mm.get("id") if mm else None
check("media created", s == 201 and mid)
s, gtmp = call("GET", f"/api/shoots/{sid}")
check("media listed on shoot", len(gtmp.get("media", [])) == 1 and gtmp["media"][0]["caption"] == "Highlights")
call("DELETE", f"/api/media/{mid}")
s, gtmp2 = call("GET", f"/api/shoots/{sid}")
check("media removed", len(gtmp2.get("media", [])) == 0)

s, g = call("GET", f"/api/shoots/{sid}")
check("get shoot title", g.get("title") == "API Test Wedding")
check("coordinator upserted by name", g.get("coordinator") == "New Coord")

s, p = call("POST", f"/api/shoots/{sid}/payments", {"amount": 4000, "paid_on": "2026-10-02", "method": "cash"})
pid = p.get("id") if p else None
check("payment created", s == 201 and pid)

s, g2 = call("GET", f"/api/shoots/{sid}")
check("paid_amount=4000", str(g2.get("paid_amount")) == "4000.00")
check("payment_status=partial", g2.get("payment_status") == "partial")

s, u = call("PUT", f"/api/shoots/{sid}", {"status": "completed", "fee": 12000})
check("update ok", s == 200)
s, g3 = call("GET", f"/api/shoots/{sid}")
check("status now completed", g3.get("status") == "completed")
check("fee now 12000", str(g3.get("fee")) == "12000.00")

call("DELETE", f"/api/payments/{pid}")
s, g4 = call("GET", f"/api/shoots/{sid}")
check("payment removed", str(g4.get("paid_amount")) in ("0", "0.00"))

call("DELETE", f"/api/shoots/{sid}")
s, _ = call("GET", f"/api/shoots/{sid}")
check("shoot deleted (404)", s == 404)

print("\n-- import (API) --")
html = open("data/sample-sheet.html").read()
s, ir = call("POST", "/api/import", {"content": html, "dryRun": True})
check("import dry-run count>=1", s == 200 and ir.get("count", 0) >= 1)
check("dry-run maps coordinator", any(r.get("coordinator") for r in ir.get("rows", [])))
check("dry-run no date problems", not [p for p in ir.get("problems", []) if "date" in p.get("reason", "")])

s, ic = call("POST", "/api/import", {"content": html, "dryRun": False})
check("import commit processed rows", s == 200 and (ic.get("inserted", 0) + ic.get("skipped", 0)) >= 1)
# idempotency
s, ic2 = call("POST", "/api/import", {"content": html, "dryRun": False})
check("re-import is idempotent (0 new)", s == 200 and ic2.get("inserted", 0) == 0 and ic2.get("skipped", 0) >= 1)

print(f"\nRESULT: {len(passed)} passed, {len(failed)} failed")
if failed:
    print("FAILED:", *failed, sep="\n  - ")
sys.exit(1 if failed else 0)
