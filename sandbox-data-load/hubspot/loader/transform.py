"""Turns the Ridgeline source CSVs into HubSpot payloads.

These are the exact mapping rules used for the verified load of 2026-10-18.
Read-only / calculated HubSpot fields are kept in rl_* custom properties
(sandbox only, per the loading guide); the production connector reads the
native fields.
"""
import csv
from collections import defaultdict


def read_csv(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _owner(source_owner_id, owner_map):
    if not source_owner_id:
        return None
    if source_owner_id not in owner_map:
        raise KeyError(f"Owner {source_owner_id} has no HubSpot owner; run the owners step first")
    return owner_map[source_owner_id]


# ---------------------------------------------------------------- companies

COMPANY_DIRECT = ["name", "domain", "industry", "numberofemployees", "annualrevenue", "city", "state",
                  "country", "phone", "lifecyclestage", "salesforceaccountid", "region__c"]


def companies(cfg, owner_map):
    rows = read_csv(cfg.hubspot_dir / "companies.csv")
    owners = {r["hs_object_id"]: r.get("hubspot_owner_id", "") for r in rows}
    patch = cfg.patches_dir / "companies_hubspot_owner_id.csv"
    if "hubspot_owner_id" not in rows[0] and patch.exists():
        # companies.csv was re-saved without this column on 2026-10-18; the
        # original values are kept in source-patches/.
        owners.update({r["hs_object_id"]: r["hubspot_owner_id"] for r in read_csv(patch)})
    out, parents = [], []
    for r in rows:
        p = {k: r[k] for k in COMPANY_DIRECT if r.get(k)}
        p["rl_source_createdate"] = r["createdate"]
        p["ridgeline_id"] = r["hs_object_id"]
        owner = _owner(owners.get(r["hs_object_id"]), owner_map)
        if owner:
            p["hubspot_owner_id"] = owner
        out.append({"key": r["hs_object_id"], "properties": p})
        if r.get("hs_parent_company_id"):
            parents.append((r["hs_object_id"], r["hs_parent_company_id"]))
    return out, parents


# ---------------------------------------------------------------- contacts

CONTACT_DIRECT = ["email", "firstname", "lastname", "jobtitle", "phone", "company", "lifecyclestage", "hs_lead_status"]
CONTACT_RENAME = {
    "createdate": "rl_source_createdate",
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


def contacts(cfg, owner_map):
    """Final lifecycle stage is set once (forward-only rule); history lives in rl_* fields.

    Email must be unique: when an email repeats, the earlier-created contact keeps
    it and later ones are loaded without it, the address kept in rl_duplicate_email.
    """
    rows = sorted(read_csv(cfg.hubspot_dir / "contacts.csv"), key=lambda r: r["createdate"])
    seen, out, company_links = set(), [], []
    for r in rows:
        p = {k: r[k] for k in CONTACT_DIRECT if r.get(k)}
        p.update({dst: r[src] for src, dst in CONTACT_RENAME.items() if r.get(src)})
        owner = _owner(r.get("hubspot_owner_id"), owner_map)
        if owner:
            p["hubspot_owner_id"] = owner
        p["ridgeline_id"] = r["hs_object_id"]
        email = r["email"].lower()
        if email and email in seen:
            p.pop("email")
            p["rl_duplicate_email"] = r["email"]
        seen.add(email)
        out.append({"key": r["hs_object_id"], "properties": p})
        if r.get("associatedcompanyid"):
            company_links.append((r["hs_object_id"], r["associatedcompanyid"]))
    return out, company_links


# ---------------------------------------------------------------- deals

DEAL_MAP = {
    "dealname": "dealname", "amount": "amount", "pipeline": "pipeline", "closedate": "closedate",
    "createdate": "createdate", "dealtype": "dealtype",
    "hs_analytics_source": "rl_original_source", "hs_analytics_source_data_1": "rl_original_source_data_1",
    "salesforceopportunityid": "salesforceopportunityid", "salesforce_type__c": "salesforce_type__c",
    "hs_arr": "rl_arr", "hs_closed_lost_reason": "closed_lost_reason",
}


def deals(cfg, owner_map, stage_map):
    """hs_is_closed / hs_is_closed_won are calculated by HubSpot from the stage, so not sent."""
    out, company_links, contact_links = [], [], []
    for r in read_csv(cfg.hubspot_dir / "deals.csv"):
        p = {dst: r[src] for src, dst in DEAL_MAP.items() if r.get(src)}
        p["rl_source_createdate"] = r["createdate"]
        p["dealstage"] = stage_map[r["dealstage"]]
        p["ridgeline_id"] = r["hs_object_id"]
        owner = _owner(r.get("hubspot_owner_id"), owner_map)
        if owner:
            p["hubspot_owner_id"] = owner
        out.append({"key": r["hs_object_id"], "properties": p})
        if r.get("associated_company_id"):
            company_links.append((r["hs_object_id"], r["associated_company_id"]))
        for cid in filter(None, r.get("associated_contact_ids", "").split(";")):
            contact_links.append((r["hs_object_id"], cid))
    return out, company_links, contact_links


# ---------------------------------------------------------------- custom objects

def _sequenced(rows, contact_col, time_col):
    by_contact = defaultdict(list)
    for i, r in enumerate(rows):
        by_contact[r[contact_col]].append((r[time_col], i, r))
    for cid, items in by_contact.items():
        for seq, (_, _, r) in enumerate(sorted(items), 1):
            yield cid, seq, r


def lifecycle_changes(cfg):
    """One record per history row; key = contact ID + order of the change. Empty value = 'cleared'."""
    rows = read_csv(cfg.hubspot_dir / "contact_property_history_lifecyclestage.csv")
    out = []
    for cid, seq, r in _sequenced(rows, "hs_object_id", "timestamp"):
        p = {"rl_change_key": f"{cid}-{seq}", "stage": r["value"] or "cleared", "changed_at": r["timestamp"],
             "source_type": r["source_type"], "sequence": str(seq), "contact_ridgeline_id": cid}
        if r.get("source_id"):
            p["source_id"] = r["source_id"]
        out.append({"key": p["rl_change_key"], "properties": p, "contact": cid})
    return out


def form_submissions(cfg):
    rows = read_csv(cfg.hubspot_dir / "form_submissions.csv")
    out = []
    for cid, seq, r in _sequenced(rows, "contact_id", "submitted_at"):
        p = {"rl_submission_key": f"{cid}-{seq}", "form_name": r["form_name"], "form_guid": r["form_guid"],
             "page_url": r["page_url"], "submitted_at": r["submitted_at"], "sequence": str(seq),
             "contact_ridgeline_id": cid}
        out.append({"key": p["rl_submission_key"], "properties": p, "contact": cid})
    return out


# ---------------------------------------------------------------- goals and campaigns

def goals(cfg):
    return read_csv(cfg.hubspot_dir / "goal_targets.csv")


def campaigns(cfg):
    rows = read_csv(cfg.hubspot_dir / "campaigns.csv")
    names = {r["hs_object_id"]: r["hs_name"] for r in rows}
    out = []
    for r in rows:
        name = r["hs_name"]
        for bad, good in cfg.campaign_name_replacements.items():
            name = name.replace(bad, good)
        p = {"hs_name": name, "hs_start_date": r["hs_start_date"], "hs_campaign_status": r["hs_campaign_status"],
             "hs_currency_code": r["hs_currency_code"], "rl_source_campaign_id": r["hs_object_id"],
             "rl_source_campaign_name": r["hs_name"], "salesforce_campaign_id": r["salesforce_campaign_id"],
             "campaign_type__c": r["campaign_type__c"], "rl_utm": r["hs_utm"]}
        if r.get("hs_end_date"):
            p["hs_end_date"] = r["hs_end_date"]
        if r.get("hs_audience"):
            p["hs_audience"] = r["hs_audience"]
        if r.get("hs_parent_campaign_id"):
            p["rl_parent_campaign_id"] = r["hs_parent_campaign_id"]
            p["rl_parent_campaign_name"] = names[r["hs_parent_campaign_id"]]
        out.append({"key": r["hs_object_id"], "properties": p})
    items = defaultdict(list)
    for it in read_csv(cfg.hubspot_dir / "campaign_budget_spend_items.csv"):
        items[it["campaign_guid"]].append(it)
    return out, items
