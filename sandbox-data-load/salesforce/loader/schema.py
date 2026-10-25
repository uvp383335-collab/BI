"""Builds and deploys the org metadata the dataset needs.

Custom fields and the Ridgeline_User__c object come from FIELDS / USER_FIELDS below; picklist
values are read from the CSVs, so a regenerated dataset with new values still deploys cleanly.
"""
import csv
import json
import shutil
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

NS = 'xmlns="http://soap.sforce.com/2006/04/metadata"'
PERMSET = "Ridgeline_Loader"

# (field, type, option). Picklist option = list of (csv file, column) to read values from.
EXT_ID = ("Ridgeline_Id__c", "ExternalId", None)
OWNER = ("Ridgeline_Owner_Id__c", "Text", 18)
FIELDS = {
    "Account": [
        EXT_ID, OWNER,
        ("Segment__c", "Picklist", [("Account", "Segment__c")]),
        ("Vertical__c", "Picklist", [("Account", "Vertical__c")]),
        ("Region__c", "Picklist", [("Account", "Region__c")]),
        ("Customer_Since__c", "Date", None),
        ("Churn_Date__c", "Date", None),
        ("Churn_Reason__c", "Picklist", [("Account", "Churn_Reason__c")]),
        ("Current_ARR__c", "Currency", None),
        ("QBO_Customer_Id__c", "Text", 20),
        ("Billing_Currency__c", "Picklist", [("Account", "Billing_Currency__c")]),
    ],
    "Contact": [EXT_ID, OWNER],
    "Lead": [
        EXT_ID, OWNER,
        ("Ridgeline_Converted_Date__c", "Date", None),
        ("HubSpot_Score__c", "Number", (3, 0)),
        ("HubSpot_Original_Source__c", "Picklist", [("Lead", "HubSpot_Original_Source__c")]),
        ("HubSpot_Original_Source_Drill_Down_1__c", "Text", 255),
        ("MQL_Date__c", "DateTime", None),
    ],
    "Campaign": [EXT_ID, OWNER, ("UTM_Campaign__c", "Text", 255), ("Ridgeline_Created_Date__c", "DateTime", None)],
    "CampaignMember": [EXT_ID, ("Ridgeline_First_Responded_Date__c", "Date", None)],
    "OpportunityLineItem": [EXT_ID],
    "Product2": [EXT_ID, ("Recurring__c", "Checkbox", None), ("Ridgeline_Created_Date__c", "DateTime", None)],
    "Opportunity": [
        EXT_ID, OWNER,
        ("ARR__c", "Currency", None),
        ("ARR_Change__c", "Currency", None),
        ("One_Time_Amount__c", "Currency", None),
        ("Contract_Term_Months__c", "Number", (3, 0)),
        ("Billing_Frequency__c", "Picklist", [("Opportunity", "Billing_Frequency__c")]),
        ("Subscription_Start_Date__c", "Date", None),
        ("Primary_Competitor__c", "Picklist", [("Opportunity", "Primary_Competitor__c")]),
        ("Loss_Reason__c", "Picklist", [("Opportunity", "Loss_Reason__c")]),
        ("Churn_Reason__c", "Picklist", [("Opportunity", "Churn_Reason__c"), ("Account", "Churn_Reason__c")]),
        ("Segment__c", "Picklist", [("Opportunity", "Segment__c"), ("Account", "Segment__c")]),
        ("Partner_Account__c", "Text", 255),
        ("SDR__c", "Text", 18),  # source User Id; join to Ridgeline_User__c
    ],
}
USER_FIELDS = [
    EXT_ID,
    ("Username__c", "Text", 80), ("First_Name__c", "Text", 40), ("Last_Name__c", "Text", 80),
    ("Email__c", "Email", None), ("Title__c", "Text", 80), ("Department__c", "Text", 80),
    ("Company_Name__c", "Text", 80), ("Is_Active__c", "Checkbox", None), ("Role__c", "Text", 80),
    ("Manager_Id__c", "Text", 18), ("Employee_Number__c", "Text", 20), ("User_Type__c", "Text", 40),
    ("Time_Zone__c", "Text", 40), ("Territory__c", "Text", 40), ("Last_Login_Date__c", "DateTime", None),
]

# Standard fields the loaded data uses that new orgs hide from the admin profile.
STANDARD_FIELD_PERMS = ["Account.AnnualRevenue", "Contact.LeadSource", "Contact.HasOptedOutOfEmail"]

# Standard picklists that get the dataset's values added (existing values are kept).
MERGED_VALUE_SETS = {
    "AccountType": ("Account", "Type", [("Account", "Type")]),
    "LeadSource": ("Lead", "LeadSource", [("Account", "AccountSource"), ("Contact", "LeadSource"),
                                          ("Lead", "LeadSource"), ("Opportunity", "LeadSource")]),
    "Industry": ("Account", "Industry", [("Account", "Industry"), ("Lead", "Industry")]),
    "OpportunityType": ("Opportunity", "Type", [("Opportunity", "Type")]),
    "CampaignType": ("Campaign", "Type", [("Campaign", "Type")]),
    "CampaignStatus": ("Campaign", "Status", [("Campaign", "Status")]),
    "Product2Family": ("Product2", "Family", [("Product2", "Family")]),
}
FORECAST_CATEGORY = {"Pipeline": "Pipeline", "Best Case": "BestCase", "Commit": "Forecast",
                     "Closed": "Closed", "Omitted": "Omitted"}


def csv_values(cfg, sources):
    seen = []
    for obj, col in sources:
        with (cfg.salesforce_dir / f"{obj}.csv").open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                v = row.get(col, "")
                if v and v not in seen:
                    seen.append(v)
    return seen


def field_xml(name, ftype, opt, cfg):
    label = name[:-3].replace("_", " ")
    body = [f"<fullName>{name}</fullName>", f"<label>{escape(label)}</label>"]
    if ftype == "ExternalId":
        body += ["<type>Text</type>", "<length>40</length>", "<externalId>true</externalId>",
                 "<unique>true</unique>", "<caseSensitive>true</caseSensitive>"]
    elif ftype == "Text":
        body += ["<type>Text</type>", f"<length>{opt}</length>"]
    elif ftype in ("Date", "DateTime", "Email"):
        body += [f"<type>{ftype}</type>"]
    elif ftype == "Currency":
        body += ["<type>Currency</type>", "<precision>16</precision>", "<scale>2</scale>"]
    elif ftype == "Number":
        body += ["<type>Number</type>", f"<precision>{opt[0]}</precision>", f"<scale>{opt[1]}</scale>"]
    elif ftype == "Checkbox":
        body += ["<type>Checkbox</type>", "<defaultValue>false</defaultValue>"]
    elif ftype == "Picklist":
        values = "".join(f"<value><fullName>{escape(v)}</fullName><default>false</default><label>{escape(v)}</label></value>"
                         for v in csv_values(cfg, opt))
        body += ["<type>Picklist</type>",
                 f"<valueSet><restricted>false</restricted><valueSetDefinition><sorted>false</sorted>{values}"
                 "</valueSetDefinition></valueSet>"]
    if ftype not in ("Checkbox",):
        body.append("<required>false</required>")
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<CustomField {NS}>{"".join(body)}</CustomField>\n'


def value_set_xml(values):
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<StandardValueSet {NS}><sorted>false</sorted>'
            + "".join(values) + "</StandardValueSet>\n")


def simple_value(v, default=False, extra=""):
    v = escape(v)
    return f"<standardValue><fullName>{v}</fullName><default>{str(default).lower()}</default><label>{v}</label>{extra}</standardValue>"


def stage_values(cfg):
    """Opportunity stages in source order with probability/forecast category taken from the deals."""
    stats = {}
    with (cfg.salesforce_dir / "Opportunity.csv").open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            stats.setdefault(r["StageName"], (r["Probability"], r["ForecastCategoryName"], r["IsClosed"], r["IsWon"]))
    order = sorted(stats, key=lambda s: (stats[s][2] == "true", s))  # "1 - ..".."5 - ..", then closed stages
    out = []
    for s in order:
        prob, fc, closed, won = stats[s]
        out.append(simple_value(s, extra=f"<closed>{closed}</closed><won>{won}</won><probability>{prob}</probability>"
                                         f"<forecastCategory>{FORECAST_CATEGORY[fc]}</forecastCategory>"))
    return out


def lead_status_values(cfg):
    statuses = csv_values(cfg, [("Lead", "Status")])
    default = "Open - Not Contacted" if "Open - Not Contacted" in statuses else statuses[0]
    return [simple_value(s, default=(s == default), extra=f"<converted>{str(s == cfg.converted_lead_status).lower()}</converted>")
            for s in statuses]


def build(cfg, sf):
    root = cfg.metadata_build_dir
    if root.exists():
        shutil.rmtree(root)
    src = root / "force-app" / "main" / "default"
    src.mkdir(parents=True)
    (root / "sfdx-project.json").write_text(json.dumps({
        "packageDirectories": [{"path": "force-app", "default": True}],
        "sourceApiVersion": "62.0"}), encoding="utf-8")

    perm_fields = []
    for obj, fields in list(FIELDS.items()) + [("Ridgeline_User__c", USER_FIELDS)]:
        d = src / "objects" / obj / "fields"
        d.mkdir(parents=True, exist_ok=True)
        for name, ftype, opt in fields:
            (d / f"{name}.field-meta.xml").write_text(field_xml(name, ftype, opt, cfg), encoding="utf-8")
            perm_fields.append(f"{obj}.{name}")
    perm_fields += STANDARD_FIELD_PERMS
    (src / "objects" / "Ridgeline_User__c" / "Ridgeline_User__c.object-meta.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject {NS}><label>Ridgeline User</label>'
        "<pluralLabel>Ridgeline Users</pluralLabel><nameField><label>Full Name</label><type>Text</type></nameField>"
        "<deploymentStatus>Deployed</deploymentStatus><sharingModel>ReadWrite</sharingModel>"
        "<enableActivities>false</enableActivities><enableBulkApi>true</enableBulkApi><enableFeeds>false</enableFeeds>"
        "<enableHistory>false</enableHistory><enableReports>true</enableReports><enableSearch>true</enableSearch>"
        "<enableSharing>true</enableSharing><enableStreamingApi>true</enableStreamingApi></CustomObject>\n",
        encoding="utf-8")

    vs = src / "standardValueSets"
    vs.mkdir(parents=True)
    for name, (obj, field, sources) in MERGED_VALUE_SETS.items():
        existing = [p["value"] for f in sf.describe(obj)["fields"] if f["name"] == field
                    for p in f["picklistValues"] if p["active"]]
        values = existing + [v for v in csv_values(cfg, sources) if v not in existing]
        (vs / f"{name}.standardValueSet-meta.xml").write_text(value_set_xml([simple_value(v) for v in values]), encoding="utf-8")
    # Stages and lead statuses are replaced, not merged: they carry probability / converted flags
    # that must match the source, and the org's demo values are not used by any record.
    (vs / "OpportunityStage.standardValueSet-meta.xml").write_text(value_set_xml(stage_values(cfg)), encoding="utf-8")
    (vs / "LeadStatus.standardValueSet-meta.xml").write_text(value_set_xml(lead_status_values(cfg)), encoding="utf-8")

    ps = src / "permissionsets"
    ps.mkdir(parents=True)
    fperms = "".join(f"<fieldPermissions><editable>true</editable><field>{f}</field><readable>true</readable></fieldPermissions>"
                     for f in perm_fields)
    (ps / f"{PERMSET}.permissionset-meta.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<PermissionSet {NS}><label>Ridgeline Loader</label>'
        f"<hasActivationRequired>false</hasActivationRequired>{fperms}"
        "<objectPermissions><allowCreate>true</allowCreate><allowDelete>true</allowDelete><allowEdit>true</allowEdit>"
        "<allowRead>true</allowRead><modifyAllRecords>true</modifyAllRecords><object>Ridgeline_User__c</object>"
        "<viewAllRecords>true</viewAllRecords></objectPermissions>"
        "<userPermissions><enabled>true</enabled><name>CreateAuditFields</name></userPermissions>"
        "</PermissionSet>\n", encoding="utf-8")
    return root


def audit_fields_enabled(sf):
    return any(f["name"] == "PermissionsCreateAuditFields" for f in sf.describe("PermissionSet")["fields"])


def deploy(cfg, sf, log):
    if not audit_fields_enabled(sf):
        raise SystemExit("'Set Audit Fields upon Record Creation' is off in this org. Turn it on in "
                         "Setup > User Interface, then re-run the schema step.")
    root = build(cfg, sf)
    exe = shutil.which("sf") or shutil.which("sf.cmd")
    log(f"deploying metadata from {root}")
    out = subprocess.run([exe, "project", "deploy", "start", "--source-dir", "force-app",
                          "--target-org", cfg.org_alias, "--wait", "30", "--json"],
                         cwd=root, capture_output=True, text=True, encoding="utf-8")
    result = json.loads(out.stdout)
    if result.get("status") != 0:
        failures = (result.get("result") or {}).get("details", {}).get("componentFailures") or result.get("message")
        raise SystemExit(f"metadata deploy failed: {json.dumps(failures)[:3000]}")
    log(f"deployed {len(result['result'].get('files', []))} components")
    return result
