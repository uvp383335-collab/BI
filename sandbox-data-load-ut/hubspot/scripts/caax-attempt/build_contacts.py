import csv, json
D = "D:/Utkarsh/projects/hubspot/BI-main/ridgeline_dataset/hubspot/"
DIRECT = ["email","firstname","lastname","jobtitle","phone","company","createdate","lifecyclestage","hs_lead_status"]
RENAME = {
    "hs_lifecyclestage_subscriber_date": "rl_date_became_subscriber",
    "hs_lifecyclestage_lead_date": "rl_date_became_lead",
    "hs_lifecyclestage_marketingqualifiedlead_date": "rl_date_became_mql",
    "hs_lifecyclestage_salesqualifiedlead_date": "rl_date_became_sql",
    "hs_lifecyclestage_opportunity_date": "rl_date_became_opportunity",
    "hs_lifecyclestage_customer_date": "rl_date_became_customer",
    "hs_analytics_source": "rl_original_source",
    "hs_analytics_source_data_1": "rl_original_source_data_1",
    "hs_analytics_source_data_2": "rl_original_source_data_2",
    "hs_latest_source": "rl_latest_source",
    "hubspotscore": "rl_hubspot_score",
    "salesforceleadid": "salesforceleadid",
    "salesforcecontactid": "salesforcecontactid",
    "hubspot_owner_id": "rl_source_owner_id",
    "associatedcompanyid": "rl_source_company_id",
    "first_conversion_event_name": "rl_first_conversion_event_name",
    "first_conversion_date": "rl_first_conversion_date",
    "recent_conversion_event_name": "rl_recent_conversion_event_name",
    "recent_conversion_date": "rl_recent_conversion_date",
    "num_conversion_events": "rl_num_conversion_events",
    "hs_email_optout": "rl_email_optout",
    "ip_country": "rl_ip_country",
    "lastmodifieddate": "rl_source_lastmodifieddate",
}
companies = {r["hs_object_id"]: r["domain"].lower()
             for r in csv.DictReader(open(D + "companies.csv", encoding="utf-8", newline=""))}
portal = {}
for l in open("portal_companies.jsonl", encoding="utf-8"):
    p = json.loads(l); portal[p["properties"]["domain"].lower()] = p["id"]

rows = sorted(csv.DictReader(open(D + "contacts.csv", encoding="utf-8", newline="")), key=lambda r: r["createdate"])
seen, dups = set(), []
with open("contacts.jsonl", "w", encoding="utf-8") as out, open("contact_company_map.jsonl", "w", encoding="utf-8") as amap:
    for r in rows:
        props = {k: r[k] for k in DIRECT if r[k] != ""}
        props.update({dst: r[src] for src, dst in RENAME.items() if r[src] != ""})
        e = r["email"].lower()
        if e in seen:
            props.pop("email"); props["rl_duplicate_email"] = r["email"]; dups.append(r["hs_object_id"])
        seen.add(e)
        out.write(json.dumps({"id": r["hs_object_id"], "properties": props}) + "\n")
        amap.write(json.dumps({"ridgeline_id": r["hs_object_id"], "company_id": portal[companies[r["associatedcompanyid"]]]}) + "\n")
print(len(rows), "contacts; duplicates without email:", dups)
