"""Validation checks from section 4 of the loading guide (HubSpot part).

Writes reports/validation_<timestamp>.md and .json under the output dir.
"""
import json
import random
import re
import time
from collections import Counter
from datetime import datetime

from . import transform
from .load import chunks, log

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")


def _norm(value):
    """Compare values the way HubSpot stores them: dates as instants, numbers as numbers."""
    if value is None or value == "":
        return None
    if ISO_DATE.match(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    try:
        return float(value)
    except ValueError:
        return value


class Validator:
    def __init__(self, cfg, hs, maps, sample=None):
        self.cfg = cfg
        self.hs = hs
        self.maps = maps
        self.sample = sample  # None = check every record
        self.results = []

    def check(self, name, passed, detail):
        self.results.append({"check": name, "pass": bool(passed), "detail": detail})
        log(f"{'PASS' if passed else 'FAIL'}  {name}: {detail}")

    def _pick(self, rows):
        if self.sample and len(rows) > self.sample:
            return random.Random(7).sample(rows, self.sample)
        return rows

    def _read(self, object_type, ids, props):
        out = {}
        for batch in chunks(ids, 100):
            res = self.hs.post(f"/crm/v3/objects/{object_type}/batch/read",
                               {"properties": props, "inputs": [{"id": i} for i in batch]})
            for r in res.get("results", []):
                out[r["id"]] = r["properties"]
        return out

    def _links(self, from_type, to_type, ids):
        out = {}
        for batch in chunks(ids, 500):
            res = self.hs.post(f"/crm/v4/associations/{from_type}/{to_type}/batch/read",
                               {"inputs": [{"id": i} for i in batch]})
            for r in res.get("results", []):
                out[str(r["from"]["id"])] = {str(t["toObjectId"]): {a.get("label") for a in t["associationTypes"]}
                                             for t in r["to"]}
        return out

    def compare_fields(self, name, object_type, rows, id_map, skip=()):
        rows = [r for r in self._pick(rows) if r["key"] in id_map]
        props = sorted({k for r in rows for k in r["properties"]} - set(skip))
        got = self._read(object_type, [id_map[r["key"]] for r in rows], props)
        diffs = Counter()
        for r in rows:
            g = got.get(id_map[r["key"]], {})
            for k in props:
                if _norm(r["properties"].get(k)) != _norm(g.get(k)):
                    diffs[k] += 1
        self.check(f"{name}: field values", not diffs,
                   f"{len(rows)} records x {len(props)} fields compared; mismatches: {dict(diffs) or 'none'}")

    def compare_links(self, name, from_type, to_type, links, left, right, need_label=None):
        links = self._pick(links)
        resolvable = [(left[a], right[b]) for a, b in links if a in left and b in right]
        got = self._links(from_type, to_type, sorted({f for f, _ in resolvable}))
        bad = sum(1 for f, t in resolvable
                  if t not in got.get(f, {}) or (need_label and need_label not in got[f][t]))
        self.check(f"{name}: links", bad == 0 and len(resolvable) == len(links),
                   f"{len(links)} source links, {len(resolvable)} resolvable, {bad} wrong or missing"
                   + (f" (each must be '{need_label}')" if need_label else ""))

    def count(self, name, object_type, expected, key_prop):
        total = self.hs.search_total(object_type, [{"propertyName": key_prop, "operator": "HAS_PROPERTY"}])
        self.check(f"{name}: record count", total == expected, f"source {expected}, HubSpot {total}")

    def run(self):
        cfg, maps = self.cfg, self.maps
        owners, stages = maps.load("owners"), maps.load("pipeline_stages")
        src_owners = transform.read_csv(cfg.hubspot_dir / "owners.csv")
        self.check("owners: mapped", len(owners) == len(src_owners), f"source {len(src_owners)}, mapped {len(owners)}")

        src_stages = transform.read_csv(cfg.hubspot_dir / "deal_pipeline_stages.csv")
        pipe = self.hs.get(f"/crm/v3/pipelines/deals/{src_stages[0]['pipeline']}")
        live = {s["id"]: s for s in pipe["stages"]}
        order = [s["id"] for s in sorted(pipe["stages"], key=lambda s: s["displayOrder"])]
        bad = [r["stage_id"] for i, r in enumerate(src_stages)
               if stages.get(r["stage_id"]) not in live
               or live[stages[r["stage_id"]]]["label"] != r["label"]
               or float(live[stages[r["stage_id"]]]["metadata"]["probability"]) != float(r["probability"])
               or order[i] != stages[r["stage_id"]]]
        self.check("pipeline stages", not bad and len(live) == len(src_stages),
                   f"{len(src_stages)} source stages, {len(live)} in HubSpot, mismatched: {bad or 'none'}")

        comp_rows, parents = transform.companies(cfg, owners)
        cont_rows, contact_company = transform.contacts(cfg, owners)
        deal_rows, deal_company, deal_contact = transform.deals(cfg, owners, stages)
        comp, cont, deal = maps.load("companies"), maps.load("contacts"), maps.load("deals")

        self.count("companies", "companies", len(comp_rows), "ridgeline_id")
        self.count("contacts", "contacts", len(cont_rows), "ridgeline_id")
        self.count("deals", "deals", len(deal_rows), "ridgeline_id")
        self.compare_fields("companies", "companies", comp_rows, comp)
        self.compare_fields("contacts", "contacts", cont_rows, cont)
        self.compare_fields("deals", "deals", deal_rows, deal)
        self.compare_links("contact to company", "contacts", "companies", contact_company, cont, comp, "Primary")
        self.compare_links("deal to company", "deals", "companies", deal_company, deal, comp, "Primary")
        self.compare_links("deal to contact", "deals", "contacts", deal_contact, deal, cont)
        self.compare_links("child to parent company", "companies", "companies", parents, comp, comp, "Parent Company")

        type_ids = {s["name"]: s["objectTypeId"] for s in self.hs.get("/crm/v3/schemas").get("results", [])}
        for schema, key, rows, map_name, parent, parent_map in (
                ("rl_lifecycle_change", "rl_change_key", transform.lifecycle_changes(cfg), "lifecycle_changes",
                 "contact", cont),
                ("rl_deal_stage_change", "rl_stage_change_key", transform.deal_stage_changes(cfg, stages),
                 "deal_stage_changes", "deal", deal),
                ("rl_form_submission", "rl_submission_key", transform.form_submissions(cfg), "form_submissions",
                 "contact", cont)):
            if schema not in type_ids:
                self.check(f"{map_name}: custom object", False, f"{schema} not found")
                continue
            ot, m = type_ids[schema], maps.load(map_name)
            self.count(map_name, ot, len(rows), key)
            self.compare_fields(map_name, ot, rows, m)
            self.compare_links(f"{map_name} to {parent}", ot, f"{parent}s",
                               [(r["key"], r[parent]) for r in rows], m, parent_map)

        self._crosswalk(comp)
        self._dates(comp_rows, cont_rows, deal_rows, comp, cont, deal)
        self._goals()
        self._campaigns()
        return self.results

    def _crosswalk(self, comp):
        cw = transform.read_csv(self.cfg.dataset_dir / "answer_key" / "id_crosswalk_customers.csv")
        rows = [r for r in cw if r.get("hubspot_company_id")]
        resolved = [r for r in rows if r["hubspot_company_id"] in comp]
        got = self._read("companies", [comp[r["hubspot_company_id"]] for r in resolved], ["salesforceaccountid"])
        sf_ok = sum(1 for r in resolved
                    if got.get(comp[r["hubspot_company_id"]], {}).get("salesforceaccountid") == r["salesforce_account_id"])
        self.check("crosswalk: HubSpot companies", len(resolved) == len(rows) and sf_ok == len(rows),
                   f"{len(rows)} crosswalk rows, {len(resolved)} resolve, {sf_ok} carry the matching Salesforce Account ID")

    def _dates(self, comp_rows, cont_rows, deal_rows, comp, cont, deal):
        """Oldest and newest records: deals keep native dates; contacts/companies keep them in rl_source_createdate."""
        for name, obj, rows, m, fields in (
                ("deals", "deals", deal_rows, deal, ["createdate", "closedate"]),
                ("contacts", "contacts", cont_rows, cont, ["rl_source_createdate"]),
                ("companies", "companies", comp_rows, comp, ["rl_source_createdate"])):
            key = "createdate" if name == "deals" else "rl_source_createdate"
            ordered = sorted(rows, key=lambda r: r["properties"][key])
            pick = [r for r in ordered[:5] + ordered[-5:] if r["key"] in m]
            got = self._read(obj, [m[r["key"]] for r in pick], fields + ["createdate"])
            bad = sum(1 for r in pick for f in fields
                      if _norm(r["properties"].get(f)) != _norm(got.get(m[r["key"]], {}).get(f)))
            native_today = sum(1 for r in pick
                               if name != "deals" and got.get(m[r["key"]], {}).get("createdate", "")[:10]
                               != r["properties"][key][:10])
            note = (f"; native createdate is the load date on {native_today} of {len(pick)} "
                    "(HubSpot read-only, known deviation)") if name != "deals" else ""
            self.check(f"{name}: historical dates", bad == 0,
                       f"{len(pick)} oldest/newest records, {', '.join(fields)} mismatches: {bad}{note}")

    def _goals(self):
        rows = transform.goals(self.cfg)
        m = self.maps.load("goals")
        got = self._read("goal_targets", [m[r["hs_object_id"]] for r in rows if r["hs_object_id"] in m],
                         ["hs_goal_name", "hs_target_amount", "hs_start_datetime", "hs_end_datetime"])
        by_name = {g["hs_goal_name"]: g for g in got.values()}
        bad = [r["hs_goal_name"] for r in rows
               if r["hs_goal_name"] not in by_name
               or float(by_name[r["hs_goal_name"]]["hs_target_amount"]) != float(r["hs_target_amount"])
               or _norm(by_name[r["hs_goal_name"]]["hs_start_datetime"]) != _norm(r["hs_start_datetime"])
               or _norm(by_name[r["hs_goal_name"]]["hs_end_datetime"]) != _norm(r["hs_end_datetime"])]
        self.check("goals", not bad, f"{len(rows)} source goals, mismatched or missing: {bad or 'none'}")

    def _campaigns(self):
        rows, _ = transform.campaigns(self.cfg)
        m = self.maps.load("campaigns")
        self.check("campaigns: loaded", len(m) == len(rows),
                   f"source {len(rows)}, HubSpot {len(m)}"
                   + ("" if self.cfg.campaigns_enabled else " (campaigns step disabled in config)"))


def write_report(cfg, results, summary=None):
    out = cfg.output_dir / "reports"
    out.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    passed = sum(r["pass"] for r in results)
    lines = [f"# HubSpot load validation, {time.strftime('%Y-%m-%d %H:%M')}", "",
             f"Portal {cfg.portal_id}. {passed} of {len(results)} checks passed.", "",
             "| Check | Result | Detail |", "| --- | --- | --- |"]
    lines += [f"| {r['check']} | {'PASS' if r['pass'] else 'FAIL'} | {r['detail']} |" for r in results]
    if summary:
        lines += ["", "## Load summary", "", "```json", json.dumps(summary, indent=1), "```"]
    md = out / f"validation_{stamp}.md"
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / f"validation_{stamp}.json").write_text(json.dumps({"results": results, "load_summary": summary}, indent=1),
                                                  encoding="utf-8")
    return md
