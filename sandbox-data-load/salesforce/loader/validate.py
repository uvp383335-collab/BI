"""Validation checks from section 4 of the loading guide (Salesforce part).

Writes reports/validation_<timestamp>.md and .json under the output dir.
"""
import json
import random
import time

from .load import OBJECTS, log
from .transform import ADDRESS_CODES, SPECS, Transformer, norm as _norm, read_csv

# Salesforce stamps LastModifiedDate on every later write (lead conversion, the restore after it),
# so it is reported separately instead of failing the field check.
INFO_ONLY = {"LastModifiedDate"}


class Validator:
    def __init__(self, cfg, sf, maps, sample=None):
        self.cfg = cfg
        self.sf = sf
        self.maps = maps
        self.sample = sample  # None = check every record
        self.results = []
        username = cfg.owner_username or sf.username
        self.owner_id = next(sf.query_all(f"SELECT Id FROM User WHERE Username = '{username}'"))["Id"]
        address_codes = "BillingStateCode" in {f["name"] for f in sf.describe("Account")["fields"]}
        self._maps = {}
        self.tx = Transformer(self, self.owner_id, address_codes=address_codes)

    def __getitem__(self, name):  # map lookup for the transformer
        if name not in self._maps:
            self._maps[name] = self.maps.load(name)
        return self._maps[name]

    def check(self, name, passed, detail):
        self.results.append({"check": name, "pass": bool(passed), "detail": detail})
        log(f"{'PASS' if passed else 'FAIL'}  {name}: {detail}")

    def source(self, name):
        rows = read_csv(self.cfg.salesforce_dir / OBJECTS[name][0])
        if name == "users":  # the loader adds the role name the same way
            roles = {r["Id"]: r["Name"] for r in read_csv(self.cfg.salesforce_dir / "UserRole.csv")}
            for r in rows:
                r["RoleName"] = roles.get(r["UserRoleId"], "")
        return rows

    def run(self):
        for name in OBJECTS:
            self.counts(name)
        self.pricebook_entries()
        for name in OBJECTS:
            self.fields(name)
        self.owners()
        self.conversion()
        self.crosswalk()
        self.dates()
        return self.results

    # -- checks ----------------------------------------------------------------
    def counts(self, name):
        sobject = OBJECTS[name][1]
        src = len(self.source(name))
        got = self.sf.count(f"FROM {sobject} WHERE Ridgeline_Id__c != null")
        self.check(f"{name}: record count", src == got, f"source {src}, Salesforce {got}")

    def pricebook_entries(self):
        rows = read_csv(self.cfg.salesforce_dir / "PricebookEntry.csv")
        products = self["products"]
        sf_rows = {r["Product2Id"]: r for r in self.sf.query_all(
            "SELECT Product2Id, UnitPrice, IsActive FROM PricebookEntry WHERE Pricebook2.IsStandard = true")}
        bad = [r["Id"] for r in rows if (p := sf_rows.get(products.get(r["Product2Id"]))) is None
               or abs(p["UnitPrice"] - float(r["UnitPrice"])) > 0.005 or p["IsActive"] != (r["IsActive"] == "true")]
        self.check("pricebook_entries: standard prices", not bad, f"{len(rows)} source entries, wrong or missing: {bad[:5] or 'none'}")

    def fields(self, name):
        sobject = OBJECTS[name][1]
        rows = self.source(name)
        if self.sample and len(rows) > self.sample:
            rows = random.sample(rows, self.sample)
        targets = [t for t, _, _ in SPECS[name]]
        if self.tx.address_codes and name in ADDRESS_CODES:
            codes = dict(ADDRESS_CODES[name])
            targets = [codes.get(t, t) for t in targets]
        extra = {"leads": ["IsConverted"], "campaign_members": ["ContactId", "HasResponded"],
                 "opportunities": ["IsClosed", "IsWon"], "users": ["Name"]}.get(name, [])
        soql_fields = sorted(set(targets + extra + (["Ridgeline_Owner_Id__c"] if name in ("accounts", "contacts", "leads", "campaigns", "opportunities") else [])))
        actual = {r["Ridgeline_Id__c"]: r for r in self.sf.query_all(
            f"SELECT Ridgeline_Id__c, {', '.join(soql_fields)} FROM {sobject} WHERE Ridgeline_Id__c != null")}
        contacts = self["contacts"]
        mismatches, info, missing = {}, {}, 0
        for row in rows:
            got = actual.get(row["Id"])
            if got is None:
                missing += 1
                continue
            want = self.tx.build(name, row, for_insert=True)
            if name == "campaign_members":
                want["ContactId"] = contacts.get(row["ContactId"]) if row["ContactId"] else None
                want["HasResponded"] = row["HasResponded"] == "true"
            if name == "opportunities":
                want["IsClosed"] = row["IsClosed"] == "true"
                want["IsWon"] = row["IsWon"] == "true"
            if name == "leads":
                want["IsConverted"] = row["IsConverted"] == "true"
            for f in soql_fields:
                if f in ("OwnerId",):
                    continue
                if _norm(want.get(f)) != _norm(got.get(f)):
                    bucket = info if f in INFO_ONLY else mismatches
                    bucket.setdefault(f, []).append(row["Id"])
        detail = (f"{len(rows)} records x {len(soql_fields)} fields compared; missing {missing}; mismatches: "
                  + (", ".join(f"{f} {len(v)} (e.g. {v[0]})" for f, v in mismatches.items()) or "none"))
        if info:
            detail += "; LastModifiedDate changed by later writes on " + ", ".join(f"{len(v)}" for v in info.values())
        self.check(f"{name}: field values", not mismatches and not missing, detail)

    def owners(self):
        bad = {}
        for name in ("accounts", "contacts", "leads", "campaigns", "opportunities"):
            sobject = OBJECTS[name][1]
            n = self.sf.count(f"FROM {sobject} WHERE Ridgeline_Id__c != null AND OwnerId != '{self.owner_id}'")
            if n:
                bad[name] = n
        self.check("owners: every record owned by the loading user, source owner in Ridgeline_Owner_Id__c",
                   not bad, f"not owned by the loading user: {bad or 'none'}")

    def conversion(self):
        maps = {k: self[k] for k in ("accounts", "contacts", "opportunities")}
        actual = {r["Ridgeline_Id__c"]: r for r in self.sf.query_all(
            "SELECT Ridgeline_Id__c, Status, ConvertedAccountId, ConvertedContactId, ConvertedOpportunityId "
            "FROM Lead WHERE Ridgeline_Id__c != null AND IsConverted = true")}
        rows = [r for r in self.source("leads") if r["IsConverted"] == "true"]
        bad = []
        for r in rows:
            got = actual.get(r["Id"])
            want = (maps["accounts"].get(r["ConvertedAccountId"]), maps["contacts"].get(r["ConvertedContactId"]),
                    maps["opportunities"].get(r["ConvertedOpportunityId"]) if r["ConvertedOpportunityId"] else None)
            if not got or (got["ConvertedAccountId"], got["ConvertedContactId"], got["ConvertedOpportunityId"]) != want \
                    or got["Status"] != r["Status"]:
                bad.append(r["Id"])
        self.check("leads: conversion", not bad and len(actual) == len(rows),
                   f"{len(rows)} converted in source, {len(actual)} in Salesforce; wrong account/contact/opportunity or status: "
                   f"{len(bad)}{' (e.g. ' + bad[0] + ')' if bad else ''}")

    def crosswalk(self):
        path = self.cfg.dataset_dir / "answer_key" / "id_crosswalk_customers.csv"
        rows = [r for r in read_csv(path) if r["salesforce_account_id"]]
        accounts = self["accounts"]
        qbo = {r["Ridgeline_Id__c"]: r["QBO_Customer_Id__c"] for r in self.sf.query_all(
            "SELECT Ridgeline_Id__c, QBO_Customer_Id__c FROM Account WHERE Ridgeline_Id__c != null")}
        resolved = [r for r in rows if r["salesforce_account_id"] in accounts]
        with_qbo = [r for r in resolved if r["qbo_customer_id"]]
        qbo_ok = sum(1 for r in with_qbo if qbo.get(r["salesforce_account_id"]) == r["qbo_customer_id"])
        # Trap I2: QBO_Customer_Id__c is blank in Account.csv for some customers. Salesforce must
        # match the file (blank), so only a non-blank value that differs from the crosswalk is wrong.
        wrong = [r for r in with_qbo if qbo.get(r["salesforce_account_id"]) not in (None, r["qbo_customer_id"])]
        blank = len(with_qbo) - qbo_ok - len(wrong)
        self.check("crosswalk: Salesforce accounts", len(resolved) == len(rows) and not wrong,
                   f"{len(rows)} crosswalk rows, {len(resolved)} resolve; QBO customer id matches on {qbo_ok} of "
                   f"{len(with_qbo)}, blank as in the source on {blank} (trap I2), wrong on {len(wrong)}")

    def dates(self):
        for name, fields in (("accounts", ["CreatedDate"]), ("contacts", ["CreatedDate"]), ("leads", ["CreatedDate"]),
                             ("opportunities", ["CreatedDate", "CloseDate"]), ("campaigns", ["StartDate", "EndDate"])):
            rows = sorted(self.source(name), key=lambda r: r["CreatedDate"])
            picks = rows[:5] + rows[-5:]
            sobject = OBJECTS[name][1]
            ids = ",".join(f"'{r['Id']}'" for r in picks)
            got = {r["Ridgeline_Id__c"]: r for r in self.sf.query_all(
                f"SELECT Ridgeline_Id__c, {', '.join(fields)} FROM {sobject} WHERE Ridgeline_Id__c IN ({ids})")}
            bad = [r["Id"] for r in picks for f in fields
                   if r["Id"] not in got or _norm(got[r["Id"]][f]) != _norm(r[f])]
            self.check(f"{name}: historical dates", not bad,
                       f"{len(picks)} oldest/newest records, {', '.join(fields)} mismatches: {len(bad)}")


def write_report(cfg, results, summary=None):
    out = cfg.output_dir / "reports"
    out.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    passed = sum(r["pass"] for r in results)
    lines = [f"# Salesforce load validation, {time.strftime('%Y-%m-%d %H:%M')}", "",
             f"Org {cfg.org_id}. {passed} of {len(results)} checks passed.", "",
             "| Check | Result | Detail |", "| --- | --- | --- |"]
    lines += [f"| {r['check']} | {'PASS' if r['pass'] else 'FAIL'} | {r['detail']} |" for r in results]
    if summary:
        lines += ["", "## Load summary", "", "```json", json.dumps(summary, indent=1), "```"]
    md = out / f"validation_{stamp}.md"
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / f"validation_{stamp}.json").write_text(json.dumps({"results": results, "load_summary": summary}, indent=1),
                                                  encoding="utf-8")
    return md
