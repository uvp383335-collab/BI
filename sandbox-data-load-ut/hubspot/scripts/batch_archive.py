import json, sys, time, urllib.request, urllib.error
obj, src = sys.argv[1], sys.argv[2]
TOKEN = open(r"C:/Users/Utkarsh/.hubspot/token.txt", encoding="utf-8-sig").read().strip()
ids = [json.loads(l)["id"] for l in open(src)]
url = f"https://api.hubapi.com/crm/v3/objects/{obj}/batch/archive"
done = failed = 0
for i in range(0, len(ids), 100):
    chunk = ids[i:i+100]
    body = json.dumps({"inputs": [{"id": x} for x in chunk]}).encode()
    for attempt in range(6):
        req = urllib.request.Request(url, data=body, method="POST",
              headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=60); done += len(chunk); break
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500: time.sleep(2 ** attempt); continue
            failed += len(chunk); print("HTTP", e.code, e.read()[:300], file=sys.stderr); break
    else:
        failed += len(chunk); print("gave up on chunk", i, file=sys.stderr)
print(obj, "archived", done, "failed", failed)
