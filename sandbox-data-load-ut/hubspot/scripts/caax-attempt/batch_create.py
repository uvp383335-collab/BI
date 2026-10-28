import json, os, sys, time, urllib.request, urllib.error
obj, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
T = open(r"C:/Users/Utkarsh/.hubspot/token.txt", encoding="utf-8-sig").read().strip()
H = {"Authorization": "Bearer " + T, "Content-Type": "application/json"}
acct = json.loads(urllib.request.urlopen(urllib.request.Request("https://api.hubapi.com/account-info/v3/details", headers=H)).read())
assert acct["portalId"] == 247726307, acct
recs = [json.loads(l) for l in open(src, encoding="utf-8")]
def post(inputs):
    body = json.dumps({"inputs": inputs}).encode()
    for attempt in range(7):
        try:
            return 200, json.loads(urllib.request.urlopen(urllib.request.Request(
                f"https://api.hubapi.com/crm/v3/objects/{obj}/batch/create", data=body, method="POST", headers=H), timeout=120).read())
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500: time.sleep(2 ** attempt); continue
            return e.code, e.read().decode()[:600]
    return 0, "retries exhausted"
ok = fail = 0
with open(out, "a", encoding="utf-8") as f, open(out + ".errors", "a", encoding="utf-8") as ferr:
    for i in range(0, len(recs), 100):
        chunk = recs[i:i+100]
        code, d = post(chunk)
        if code == 200:
            for r in d["results"]:
                f.write(json.dumps({"ridgeline_id": r["properties"]["ridgeline_id"], "id": r["id"]}) + "\n")
            ok += len(d["results"]); continue
        for r in chunk:  # isolate bad rows
            c1, d1 = post([r])
            if c1 == 200:
                f.write(json.dumps({"ridgeline_id": d1["results"][0]["properties"]["ridgeline_id"], "id": d1["results"][0]["id"]}) + "\n"); ok += 1
            else:
                ferr.write(json.dumps({"ridgeline_id": r["properties"]["ridgeline_id"], "status": c1, "error": d1}) + "\n"); fail += 1
print(obj, "input", len(recs), "created", ok, "failed", fail)
