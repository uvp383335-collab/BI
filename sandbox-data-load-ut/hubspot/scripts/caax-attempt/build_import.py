import csv, json, sys
from datetime import datetime
DT = {"rl_source_createdate","rl_date_became_subscriber","rl_date_became_lead","rl_date_became_mql","rl_date_became_sql",
      "rl_date_became_opportunity","rl_date_became_customer","rl_first_conversion_date","rl_recent_conversion_date",
      "rl_source_lastmodifieddate"}
recs = [json.loads(l) for l in open("contacts.jsonl", encoding="utf-8")]
for r in recs: r["properties"]["rl_source_createdate"] = r["properties"].pop("createdate")
cols = ["ridgeline_id"] + sorted({k for r in recs for k in r["properties"]})
def ms(v): return str(int(datetime.strptime(v, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=__import__("datetime").timezone.utc).timestamp()*1000))
def write(name, subset):
    with open(name, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f); w.writerow(cols)
        for r in subset:
            p = r["properties"]
            w.writerow([r["id"]] + [ms(p[c]) if c in DT and c in p else p.get(c, "") for c in cols[1:]])
    req = {"name": name.replace(".csv",""), "importOperations": {"0-1": "CREATE"},
           "files": [{"fileName": name, "fileFormat": "CSV",
                      "fileImportPage": {"hasHeader": True, "columnMappings": [
                          {"columnName": c, "propertyName": c, "columnObjectTypeId": "0-1"} for c in cols]}}]}
    json.dump(req, open(name.replace(".csv", "_request.json"), "w"), indent=1)
pilot_ids = {"51000836490"} | {json.loads(l)["id"] for l in open("pilot_contacts.jsonl")}
pilot = [r for r in recs if r["id"] in pilot_ids]
rest = [r for r in recs if r["id"] not in pilot_ids]
write("contacts_pilot2.csv", pilot); write("contacts_full.csv", rest)
print(len(cols), "columns;", len(pilot), "pilot;", len(rest), "full;", "total", len(pilot)+len(rest))
