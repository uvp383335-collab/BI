import urllib.request, os, json, csv
H={"Authorization":"Bearer "+os.environ["HUBSPOT_ACCESS_TOKEN"]}
def pages(path):
    out=[];after=None
    while True:
        u="https://api.hubapi.com"+path+"?limit=100"+(f"&after={after}" if after else "")
        d=json.loads(urllib.request.urlopen(urllib.request.Request(u,headers=H)).read()); out+=d["results"]
        after=(d.get("paging") or {}).get("next",{}).get("after")
        if not after: return out
owners=pages("/crm/v3/owners"); users=pages("/settings/v3/users")
by={o["email"].lower():o for o in owners}
src=list(csv.DictReader(open(r"D:/Utkarsh/projects/hubspot/BI-main/ridgeline_dataset/hubspot/owners.csv",encoding="utf-8")))
m={s["id"]:by[s["email"].lower()]["id"] for s in src if s["email"].lower() in by}
miss=[s["email"] for s in src if s["email"].lower() not in by]
print("users",len(users),"owners",len(owners),"mapped",len(m),"of",len(src),"unmapped",miss)
for e in miss: print("  user record:",[{k:u.get(k) for k in ("id","email","roleIds","primaryTeamId","superAdmin")} for u in users if u["email"].lower()==e])
json.dump(m,open("owner_map.json","w"),indent=1)
D="D:/Utkarsh/projects/hubspot/BI-main/ridgeline_dataset/hubspot/"
for f in ("companies.csv","contacts.csv","deals.csv"):
    ids={r.get("hubspot_owner_id") for r in csv.DictReader(open(D+f,encoding="utf-8-sig")) if r.get("hubspot_owner_id")}
    print(f,"owner ids used",len(ids),"unmapped",len(ids-set(m)))
