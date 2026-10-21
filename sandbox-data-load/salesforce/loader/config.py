"""Loads the JSON config and resolves its paths relative to the config file."""
import json
from pathlib import Path

ALL_STEPS = [
    "schema",            # custom fields, picklist values, permission set (Metadata API deploy)
    "users",             # User.csv into Ridgeline_User__c (records are owned by the loading user)
    "accounts",          # parents before children
    "contacts",
    "leads",
    "campaigns",         # parents before children, plus member statuses per campaign
    "products",          # Product2, then standard PricebookEntry
    "opportunities",
    "campaign_members",  # before lead conversion, so conversion attaches the contact
    "convert_leads",     # convertLead into the loaded account/contact/opportunity, then restore source values
]


class Config:
    def __init__(self, path):
        self.path = Path(path).resolve()
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        base = self.path.parent
        self.org_alias = raw["org_alias"]
        self.org_id = raw["org_id"]
        self.allow_production = bool(raw.get("allow_production", False))
        self.dataset_dir = (base / raw["dataset_dir"]).resolve()
        self.output_dir = (base / raw["output_dir"]).resolve()
        self.steps = raw.get("steps", ALL_STEPS)
        unknown = set(self.steps) - set(ALL_STEPS)
        if unknown:
            raise SystemExit(f"Unknown steps in config: {sorted(unknown)}")
        # Every record is owned by this user (empty = the user the sf alias is logged in as).
        self.owner_username = raw.get("owner_username") or None
        self.converted_lead_status = raw.get("converted_lead_status", "Qualified")

    @property
    def salesforce_dir(self):
        return self.dataset_dir / "salesforce"

    @property
    def metadata_build_dir(self):
        return self.output_dir / "metadata-build"
