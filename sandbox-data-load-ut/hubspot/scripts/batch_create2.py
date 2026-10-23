import json, sys, time, socket, urllib.request, urllib.error
obj, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
T = open(r"C:/Users/Utkarsh/.hubspot/token.txt", encoding="utf-8-sig").read().strip()
H = {"Authorization": "Bearer " + T, "Content-Type": "application/json"}
def req(path, body):
    for attempt in range(7):
        try:
            return 200, json.loads(urllib.request.urlopen(urllib.request.Request("https://api.hubapi.com" + path,
                data=json.dumps(body).encode(), method="POST", headers=H), timeout=180).read())
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500: time.sleep(2 ** attempt); continue
            return e.code, e.read().decode()[:600]
        except (TimeoutError, socket.timeout, urllib.error.URLError, ConnectionError) as e:
            return -1, repr(e)
    return 0, "retries exhausted"
def existing(ids):
    s, d = req(f"/crm/v3/objects/{obj}/batch/read", {"idProperty": "ridgeline_id", "properties": ["ridgeline_id"], "inputs": [{"id": x} for x in ids]})
    return {r["properties"]["ridgeline_id"]: r["id"] for r in d.get("results", [])} if s == 200 else None
done = {json.loads(l)["ridgeline_id"] for l in open(out)}
recs = [json.loads(l) for l in open(src, encoding="utf-8") if json.loads(l)["properties"]["ridgeline_id"] not in done]
ok = fail = 0
with open(out, "a", encoding="utf-8") as f, open(out + ".errors", "a", encoding="utf-8") as ferr:
    def log(rid, hid):
        f.write(json.dumps({"ridgeline_id": rid, "id": hid}) + "\n"); f.flush()
    for i in range(0, len(recs), 100):
        chunk = recs[i:i+100]
        for attempt in range(5):
            code, d = req(f"/crm/v3/objects/{obj}/batch/create", {"inputs": chunk})
            if code != -1: break
            time.sleep(5)
            ex = existing([r["properties"]["ridgeline_id"] for r in chunk])
            if ex is None: continue
            for rid, hid in ex.items(): log(rid, hid); ok += 1
            chunk = [r for r in chunk if r["properties"]["ridgeline_id"] not in ex]
            if not chunk: code = 200; d = {"results": []}; break
        if code == 200:
            for r in d["results"]: log(r["properties"]["ridgeline_id"], r["id"]); ok += 1
            continue
        for r in chunk:
            c1, d1 = req(f"/crm/v3/objects/{obj}/batch/create", {"inputs": [r]})
            if c1 == 200: log(d1["results"][0]["properties"]["ridgeline_id"], d1["results"][0]["id"]); ok += 1
            else: ferr.write(json.dumps({"ridgeline_id": r["properties"]["ridgeline_id"], "status": c1, "error": d1}) + "\n"); fail += 1
print(obj, "to create", len(recs), "created", ok, "failed", fail)
