"""Load steps. Each step is safe to re-run: records are matched on Ridgeline_Id__c, new ones
inserted (with their historical CreatedDate), existing ones updated."""
import time

from . import schema
from .transform import Transformer, line_totals, norm, read_csv

# step/map name -> (source file, sObject, self-reference column loaded parents-first)
OBJECTS = {
    "users": ("User.csv", "Ridgeline_User__c", None),
    "accounts": ("Account.csv", "Account", "ParentId"),
    "contacts": ("Contact.csv", "Contact", None),
    "leads": ("Lead.csv", "Lead", None),
    "campaigns": ("Campaign.csv", "Campaign", "ParentId"),
    "products": ("Product2.csv", "Product2", None),
    "opportunities": ("Opportunity.csv", "Opportunity", None),
    "line_items": ("OpportunityLineItem.csv", "OpportunityLineItem", None),
    "campaign_members": ("CampaignMember.csv", "CampaignMember", None),
}


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


class Loader:
    def __init__(self, cfg, sf, maps, limit=None):
        self.cfg = cfg
        self.sf = sf
        self.maps = maps
        self.limit = limit
        self.summary = {}
        self._cache = {}
        username = cfg.owner_username or sf.username
        self.owner_id = next(sf.query_all(f"SELECT Id FROM User WHERE Username = '{username}'"))["Id"]
        account_fields = {f["name"] for f in sf.describe("Account")["fields"]}
        self.tx = Transformer(_LazyMaps(self), self.owner_id, address_codes="BillingStateCode" in account_fields,
                              line_totals=line_totals(cfg.salesforce_dir))

    # -- helpers ---------------------------------------------------------------
    def idmap(self, name):
        if name not in self._cache:
            self._cache[name] = self.maps.load(name)
        return self._cache[name]

    def rows(self, name):
        return read_csv(self.cfg.salesforce_dir / OBJECTS[name][0], self.limit)

    def existing(self, sobject, extra=""):
        fields = "Id, Ridgeline_Id__c" + (f", {extra}" if extra else "")
        return {r["Ridgeline_Id__c"]: r for r in
                self.sf.query_all(f"SELECT {fields} FROM {sobject} WHERE Ridgeline_Id__c != null")}

    def current_values(self, name, sobject, rows, existing, skip_update, extra_fields):
        """Current Salesforce values of the fields an update would send, keyed by source id."""
        fields = set()
        for r in rows:
            if r["Id"] in existing and r["Id"] not in skip_update:
                rec = self.tx.build(name, r, for_insert=False)
                if extra_fields:
                    rec.update(extra_fields(r, insert=False))
                fields |= set(rec)
        if not fields:
            return {}
        soql = f"SELECT Ridgeline_Id__c, {', '.join(sorted(fields))} FROM {sobject} WHERE Ridgeline_Id__c != null"
        return {r["Ridgeline_Id__c"]: r for r in self.sf.query_all(soql)}

    def write(self, name, sobject, inserts, updates):
        """inserts: [(source id, record)]; updates: [(source id, sf id, record)]. Returns (new ids, errors)."""
        new_ids, errors, updated = {}, [], 0
        if inserts:
            for (src, _), res in zip(inserts, self.sf.insert(sobject, [r for _, r in inserts])):
                if res.get("success"):
                    new_ids[src] = res["id"]
                else:
                    errors.append((src, res.get("errors")))
        if updates:
            payload = [{"Id": sid, **rec} for _, sid, rec in updates]
            for (src, _, _), res in zip(updates, self.sf.update(sobject, payload)):
                if res.get("success"):
                    updated += 1
                else:
                    errors.append((src, res.get("errors")))
        for src, err in errors[:10]:
            log(f"  {name} {src}: {err}")
        return new_ids, errors, updated

    def upsert(self, name, rows=None, skip_update=(), extra_fields=None):
        file_, sobject, parent_col = OBJECTS[name]
        rows = self.rows(name) if rows is None else rows
        existing = {k: v["Id"] for k, v in self.existing(sobject).items()}
        current = self.current_values(name, sobject, rows, existing, skip_update, extra_fields)
        unchanged = 0
        mapping = self.idmap(name)
        mapping.clear()
        mapping.update({k: v for k, v in existing.items()})
        pending = list(rows)
        created = updated = 0
        all_errors = []
        while pending:
            # Parents first: a row waits while its parent is in this file but not loaded yet.
            source_ids = {r["Id"] for r in pending}
            wave = [r for r in pending if not parent_col or r[parent_col] not in source_ids or r[parent_col] == r["Id"]]
            if not wave:
                wave = pending  # cycle guard; unresolved parents are reported
            wave_ids = {r["Id"] for r in wave}
            pending = [r for r in pending if r["Id"] not in wave_ids]
            inserts, updates = [], []
            for r in wave:
                if r["Id"] in existing:
                    if r["Id"] in skip_update:
                        continue
                    rec = self.tx.build(name, r, for_insert=False)
                    if extra_fields:
                        rec.update(extra_fields(r, insert=False))
                    # Only write records that differ: every write re-stamps LastModifiedDate.
                    now = current.get(r["Id"], {})
                    if all(norm(v) == norm(now.get(k)) for k, v in rec.items()):
                        unchanged += 1
                        continue
                    updates.append((r["Id"], existing[r["Id"]], rec))
                else:
                    rec = self.tx.build(name, r, for_insert=True)
                    if extra_fields:
                        rec.update(extra_fields(r, insert=True))
                    inserts.append((r["Id"], rec))
            new_ids, errors, n_updated = self.write(name, sobject, inserts, updates)
            mapping.update(new_ids)
            created += len(new_ids)
            updated += n_updated
            all_errors += errors
        self.maps.save(name, mapping, ["source_id", "salesforce_id"])
        unresolved = [u for u in self.tx.unresolved if u[0] == name]
        self.summary[name] = {"source": len(rows), "created": created, "updated": updated, "unchanged": unchanged,
                              "errors": len(all_errors), "unresolved_refs": len(unresolved)}
        log(f"  {name}: {self.summary[name]}")
        if unresolved:
            log(f"  {name}: first unresolved refs {unresolved[:5]}")
        return mapping

    # -- steps -------------------------------------------------------------------
    def step_schema(self):
        schema.deploy(self.cfg, self.sf, log)
        ps = next(self.sf.query_all(f"SELECT Id FROM PermissionSet WHERE Name = '{schema.PERMSET}'"))["Id"]
        assigned = self.sf.count(f"FROM PermissionSetAssignment WHERE PermissionSetId = '{ps}' AND AssigneeId = '{self.owner_id}'")
        if not assigned:
            self.sf.insert("PermissionSetAssignment", [{"PermissionSetId": ps, "AssigneeId": self.owner_id}])
            log("  assigned permission set Ridgeline_Loader")
        # Campaigns can only be created by a Marketing User.
        self.sf.update("User", [{"Id": self.owner_id, "UserPermissionsMarketingUser": True}])
        std = next(self.sf.query_all("SELECT Id, IsActive FROM Pricebook2 WHERE IsStandard = true"))
        if not std["IsActive"]:
            self.sf.update("Pricebook2", [{"Id": std["Id"], "IsActive": True}])
            log("  activated the Standard Price Book")

    def step_users(self):
        roles = {r["Id"]: r["Name"] for r in read_csv(self.cfg.salesforce_dir / "UserRole.csv")}
        rows = self.rows("users")
        for r in rows:
            r["RoleName"] = roles.get(r["UserRoleId"], "")
        self.upsert("users", rows)

    def step_accounts(self):
        self.upsert("accounts")

    def step_contacts(self):
        self.upsert("contacts")

    def step_leads(self):
        # Converted leads are read-only in Salesforce, so they are only ever inserted. Until the
        # convert step runs they sit in an open status; conversion sets the source's converted status.
        converted = {k for k, v in self.existing("Lead", "IsConverted").items() if v["IsConverted"]}
        self.upsert("leads", skip_update=converted,
                    extra_fields=lambda r, insert: {"Status": "Working - Contacted"} if r["IsConverted"] == "true" else {})

    def step_campaigns(self):
        campaigns = self.upsert("campaigns")
        # Member statuses are per campaign; add the ones the members use (Attended, Downloaded, ...).
        needed = {}
        for m in read_csv(self.cfg.salesforce_dir / "CampaignMember.csv", self.limit):
            cid = campaigns.get(m["CampaignId"])
            if cid:
                needed.setdefault(cid, {})[m["Status"]] = m["HasResponded"] == "true"
        have = {}
        for s in self.sf.query_all("SELECT CampaignId, Label, SortOrder FROM CampaignMemberStatus"):
            have.setdefault(s["CampaignId"], {})[s["Label"]] = s["SortOrder"]
        inserts = []
        for cid, statuses in needed.items():
            order = max(have.get(cid, {}).values(), default=0)
            for label, responded in sorted(statuses.items()):
                if label not in have.get(cid, {}):
                    order += 1
                    inserts.append({"CampaignId": cid, "Label": label, "HasResponded": responded, "SortOrder": order})
        errors = [r for r in self.sf.insert("CampaignMemberStatus", inserts) if not r.get("success")]
        log(f"  campaign member statuses: {len(inserts)} added, {len(errors)} errors {errors[:3]}")

    def step_products(self):
        products = self.upsert("products")
        std = next(self.sf.query_all("SELECT Id FROM Pricebook2 WHERE IsStandard = true"))["Id"]
        existing = {r["Product2Id"]: r["Id"] for r in
                    self.sf.query_all(f"SELECT Id, Product2Id FROM PricebookEntry WHERE Pricebook2Id = '{std}'")}
        rows = read_csv(self.cfg.salesforce_dir / "PricebookEntry.csv", self.limit)
        inserts, updates, mapping = [], [], self.idmap("pricebook_entries")
        mapping.clear()
        for r in rows:
            pid = products.get(r["Product2Id"])
            if pid in existing:
                mapping[r["Id"]] = existing[pid]
                updates.append((r["Id"], existing[pid], self.tx.build("pricebook_entries", r, for_insert=False)))
            else:
                inserts.append((r["Id"], {"Pricebook2Id": std, **self.tx.build("pricebook_entries", r, for_insert=True)}))
        new_ids, errors, updated = self.write("pricebook_entries", "PricebookEntry", inserts, updates)
        mapping.update(new_ids)
        self.maps.save("pricebook_entries", mapping, ["source_id", "salesforce_id"])
        self.summary["pricebook_entries"] = {"source": len(rows), "created": len(new_ids),
                                             "updated": updated, "errors": len(errors)}
        log(f"  pricebook_entries: {self.summary['pricebook_entries']}")

    def step_opportunities(self):
        std = next(self.sf.query_all("SELECT Id FROM Pricebook2 WHERE IsStandard = true"))["Id"]
        self.upsert("opportunities", extra_fields=lambda r, insert: {"Pricebook2Id": std} if r["Pricebook2Id"] else {})

    def step_line_items(self):
        self.upsert("line_items")

    def step_campaign_members(self):
        self.upsert("campaign_members")

    def step_convert_leads(self):
        leads = self.idmap("leads")
        accounts, contacts, opps = self.idmap("accounts"), self.idmap("contacts"), self.idmap("opportunities")
        source = [r for r in self.rows("leads") if r["IsConverted"] == "true"]
        done = {k for k, v in self.existing("Lead", "IsConverted").items() if v["IsConverted"]}
        converts, missing = [], []
        for r in source:
            if r["Id"] in done:
                continue
            ids = (leads.get(r["Id"]), accounts.get(r["ConvertedAccountId"]), contacts.get(r["ConvertedContactId"]))
            opp = opps.get(r["ConvertedOpportunityId"]) if r["ConvertedOpportunityId"] else None
            if not all(ids) or (r["ConvertedOpportunityId"] and not opp):
                missing.append(r["Id"])
                continue
            converts.append({"leadId": ids[0], "accountId": ids[1], "contactId": ids[2], "opportunityId": opp,
                             "convertedStatus": self.cfg.converted_lead_status})
        log(f"  converting {len(converts)} leads ({len(done)} already converted, {len(missing)} missing a loaded target)")
        results = self.sf.convert_leads(converts)
        failed = [r for r in results if not r["success"]]
        for f in failed[:10]:
            log(f"  convert {f['leadId']}: {f['errors']}")
        self.summary["convert_leads"] = {"source": len(source), "converted": len(results) - len(failed),
                                         "already": len(done), "failed": len(failed), "missing_target": len(missing)}
        log(f"  convert_leads: {self.summary['convert_leads']}")
        self.restore_after_conversion(source)

    def restore_after_conversion(self, converted_rows):
        """Conversion can copy lead values onto the account, contact and opportunity. Put the source back."""
        targets = {"accounts": {r["ConvertedAccountId"] for r in converted_rows},
                   "contacts": {r["ConvertedContactId"] for r in converted_rows},
                   "opportunities": {r["ConvertedOpportunityId"] for r in converted_rows if r["ConvertedOpportunityId"]}}
        std = next(self.sf.query_all("SELECT Id FROM Pricebook2 WHERE IsStandard = true"))["Id"]
        for name, ids in targets.items():
            sobject = OBJECTS[name][1]
            mapping = self.idmap(name)
            extra = (lambda r, insert: {"Pricebook2Id": std} if r["Pricebook2Id"] else {}) if name == "opportunities" else None
            rows = [r for r in self.rows(name) if r["Id"] in ids and r["Id"] in mapping]
            current = self.current_values(name, sobject, rows, mapping, (), extra)
            updates = []
            for r in rows:
                rec = self.tx.build(name, r, for_insert=False)
                if extra:
                    rec.update(extra(r, insert=False))
                if any(norm(v) != norm(current.get(r["Id"], {}).get(k)) for k, v in rec.items()):
                    updates.append((r["Id"], mapping[r["Id"]], rec))
            _, errors, _ = self.write(name, sobject, [], updates)
            log(f"  restored {len(updates)} {name} changed by conversion ({len(rows)} checked), {len(errors)} errors")


class _LazyMaps:
    """Lets the transformer resolve refs from maps saved by earlier runs or earlier steps."""
    def __init__(self, loader):
        self.loader = loader

    def __getitem__(self, name):
        return self.loader.idmap(name)
