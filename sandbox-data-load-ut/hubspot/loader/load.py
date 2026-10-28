"""Load steps. Every step is safe to re-run: records are upserted on a unique key,
associations and properties are created only if missing."""
import csv
import json
import time
import uuid

from . import transform
from .client import HubSpotError

STANDARD_OBJECTS = {"companies": "company_props.jsonl", "contacts": "contact_props.jsonl", "deals": "deal_props.jsonl"}


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


class Loader:
    def __init__(self, cfg, hs, maps, limit=None):
        self.cfg = cfg
        self.hs = hs
        self.maps = maps
        self.limit = limit  # load only the first N records per object (smoke tests)
        self.summary = {}

    def _cap(self, rows):
        return rows[: self.limit] if self.limit else rows

    # ------------------------------------------------------------ helpers

    def custom_object_type_ids(self):
        schemas = self.hs.get("/crm/v3/schemas").get("results", [])
        return {s["name"]: s["objectTypeId"] for s in schemas}

    def association_types(self, from_type, to_type):
        """{label or None: (category, typeId)} for a pair of object types."""
        res = self.hs.get(f"/crm/v4/associations/{from_type}/{to_type}/labels").get("results", [])
        return {r.get("label"): (r["category"], r["typeId"]) for r in res}

    def upsert(self, object_type, id_property, rows):
        """Batch upsert keyed on a unique property; returns {key: hubspot_id}."""
        created = updated = 0
        failed = []
        for batch in chunks(rows, self.cfg.batch_size):
            inputs = [{"idProperty": id_property, "id": r["key"], "properties": r["properties"]} for r in batch]
            try:
                res = self.hs.post(f"/crm/v3/objects/{object_type}/batch/upsert", {"inputs": inputs})
                for r in res.get("results", []):
                    created += 1 if r.get("new") else 0
                    updated += 0 if r.get("new") else 1
                for err in res.get("errors", []):
                    failed.append(str(err)[:300])
            except HubSpotError as e:
                # One bad record fails the whole batch; retry one by one to isolate it.
                for one in inputs:
                    try:
                        res = self.hs.post(f"/crm/v3/objects/{object_type}/batch/upsert", {"inputs": [one]})
                        r = res["results"][0]
                        created += 1 if r.get("new") else 0
                        updated += 0 if r.get("new") else 1
                    except HubSpotError as e1:
                        failed.append(f"{one['id']}: {str(e1.body)[:300]}")
        ids = self.resolve_ids(object_type, id_property, [r["key"] for r in rows])
        self.summary[object_type] = {"input": len(rows), "created": created, "updated": updated,
                                     "failed": len(failed), "mapped": len(ids)}
        if failed:
            self.summary[object_type]["errors"] = failed[:20]
        log(f"{object_type}: {self.summary[object_type]}")
        return ids

    def resolve_ids(self, object_type, id_property, keys):
        ids = {}
        for batch in chunks(keys, 100):
            res = self.hs.post(f"/crm/v3/objects/{object_type}/batch/read",
                               {"idProperty": id_property, "properties": [id_property],
                                "inputs": [{"id": k} for k in batch]})
            for r in res.get("results", []):
                ids[r["properties"][id_property]] = r["id"]
        return ids

    def associate(self, from_type, to_type, pairs, types, name):
        """pairs = [(from_id, to_id)]; types = [(category, typeId)]. Creating an existing link is a no-op."""
        type_specs = [{"associationCategory": c, "associationTypeId": t} for c, t in types]
        done = failed = 0
        for batch in chunks(pairs, 100):
            inputs = [{"from": {"id": f}, "to": {"id": t}, "types": type_specs} for f, t in batch]
            res = self.hs.post(f"/crm/v4/associations/{from_type}/{to_type}/batch/create", {"inputs": inputs})
            failed += res.get("numErrors", 0)
            done += len(batch) - res.get("numErrors", 0)
        self.summary[name] = {"input": len(pairs), "linked": done, "failed": failed}
        log(f"{name}: {self.summary[name]}")

    def require_map(self, name):
        m = self.maps.load(name)
        if not m:
            raise SystemExit(f"No id-map '{name}' yet; run the step that creates it first.")
        return m

    # ------------------------------------------------------------ steps

    def step_properties(self):
        d = self.cfg.definitions_dir
        for obj, fname in STANDARD_OBJECTS.items():
            self._ensure_properties(obj, read_jsonl(d / fname))
        schemas = json.loads((d / "custom_objects.json").read_text(encoding="utf-8"))
        existing = self.custom_object_type_ids()
        for name, body in schemas.items():
            if name in existing:
                log(f"custom object {name} exists ({existing[name]})")
                self._ensure_properties(existing[name], body["properties"])
            else:
                res = self.hs.post("/crm/v3/schemas", body)
                log(f"custom object {name} created ({res['objectTypeId']})")
        if self.cfg.campaigns_enabled:
            self._ensure_properties("campaigns", read_jsonl(d / "campaign_props.jsonl"))

    def _ensure_properties(self, obj, defs):
        have = {p["name"] for p in self.hs.get(f"/crm/v3/properties/{obj}").get("results", [])}
        missing = [p for p in defs if p["name"] not in have]
        for p in missing:
            self.hs.post(f"/crm/v3/properties/{obj}", p)
        log(f"properties {obj}: {len(defs) - len(missing)} present, {len(missing)} created")

    def step_owners(self):
        rows = transform.read_csv(self.cfg.hubspot_dir / "owners.csv")
        users = {u["email"].lower() for u in self._all_users()}
        created = 0
        for r in rows:
            if r["email"].lower() in users:
                continue
            self.hs.post("/settings/v3/users", {"email": r["email"], "firstName": r["firstName"],
                                                "lastName": r["lastName"], "sendWelcomeEmail": False})
            created += 1
        # A new user shows up as an owner after a short delay.
        for _ in range(12):
            owners = {o["email"].lower(): o["id"] for o in self._all_pages("/crm/v3/owners")}
            mapping = {r["id"]: owners[r["email"].lower()] for r in rows if r["email"].lower() in owners}
            if len(mapping) == len(rows):
                break
            time.sleep(10)
        missing = [r["email"] for r in rows if r["id"] not in mapping]
        self.maps.save("owners", mapping, ["source_owner_id", "hubspot_owner_id"])
        self.summary["owners"] = {"input": len(rows), "created": created, "mapped": len(mapping), "unmapped": missing}
        log(f"owners: {self.summary['owners']}")
        if missing:
            raise SystemExit(f"Owners not available yet: {missing}")

    def _all_users(self):
        return self._all_pages("/settings/v3/users")

    def _all_pages(self, path):
        out, after = [], None
        while True:
            page = self.hs.get(path, limit=100, **({"after": after} if after else {}))
            out += page.get("results", [])
            after = (page.get("paging") or {}).get("next", {}).get("after")
            if not after:
                return out

    def step_pipeline(self):
        rows = transform.read_csv(self.cfg.hubspot_dir / "deal_pipeline_stages.csv")
        pipeline_id = rows[0]["pipeline"]
        pipe = self.hs.get(f"/crm/v3/pipelines/deals/{pipeline_id}")
        by_id = {s["id"]: s for s in pipe["stages"]}
        by_label = {s["label"]: s for s in pipe["stages"]}
        mapping = {}
        for r in rows:
            closed = r["stage_id"] in ("closedwon", "closedlost")
            meta = {"probability": r["probability"], "isClosed": "true" if closed else "false"}
            if r["stage_id"] in by_id:
                stage = by_id[r["stage_id"]]
            elif r["label"] in by_label:
                stage = by_label[r["label"]]
            else:
                stage = self.hs.post(f"/crm/v3/pipelines/deals/{pipeline_id}/stages",
                                     {"label": r["label"], "displayOrder": int(r["display_order"]), "metadata": meta})
                log(f"stage created: {r['label']} -> {stage['id']}")
            mapping[r["stage_id"]] = stage["id"]
        if self.cfg.remove_unused_default_stages:
            keep = set(mapping.values())
            for s in pipe["stages"]:
                if s["id"] in keep:
                    continue
                in_use = self.hs.search_total("deals", [{"propertyName": "dealstage", "operator": "EQ", "value": s["id"]}])
                if in_use == 0:
                    self.hs.request("DELETE", f"/crm/v3/pipelines/deals/{pipeline_id}/stages/{s['id']}")
                    log(f"unused default stage removed: {s['label']}")
        self.maps.save("pipeline_stages", mapping, ["source_stage_id", "hubspot_stage_id"])
        self.summary["pipeline"] = {"stages": len(mapping)}
        log(f"pipeline: {mapping}")

    def step_companies(self):
        rows, _ = transform.companies(self.cfg, self.require_map("owners"))
        ids = self.upsert("companies", "ridgeline_id", self._cap(rows))
        self.maps.save("companies", {**self.maps.load("companies"), **ids}, ["ridgeline_id", "hubspot_company_id"])

    def step_contacts(self):
        rows, _ = transform.contacts(self.cfg, self.require_map("owners"))
        ids = self.upsert("contacts", "ridgeline_id", self._cap(rows))
        self.maps.save("contacts", {**self.maps.load("contacts"), **ids}, ["ridgeline_id", "hubspot_contact_id"])

    def step_deals(self):
        rows, _, _ = transform.deals(self.cfg, self.require_map("owners"), self.require_map("pipeline_stages"))
        ids = self.upsert("deals", "ridgeline_id", self._cap(rows))
        self.maps.save("deals", {**self.maps.load("deals"), **ids}, ["ridgeline_id", "hubspot_deal_id"])

    def step_associations(self):
        owners = self.require_map("owners")
        stages = self.require_map("pipeline_stages")
        comp, cont, deal = self.require_map("companies"), self.require_map("contacts"), self.require_map("deals")
        _, parents = transform.companies(self.cfg, owners)
        _, contact_company = transform.contacts(self.cfg, owners)
        _, deal_company, deal_contact = transform.deals(self.cfg, owners, stages)

        def pairs(links, left, right):
            return [(left[a], right[b]) for a, b in self._cap(links) if a in left and b in right]

        cc = self.association_types("contacts", "companies")
        self.associate("contacts", "companies", pairs(contact_company, cont, comp), [cc["Primary"], cc[None]], "contact_to_company")
        dc = self.association_types("deals", "companies")
        self.associate("deals", "companies", pairs(deal_company, deal, comp), [dc["Primary"], dc[None]], "deal_to_company")
        dt = self.association_types("deals", "contacts")
        self.associate("deals", "contacts", pairs(deal_contact, deal, cont), [dt[None]], "deal_to_contact")
        pc = self.association_types("companies", "companies")
        self.associate("companies", "companies", pairs(parents, comp, comp), [pc["Parent Company"]], "child_to_parent_company")

        # HubSpot's built-in deal lifecycle sync promotes companies/contacts linked to a
        # Closed Won deal to "customer". The source keeps some of them at an earlier
        # stage, so put those back. Only records linked to deals can be affected.
        comp_rows, _ = transform.companies(self.cfg, owners)
        cont_rows, _ = transform.contacts(self.cfg, owners)
        deal_companies = {b for _, b in deal_company}
        deal_contacts = {b for _, b in deal_contact}
        self.restore_lifecycle("companies", comp, [r for r in comp_rows if r["key"] in deal_companies])
        self.restore_lifecycle("contacts", cont, [r for r in cont_rows if r["key"] in deal_contacts])

    def restore_lifecycle(self, object_type, id_map, rows):
        """Set lifecyclestage back to the source value where HubSpot changed it.

        Lifecycle stage only moves forward, so it is cleared first, then set."""
        want = {id_map[r["key"]]: r["properties"].get("lifecyclestage", "") for r in self._cap(rows) if r["key"] in id_map}
        wrong = {}
        for batch in chunks(list(want), 100):
            res = self.hs.post(f"/crm/v3/objects/{object_type}/batch/read",
                               {"properties": ["lifecyclestage"], "inputs": [{"id": i} for i in batch]})
            for r in res.get("results", []):
                if (r["properties"].get("lifecyclestage") or "") != want[r["id"]]:
                    wrong[r["id"]] = want[r["id"]]
        for batch in chunks(list(wrong), 100):
            self.hs.post(f"/crm/v3/objects/{object_type}/batch/update",
                         {"inputs": [{"id": i, "properties": {"lifecyclestage": ""}} for i in batch]})
            self.hs.post(f"/crm/v3/objects/{object_type}/batch/update",
                         {"inputs": [{"id": i, "properties": {"lifecyclestage": wrong[i]}} for i in batch]})
        self.summary[f"{object_type}_lifecycle_restored"] = {"checked": len(want), "restored": len(wrong)}
        log(f"{object_type} lifecycle restored after deal sync: {self.summary[f'{object_type}_lifecycle_restored']}")

    def _custom_records(self, schema_name, key_prop, rows, map_name, parent="contact"):
        """Upserts the records, then links each to its parent record (row[parent], e.g. row["contact"])."""
        type_ids = self.custom_object_type_ids()
        if schema_name not in type_ids:
            raise SystemExit(f"Custom object {schema_name} missing; run the properties step first.")
        ot = type_ids[schema_name]
        rows = self._cap(rows)
        ids = self.upsert(ot, key_prop, rows)
        self.maps.save(map_name, {**self.maps.load(map_name), **ids}, [key_prop, "hubspot_record_id"])
        parent_type = f"{parent}s"
        parents = self.require_map(parent_type)
        types = self.association_types(ot, parent_type)
        self.associate(ot, parent_type, [(ids[r["key"]], parents[r[parent]]) for r in rows
                                         if r["key"] in ids and r[parent] in parents],
                       [types[None]], f"{map_name}_to_{parent}")

    def step_lifecycle_changes(self):
        self._custom_records("rl_lifecycle_change", "rl_change_key", transform.lifecycle_changes(self.cfg), "lifecycle_changes")

    def step_deal_stage_changes(self):
        rows = transform.deal_stage_changes(self.cfg, self.require_map("pipeline_stages"))
        self._custom_records("rl_deal_stage_change", "rl_stage_change_key", rows, "deal_stage_changes", parent="deal")

    def step_form_submissions(self):
        self._custom_records("rl_form_submission", "rl_submission_key", transform.form_submissions(self.cfg), "form_submissions")

    def step_goals(self):
        """Goals have no unique key, so existing ones are matched on name + start date."""
        rows = transform.goals(self.cfg)
        owners = self.require_map("owners")
        existing = {}
        for g in self.hs.list_all("goal_targets", ["hs_goal_name", "hs_start_datetime"]):
            existing[(g["properties"]["hs_goal_name"], g["properties"]["hs_start_datetime"][:10])] = g["id"]
        mapping = {r["hs_object_id"]: existing[(r["hs_goal_name"], r["hs_start_datetime"][:10])]
                   for r in rows if (r["hs_goal_name"], r["hs_start_datetime"][:10]) in existing}
        todo = [r for r in rows if r["hs_object_id"] not in mapping]
        if todo:
            # The source assigns these to a team; teams can't be created by API, so the
            # goal goes to the user who created it in the source.
            owner = owners[todo[0]["hs_created_by_user_id"]]
            user_id = self.hs.get(f"/crm/v3/owners/{owner}").get("userId")
            corr = str(uuid.uuid4())
            inputs = [{"properties": {
                "hs_goal_name": r["hs_goal_name"], "hs_milestone": "quarterly", "hs_goal_type": "contact_lifecycle",
                "hs_contact_lifecycle_stage": "marketingqualifiedlead", "hs_target_amount": r["hs_target_amount"],
                "hs_start_datetime": r["hs_start_datetime"], "hs_end_datetime": r["hs_end_datetime"],
                "hs_group_correlation_uuid": corr, "hs_goal_target_group_id": todo[0]["hs_object_id"],
                "hubspot_owner_id": owner, "hs_assignee_user_id": str(user_id)}} for r in todo]
            res = self.hs.post("/crm/v3/objects/goal_targets/batch/create", {"inputs": inputs})
            by_name = {r["hs_goal_name"]: r["hs_object_id"] for r in rows}
            for g in res.get("results", []):
                mapping[by_name[g["properties"]["hs_goal_name"]]] = g["id"]
        self.maps.save("goals", mapping, ["source_goal_id", "hubspot_goal_target_id"])
        self.summary["goals"] = {"input": len(rows), "created": len(todo), "mapped": len(mapping)}
        log(f"goals: {self.summary['goals']}")

    def step_campaigns(self):
        if not self.cfg.campaigns_enabled:
            log("campaigns: skipped (campaigns.enabled is false in config)")
            return
        rows, items = transform.campaigns(self.cfg)
        existing = {}
        after = None
        while True:
            params = {"limit": 100, "properties": ["rl_source_campaign_id"]}
            if after:
                params["after"] = after
            page = self.hs.get("/marketing/v3/campaigns", **params)
            for c in page.get("results", []):
                sid = (c.get("properties") or {}).get("rl_source_campaign_id")
                if sid:
                    existing[sid] = c["id"]
            after = (page.get("paging") or {}).get("next", {}).get("after")
            if not after:
                break
        created = failed = 0
        for r in self._cap(rows):
            if r["key"] in existing:
                continue
            try:
                guid = self.hs.post("/marketing/v3/campaigns", {"properties": r["properties"]})["id"]
            except HubSpotError as e:
                failed += 1
                log(f"campaign {r['key']} failed: {str(e.body)[:200]}")
                continue
            existing[r["key"]] = guid
            created += 1
            # Budget and spend items are added only to campaigns created in this run,
            # so a re-run never doubles them.
            for it in sorted(items.get(r["key"], []), key=lambda i: (i["item_type"], int(i["order"]))):
                path = "budget" if it["item_type"] == "BUDGET" else "spend"
                self.hs.post(f"/marketing/v3/campaigns/{guid}/{path}",
                             {"amount": float(it["amount"]), "name": it["name"], "order": int(it["order"])})
        self.maps.save("campaigns", existing, ["source_campaign_guid", "hubspot_campaign_guid"])
        self.summary["campaigns"] = {"input": len(rows), "created": created, "failed": failed, "mapped": len(existing)}
        log(f"campaigns: {self.summary['campaigns']}")
