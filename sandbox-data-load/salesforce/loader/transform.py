"""Source CSV row -> Salesforce record. One spec per object; ref columns resolve through the ID maps.

Kinds: str, num, int, bool, date (sent as-is), ref:<map>. Columns in CREATE_ONLY are sent on
insert only (audit dates and fields Salesforce does not allow to change after creation).
"""
import csv
import re
from datetime import datetime

ISO_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")
COUNTRY_CODES = {"United States": "US", "Canada": "CA"}

SPECS = {
    "users": [
        ("Username__c", "Username", "str"), ("First_Name__c", "FirstName", "str"), ("Last_Name__c", "LastName", "str"),
        ("Email__c", "Email", "str"), ("Title__c", "Title", "str"), ("Department__c", "Department", "str"),
        ("Company_Name__c", "CompanyName", "str"), ("Is_Active__c", "IsActive", "bool"),
        ("Role__c", "RoleName", "str"),  # UserRole.Name, filled in by the loader
        ("Manager_Id__c", "ManagerId", "str"), ("Employee_Number__c", "EmployeeNumber", "str"),
        ("User_Type__c", "UserType", "str"), ("Time_Zone__c", "TimeZoneSidKey", "str"),
        ("Territory__c", "Territory__c", "str"), ("Last_Login_Date__c", "LastLoginDate", "date"),
        ("CreatedDate", "CreatedDate", "date"),
    ],
    "accounts": [
        ("Name", "Name", "str"), ("Type", "Type", "str"), ("ParentId", "ParentId", "ref:accounts"),
        ("BillingStreet", "BillingStreet", "str"), ("BillingCity", "BillingCity", "str"),
        ("BillingState", "BillingState", "str"), ("BillingPostalCode", "BillingPostalCode", "str"),
        ("BillingCountry", "BillingCountry", "str"), ("Phone", "Phone", "str"), ("Website", "Website", "str"),
        ("Industry", "Industry", "str"), ("AnnualRevenue", "AnnualRevenue", "num"),
        ("NumberOfEmployees", "NumberOfEmployees", "int"), ("AccountSource", "AccountSource", "str"),
        ("Segment__c", "Segment__c", "str"), ("Vertical__c", "Vertical__c", "str"), ("Region__c", "Region__c", "str"),
        ("Customer_Since__c", "Customer_Since__c", "date"), ("Churn_Date__c", "Churn_Date__c", "date"),
        ("Churn_Reason__c", "Churn_Reason__c", "str"), ("Current_ARR__c", "Current_ARR__c", "num"),
        ("QBO_Customer_Id__c", "QBO_Customer_Id__c", "str"), ("Billing_Currency__c", "Billing_Currency__c", "str"),
        ("CreatedDate", "CreatedDate", "date"), ("LastModifiedDate", "LastModifiedDate", "date"),
    ],
    "contacts": [
        ("AccountId", "AccountId", "ref:accounts"), ("FirstName", "FirstName", "str"), ("LastName", "LastName", "str"),
        ("Email", "Email", "str"), ("Phone", "Phone", "str"), ("Title", "Title", "str"),
        ("LeadSource", "LeadSource", "str"), ("MailingCity", "MailingCity", "str"),
        ("MailingState", "MailingState", "str"), ("MailingCountry", "MailingCountry", "str"),
        ("HasOptedOutOfEmail", "HasOptedOutOfEmail", "bool"), ("CreatedDate", "CreatedDate", "date"),
    ],
    "leads": [
        ("FirstName", "FirstName", "str"), ("LastName", "LastName", "str"), ("Company", "Company", "str"),
        ("Title", "Title", "str"), ("Email", "Email", "str"), ("Phone", "Phone", "str"),
        ("Status", "Status", "str"), ("LeadSource", "LeadSource", "str"), ("Industry", "Industry", "str"),
        ("NumberOfEmployees", "NumberOfEmployees", "int"), ("City", "City", "str"), ("State", "State", "str"),
        ("Country", "Country", "str"), ("HubSpot_Score__c", "HubSpot_Score__c", "num"),
        ("HubSpot_Original_Source__c", "HubSpot_Original_Source__c", "str"),
        ("HubSpot_Original_Source_Drill_Down_1__c", "HubSpot_Original_Source_Drill_Down_1__c", "str"),
        ("MQL_Date__c", "MQL_Date__c", "date"), ("Ridgeline_Converted_Date__c", "ConvertedDate", "date"),
        ("CreatedDate", "CreatedDate", "date"),
    ],
    "campaigns": [
        ("Name", "Name", "str"), ("Type", "Type", "str"), ("Status", "Status", "str"),
        ("StartDate", "StartDate", "date"), ("EndDate", "EndDate", "date"),
        ("BudgetedCost", "BudgetedCost", "num"), ("ActualCost", "ActualCost", "num"),
        ("ParentId", "ParentId", "ref:campaigns"), ("IsActive", "IsActive", "bool"),
        ("UTM_Campaign__c", "UTM_Campaign__c", "str"),
        ("Ridgeline_Created_Date__c", "CreatedDate", "date"),  # CreatedDate can't be set on Campaign
    ],
    "products": [
        ("Name", "Name", "str"), ("ProductCode", "ProductCode", "str"), ("Family", "Family", "str"),
        ("IsActive", "IsActive", "bool"), ("Description", "Description", "str"),
        ("Recurring__c", "Recurring__c", "bool"),
        ("Ridgeline_Created_Date__c", "CreatedDate", "date"),  # CreatedDate can't be set on Product2
    ],
    "pricebook_entries": [
        ("Product2Id", "Product2Id", "ref:products"), ("UnitPrice", "UnitPrice", "num"),
        ("IsActive", "IsActive", "bool"), ("UseStandardPrice", "UseStandardPrice", "bool"),
    ],
    "opportunities": [
        ("AccountId", "AccountId", "ref:accounts"), ("Name", "Name", "str"), ("Type", "Type", "str"),
        ("StageName", "StageName", "str"), ("Amount", "Amount", "num"), ("Probability", "Probability", "num"),
        ("CloseDate", "CloseDate", "date"), ("ForecastCategoryName", "ForecastCategoryName", "str"),
        ("LeadSource", "LeadSource", "str"), ("CampaignId", "CampaignId", "ref:campaigns"),
        ("ARR__c", "ARR__c", "num"), ("ARR_Change__c", "ARR_Change__c", "num"),
        ("One_Time_Amount__c", "One_Time_Amount__c", "num"), ("Contract_Term_Months__c", "Contract_Term_Months__c", "int"),
        ("Billing_Frequency__c", "Billing_Frequency__c", "str"),
        ("Subscription_Start_Date__c", "Subscription_Start_Date__c", "date"),
        ("Primary_Competitor__c", "Primary_Competitor__c", "str"), ("Loss_Reason__c", "Loss_Reason__c", "str"),
        ("Churn_Reason__c", "Churn_Reason__c", "str"), ("Segment__c", "Segment__c", "str"),
        ("Partner_Account__c", "Partner_Account__c", "str"), ("SDR__c", "SDR__c", "str"),
        ("Description", "Description", "str"),
        ("CreatedDate", "CreatedDate", "date"), ("LastModifiedDate", "LastModifiedDate", "date"),
    ],
    "campaign_members": [
        ("CampaignId", "CampaignId", "ref:campaigns"), ("LeadId", "LeadId", "ref:leads"),
        ("Status", "Status", "str"), ("Ridgeline_First_Responded_Date__c", "FirstRespondedDate", "date"),
        ("CreatedDate", "CreatedDate", "date"),
    ],
}
CREATE_ONLY = {
    "*": {"CreatedDate", "LastModifiedDate"},
    "campaign_members": {"CampaignId", "LeadId"},
    "pricebook_entries": {"Product2Id"},
}
# Objects whose records carry the source owner and are owned by the loading user.
OWNED = {"accounts", "contacts", "leads", "campaigns", "opportunities"}
# Address fields that move to the ISO code fields when the org has state/country picklists on.
ADDRESS_CODES = {
    "accounts": [("BillingState", "BillingStateCode"), ("BillingCountry", "BillingCountryCode")],
    "contacts": [("MailingState", "MailingStateCode"), ("MailingCountry", "MailingCountryCode")],
    "leads": [("State", "StateCode"), ("Country", "CountryCode")],
}


def read_csv(path, limit=None):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    return rows[:limit] if limit else rows


def convert(value, kind):
    if value == "":
        return None
    if kind == "num":
        return float(value)
    if kind == "int":
        return int(float(value))
    if kind == "bool":
        return value.lower() == "true"
    return value


class Transformer:
    def __init__(self, maps, owner_id, address_codes=False):
        self.maps = maps          # name -> {source id: salesforce id}
        self.owner_id = owner_id
        self.address_codes = address_codes
        self.unresolved = []      # (object, source id, column, missing ref)

    def build(self, obj, row, for_insert):
        rec = {}
        skip = CREATE_ONLY["*"] | CREATE_ONLY.get(obj, set())
        for target, col, kind in SPECS[obj]:
            if not for_insert and target in skip:
                continue
            raw = row.get(col, "")
            if kind.startswith("ref:"):
                if raw == "":
                    value = None
                else:
                    value = self.maps[kind[4:]].get(raw)
                    if value is None:
                        self.unresolved.append((obj, row["Id"], col, raw))
                        continue
            else:
                value = convert(raw, kind)
            if value is None and for_insert:
                continue
            rec[target] = value
        # 29 source accounts were "modified" before they were created; Salesforce rejects that,
        # so the closest valid value (the created date) is used.
        if rec.get("LastModifiedDate") and rec.get("CreatedDate") and rec["LastModifiedDate"] < rec["CreatedDate"]:
            rec["LastModifiedDate"] = rec["CreatedDate"]
        if obj in ADDRESS_CODES and self.address_codes:
            for text_field, code_field in ADDRESS_CODES[obj]:
                if text_field in rec:
                    v = rec.pop(text_field)
                    rec[code_field] = COUNTRY_CODES.get(v, v) if v is not None else None
        if obj in OWNED:
            rec["OwnerId"] = self.owner_id
            rec["Ridgeline_Owner_Id__c"] = row.get("OwnerId") or None
        if obj == "users":
            rec["Name"] = f"{row['FirstName']} {row['LastName']}".strip()
        if obj != "pricebook_entries":
            rec["Ridgeline_Id__c"] = row["Id"]
        if not for_insert:
            rec = {k: v for k, v in rec.items() if k != "Ridgeline_Id__c"}
        return rec


def norm(value):
    """Compare values the way Salesforce returns them: datetimes as instants, numbers as numbers."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    if ISO_DATETIME.match(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00").replace("+0000", "+00:00")).timestamp()
    return value
