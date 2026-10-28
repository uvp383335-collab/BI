"""Loads the JSON config and resolves its paths relative to the config file."""
import json
from pathlib import Path

ALL_STEPS = [
    "properties",        # custom properties + custom object schemas
    "owners",            # users from owners.csv
    "pipeline",          # deal pipeline stages
    "companies",
    "contacts",
    "deals",
    "associations",      # company/contact/deal links + parent/child companies
    "lifecycle_changes", # custom object, from contact_property_history_lifecyclestage.csv
    "deal_stage_changes", # custom object, from salesforce/OpportunityHistory.csv
    "form_submissions",  # custom object, from form_submissions.csv
    "goals",
    "campaigns",         # only runs when campaigns.enabled is true
]


class Config:
    def __init__(self, path):
        self.path = Path(path).resolve()
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        base = self.path.parent
        self.portal_id = int(raw["portal_id"])
        self.allow_non_test_account = bool(raw.get("allow_non_test_account", False))
        self.token_file = Path(raw["token_file"]).expanduser()
        self.dataset_dir = (base / raw["dataset_dir"]).resolve()
        self.output_dir = (base / raw["output_dir"]).resolve()
        self.definitions_dir = (base / raw.get("definitions_dir", "../property-definitions")).resolve()
        self.patches_dir = (base / raw.get("patches_dir", "../source-patches")).resolve()
        self.batch_size = int(raw.get("batch_size", 100))
        self.steps = raw.get("steps", [s for s in ALL_STEPS if s != "campaigns"])
        unknown = set(self.steps) - set(ALL_STEPS)
        if unknown:
            raise SystemExit(f"Unknown steps in config: {sorted(unknown)}")
        camp = raw.get("campaigns", {})
        self.campaigns_enabled = bool(camp.get("enabled", False))
        self.campaign_name_replacements = camp.get("name_replacements", {"(": "[", ")": "]"})
        self.remove_unused_default_stages = bool(raw.get("remove_unused_default_stages", True))

    @property
    def hubspot_dir(self):
        return self.dataset_dir / "hubspot"

    def token(self):
        return self.token_file.read_text(encoding="utf-8-sig").strip()
