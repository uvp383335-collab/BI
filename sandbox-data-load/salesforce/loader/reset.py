"""Wipes what the loader created so the org can be reloaded (e.g. after the dataset is
regenerated with a new seed).

Only records carrying Ridgeline_Id__c are touched, plus the standard price book entries of
loaded products. The schema (fields, picklist values, permission set) is left in place.
"""
from .load import log

# Children first.
DELETE_ORDER = ["CampaignMember", "Opportunity", "Lead", "Contact", "Account", "Campaign",
                "PricebookEntry", "Product2", "Ridgeline_User__c"]


def run(cfg, sf, dry_run=True):
    for sobject in DELETE_ORDER:
        where = ("WHERE Product2.Ridgeline_Id__c != null" if sobject == "PricebookEntry"
                 else "WHERE Ridgeline_Id__c != null")
        if dry_run:
            log(f"would delete {sobject}: {sf.count(f'FROM {sobject} {where}')}")
            continue
        if sobject in ("Account", "Campaign"):
            # Parents can't go before their children; delete leaves of the hierarchy first.
            while True:
                rows = list(sf.query_all(f"SELECT Id, ParentId FROM {sobject} {where}"))
                if not rows:
                    break
                parents = {r["ParentId"] for r in rows}
                _delete(sf, sobject, [r["Id"] for r in rows if r["Id"] not in parents])
        else:
            _delete(sf, sobject, [r["Id"] for r in sf.query_all(f"SELECT Id FROM {sobject} {where}")])
    if not dry_run:
        log("done; deleted records are in the recycle bin for 15 days")


def _delete(sf, sobject, ids):
    errors = [r for r in sf.delete(ids) if not r.get("success")]
    log(f"deleted {sobject}: {len(ids) - len(errors)} ({len(errors)} errors {errors[:2]})")
