"""Wipes what the loader created so the sandbox can be reloaded (e.g. after the
dataset is regenerated with a new seed).

Only records the loader owns are touched: standard records carrying ridgeline_id,
every record of the rl_* custom objects, goals in the goals id-map and campaigns
carrying rl_source_campaign_id. Users and schemas are removed only when asked.
"""
import json

from . import transform
from .load import chunks, log, read_jsonl, STANDARD_OBJECTS


def _ids(hs, object_type, key_prop=None, count_only=False):
    """IDs to delete, or just how many when count_only (dry run: one search call instead of a full listing)."""
    if count_only:
        filters = [{"propertyName": key_prop, "operator": "HAS_PROPERTY"}] if key_prop else []
        return range(hs.search_total(object_type, filters))
    props = [key_prop] if key_prop else []
    return [r["id"] for r in hs.list_all(object_type, props) if not key_prop or r["properties"].get(key_prop)]


def plan(cfg, hs, maps, count_only=False):
    """What would be deleted, in delete order (children first)."""
    schemas = {s["name"]: s["objectTypeId"] for s in hs.get("/crm/v3/schemas").get("results", [])}
    targets = []
    for name in ("rl_form_submission", "rl_lifecycle_change"):
        if name in schemas:
            targets.append((name, schemas[name], _ids(hs, schemas[name], count_only=count_only)))
    for obj in ("deals", "contacts", "companies"):
        targets.append((obj, obj, _ids(hs, obj, "ridgeline_id", count_only)))
    goal_ids = list(maps.load("goals").values())
    targets.append(("goals", "goal_targets", goal_ids))
    campaigns = []
    after = None
    while True:
        params = {"limit": 100, "properties": ["rl_source_campaign_id"]}
        if after:
            params["after"] = after
        page = hs.get("/marketing/v3/campaigns", **params)
        campaigns += [c["id"] for c in page.get("results", []) if (c.get("properties") or {}).get("rl_source_campaign_id")]
        after = (page.get("paging") or {}).get("next", {}).get("after")
        if not after:
            break
    targets.append(("campaigns", "campaigns", campaigns))
    return targets, schemas


def run(cfg, hs, maps, dry_run=True, include_users=False, include_schema=False):
    targets, schemas = plan(cfg, hs, maps, count_only=dry_run)
    for name, _, ids in targets:
        log(f"{'would delete' if dry_run else 'deleting'} {name}: {len(ids)}")
    owner_emails = {r["email"].lower() for r in transform.read_csv(cfg.hubspot_dir / "owners.csv")}
    users = []
    if include_users:
        after = None
        while True:
            page = hs.get("/settings/v3/users", limit=100, **({"after": after} if after else {}))
            users += [u for u in page.get("results", []) if u["email"].lower() in owner_emails]
            after = (page.get("paging") or {}).get("next", {}).get("after")
            if not after:
                break
    if include_users:
        log(f"{'would delete' if dry_run else 'deleting'} users from owners.csv: {len(users)}")
    if include_schema:
        log(f"{'would delete' if dry_run else 'deleting'} custom objects {sorted(n for n in schemas if n.startswith('rl_'))} "
            "and the custom properties in property-definitions/")
    if dry_run:
        return

    for name, object_type, ids in targets:
        if name == "campaigns":
            for guid in ids:
                hs.request("DELETE", f"/marketing/v3/campaigns/{guid}")
        else:
            for batch in chunks(ids, 100):
                hs.post(f"/crm/v3/objects/{object_type}/batch/archive", {"inputs": [{"id": i} for i in batch]})
        log(f"deleted {name}: {len(ids)}")
    for name in ("form_submissions", "lifecycle_changes", "deals", "contacts", "companies", "goals", "campaigns"):
        maps.save(name, {}, ["source_id", "hubspot_id"])

    for u in users:
        hs.request("DELETE", f"/settings/v3/users/{u['id']}")
    if users:
        maps.save("owners", {}, ["source_owner_id", "hubspot_owner_id"])
        log(f"deleted users: {len(users)}")

    if include_schema:
        for name, ot in schemas.items():
            if name.startswith("rl_"):
                hs.request("DELETE", f"/crm/v3/schemas/{ot}")
                hs.request("DELETE", f"/crm/v3/schemas/{ot}/purge")
                log(f"deleted custom object {name}")
        defs = {obj: read_jsonl(cfg.definitions_dir / f) for obj, f in STANDARD_OBJECTS.items()}
        defs["campaigns"] = read_jsonl(cfg.definitions_dir / "campaign_props.jsonl")
        for obj, props in defs.items():
            have = {p["name"] for p in hs.get(f"/crm/v3/properties/{obj}").get("results", [])}
            names = [p["name"] for p in props if p["name"] in have]
            if names:
                hs.post(f"/crm/v3/properties/{obj}/batch/archive", {"inputs": [{"name": n} for n in names]})
            log(f"archived {len(names)} custom properties on {obj}")
