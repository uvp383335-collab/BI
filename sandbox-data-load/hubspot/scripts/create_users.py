import urllib.request, os, urllib.error, json, csv, time, sys
T = os.environ["HUBSPOT_ACCESS_TOKEN"]; H = {"Authorization": "Bearer " + T, "Content-Type": "application/json"}
acct = json.loads(urllib.request.urlopen(urllib.request.Request("https://api.hubapi.com/account-info/v3/details", headers=H)).read())
assert acct["portalId"] == 247726307 and acct["accountType"] == "DEVELOPER_TEST", acct
rows = list(csv.DictReader(open(r"D:/Utkarsh/projects/hubspot/BI-main/ridgeline_dataset/hubspot/owners.csv", encoding="utf-8")))
limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(rows)
existing = {u["email"].lower() for u in json.loads(urllib.request.urlopen(urllib.request.Request("https://api.hubapi.com/settings/v3/users?limit=100", headers=H)).read())["results"]}
out = open("users_created_test.jsonl", "a"); ok = skipped = 0
for r in rows[:limit]:
    if r["email"].lower() in existing: skipped += 1; continue
    body = json.dumps({"email": r["email"], "firstName": r["firstName"], "lastName": r["lastName"], "sendWelcomeEmail": False}).encode()
    for attempt in range(5):
        try:
            d = json.loads(urllib.request.urlopen(urllib.request.Request("https://api.hubapi.com/settings/v3/users", data=body, method="POST", headers=H)).read())
            out.write(json.dumps({"source_owner_id": r["id"], "email": r["email"], "user_id": d["id"]}) + "\n"); out.flush(); ok += 1; break
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(2 ** attempt); continue
            print("STOP at", r["email"], e.code, e.read()[:400]); print("created", ok, "skipped", skipped); raise SystemExit(1)
print("created", ok, "skipped(existing)", skipped, "of", limit)
