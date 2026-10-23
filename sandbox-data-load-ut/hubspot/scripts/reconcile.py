import json, sys
from api import call
obj, src, log = sys.argv[1], sys.argv[2], sys.argv[3]
done = {json.loads(l)["ridgeline_id"] for l in open(log)}
want = [json.loads(l)["properties"]["ridgeline_id"] for l in open(src, encoding="utf-8")]
missing = [r for r in want if r not in done]
found = 0
with open(log, "a") as f:
    for i in range(0, len(missing), 100):
        s, d = call("POST", f"/crm/v3/objects/{obj}/batch/read",
                    {"idProperty": "ridgeline_id", "properties": ["ridgeline_id"], "inputs": [{"id": x} for x in missing[i:i+100]]})
        for r in d.get("results", []) if isinstance(d, dict) else []:
            f.write(json.dumps({"ridgeline_id": r["properties"]["ridgeline_id"], "id": r["id"]}) + "\n"); found += 1
print("missing from log", len(missing), "found already in HubSpot", found, "still to create", len(missing) - found)
