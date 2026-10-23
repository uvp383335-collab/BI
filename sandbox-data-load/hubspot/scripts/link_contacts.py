import json, sys
from api import call
ct = {json.loads(l)["ridgeline_id"]: json.loads(l)["id"] for l in open("contacts_created.jsonl")}
links = [json.loads(l) for l in open("contact_company_links.jsonl")]
inputs = [{"from": {"id": ct[l["ridgeline_id"]]}, "to": {"id": l["company_id"]},
           "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 1},
                     {"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 279}]} for l in links]
limit = len(inputs)
start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
ok = fail = 0
with open("link_errors.jsonl", "a") as ferr:
    for i in range(start, limit, 100):
        chunk = inputs[i:min(i+100, limit)]
        s, d = call("POST", "/crm/v4/associations/contacts/companies/batch/create", {"inputs": chunk})
        if s in (200, 201) and not d.get("numErrors"):
            ok += len(chunk)
        else:
            fail += len(chunk); ferr.write(json.dumps({"offset": i, "status": s, "resp": str(d)[:800]}) + "\n")
print("links attempted", limit, "ok", ok, "failed", fail)
