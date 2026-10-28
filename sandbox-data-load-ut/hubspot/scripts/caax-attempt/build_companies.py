import csv, json, sys
SRC = r"D:/Utkarsh/projects/hubspot/BI-main/ridgeline_dataset/hubspot/companies.csv"
DIRECT = ["name","domain","industry","numberofemployees","annualrevenue","city","state",
          "country","phone","createdate","lifecyclestage","salesforceaccountid","region__c"]
n = 0
with open(SRC, encoding="utf-8", newline="") as f, open("companies.jsonl","w",encoding="utf-8") as out:
    for r in csv.DictReader(f):
        props = {k: r[k] for k in DIRECT if r[k] != ""}
        if r["hubspot_owner_id"]:
            props["rl_source_owner_id"] = r["hubspot_owner_id"]
        out.write(json.dumps({"id": r["hs_object_id"], "properties": props}) + "\n")
        n += 1
print(n, file=sys.stderr)
