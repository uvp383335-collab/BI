import csv, json, sys
from api import call
D = "D:/Utkarsh/projects/hubspot/BI-main/ridgeline_dataset/hubspot/"
ca = list(csv.DictReader(open(D + "campaigns.csv", encoding="utf-8", newline="")))
items = list(csv.DictReader(open(D + "campaign_budget_spend_items.csv", encoding="utf-8", newline="")))
name = {r["hs_object_id"]: r["hs_name"] for r in ca}
LOG = "campaigns_created.jsonl"
done = {}
try:
    for l in open(LOG): x = json.loads(l); done[x["source_id"]] = x
except FileNotFoundError: pass
only = set(sys.argv[1:])
def props(r):
    p = {"hs_name": r["hs_name"], "hs_start_date": r["hs_start_date"], "hs_campaign_status": r["hs_campaign_status"],
         "hs_currency_code": r["hs_currency_code"], "rl_source_campaign_id": r["hs_object_id"],
         "salesforce_campaign_id": r["salesforce_campaign_id"], "campaign_type__c": r["campaign_type__c"], "rl_utm": r["hs_utm"]}
    if r["hs_end_date"]: p["hs_end_date"] = r["hs_end_date"]
    if r["hs_audience"]: p["hs_audience"] = r["hs_audience"]
    if r["hs_parent_campaign_id"]:
        p["rl_parent_campaign_id"] = r["hs_parent_campaign_id"]; p["rl_parent_campaign_name"] = name[r["hs_parent_campaign_id"]]
    return p
ok = fail = 0
with open(LOG, "a") as log, open("campaigns_errors.jsonl", "a") as ferr:
    for r in ca:
        sid = r["hs_object_id"]
        if (only and sid not in only) or sid in done: continue
        s, d = call("POST", "/marketing/v3/campaigns", {"properties": props(r)})
        if s not in (200, 201):
            ferr.write(json.dumps({"source_id": sid, "step": "campaign", "status": s, "err": str(d)[:500]}) + "\n"); fail += 1; continue
        guid = d["id"]; got = []
        for it in sorted([i for i in items if i["campaign_guid"] == sid], key=lambda i: (i["item_type"], int(i["order"]))):
            path = "budget" if it["item_type"] == "BUDGET" else "spend"
            s2, d2 = call("POST", f"/marketing/v3/campaigns/{guid}/{path}", {"amount": float(it["amount"]), "name": it["name"], "order": int(it["order"])})
            if s2 in (200, 201): got.append({"type": it["item_type"], "id": d2.get("id")})
            else: ferr.write(json.dumps({"source_id": sid, "step": path, "status": s2, "err": str(d2)[:500]}) + "\n"); fail += 1
        log.write(json.dumps({"source_id": sid, "guid": guid, "items": got}) + "\n"); log.flush(); ok += 1
print("campaigns created", ok, "errors", fail)
