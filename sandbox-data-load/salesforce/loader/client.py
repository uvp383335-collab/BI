"""Minimal Salesforce REST/SOAP client: sf CLI auth, retries, query paging, sObject Collections, org guard."""
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

API_VERSION = "62.0"
COLLECTION_SIZE = 200  # sObject Collections limit per call


class SalesforceError(Exception):
    def __init__(self, status, body, path):
        super().__init__(f"Salesforce {status} on {path}: {str(body)[:800]}")
        self.status = status
        self.body = body
        self.path = path


def sf_cli(*args):
    """Run the sf CLI and return its parsed --json result."""
    exe = shutil.which("sf") or shutil.which("sf.cmd")
    if not exe:
        raise SystemExit("sf CLI not found. Install it with: npm install -g @salesforce/cli")
    out = subprocess.run([exe, *args, "--json"], capture_output=True, text=True, encoding="utf-8")
    try:
        data = json.loads(out.stdout)
    except json.JSONDecodeError:
        raise SystemExit(f"sf {' '.join(args)} failed: {out.stderr[:500]}") from None
    if data.get("status") != 0:
        raise SystemExit(f"sf {' '.join(args)} failed: {data.get('message')}")
    return data["result"]


def cli_auth(alias):
    """Access token for an sf CLI alias, read from the CLI's own auth store (never written to disk)."""
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    root = subprocess.run([npm, "root", "-g"], capture_output=True, text=True).stdout.strip()
    env = {**os.environ, "NODE_PATH": str(Path(root) / "@salesforce" / "cli" / "node_modules")}
    out = subprocess.run(["node", str(Path(__file__).with_name("sf_token.js")), alias],
                         capture_output=True, text=True, encoding="utf-8", env=env)
    if out.returncode != 0:
        raise SystemExit(f"Could not get a token for sf alias '{alias}': {out.stderr[:500]}. "
                         f"Log in with: sf org login web --alias {alias}")
    return json.loads(out.stdout)


class Salesforce:
    def __init__(self, alias, timeout=180, max_retries=7):
        info = cli_auth(alias)
        self.alias = alias
        self.token = info["accessToken"]
        self.instance_url = info["instanceUrl"].rstrip("/")
        self.org_id = info["orgId"]
        self.username = info["username"]
        self.timeout = timeout
        self.max_retries = max_retries

    # -- transport -------------------------------------------------------
    def _send(self, method, url, data, headers, ok):
        for attempt in range(self.max_retries):
            try:
                req = urllib.request.Request(url, data=data, method=method, headers=headers)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return resp.read()
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if e.code in ok:
                    return text.encode()
                if e.code >= 500 or "REQUEST_LIMIT_EXCEEDED" in text or "UNABLE_TO_LOCK_ROW" in text:
                    time.sleep(min(2 ** attempt, 30))
                    continue
                raise SalesforceError(e.code, text, url) from None
            except (TimeoutError, socket.timeout, urllib.error.URLError, ConnectionError):
                # Writes are reconciled by Ridgeline_Id__c before any retry of a load step,
                # so a timed-out insert is caught by the next run instead of duplicated.
                if method != "GET":
                    raise SalesforceError(0, "timeout on a write; re-run the step to reconcile", url) from None
                time.sleep(min(2 ** attempt, 30))
        raise SalesforceError(0, "retries exhausted", url)

    def reauth(self):
        """The CLI's refresh can invalidate an earlier access token; fetch a current one."""
        self.token = cli_auth(self.alias)["accessToken"]

    def request(self, method, path, body=None, params=None, ok=()):
        url = path if path.startswith("http") else f"{self.instance_url}/services/data/v{API_VERSION}{path}"
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(2):
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                # Load the dataset exactly: duplicate-account traps are intentional, and
                # lead assignment rules must not reassign owners.
                "Sforce-Duplicate-Rule-Header": "allowSave=true",
                "Sforce-Auto-Assign": "FALSE",
            }
            try:
                raw = self._send(method, url, data, headers, ok)
                return json.loads(raw) if raw else {}
            except SalesforceError as e:
                # A 401 is returned before anything is written, so retrying is safe.
                if e.status != 401 or attempt:
                    raise
                self.reauth()

    def get(self, path, **params):
        return self.request("GET", path, params=params or None)

    # -- queries -----------------------------------------------------------
    def query_all(self, soql):
        page = self.get("/query", q=soql)
        yield from page["records"]
        while page.get("nextRecordsUrl"):
            page = self.request("GET", self.instance_url + page["nextRecordsUrl"])
            yield from page["records"]

    def count(self, soql_from_where):
        return self.get("/query", q=f"SELECT COUNT() {soql_from_where}")["totalSize"]

    def describe(self, sobject):
        return self.get(f"/sobjects/{sobject}/describe")

    # -- writes (sObject Collections, allOrNone=false) ----------------------
    def _collection(self, method, sobject, records):
        results = []
        for i in range(0, len(records), COLLECTION_SIZE):
            chunk = [{"attributes": {"type": sobject}, **r} for r in records[i:i + COLLECTION_SIZE]]
            results.extend(self.request(method, "/composite/sobjects", {"allOrNone": False, "records": chunk}))
        return results

    def insert(self, sobject, records):
        return self._collection("POST", sobject, records)

    def update(self, sobject, records):
        return self._collection("PATCH", sobject, records)

    def delete(self, ids):
        results = []
        for i in range(0, len(ids), COLLECTION_SIZE):
            chunk = ",".join(ids[i:i + COLLECTION_SIZE])
            results.extend(self.request("DELETE", "/composite/sobjects", params={"ids": chunk, "allOrNone": "false"}))
        return results

    # -- SOAP convertLead (not available over REST) -------------------------
    def convert_leads(self, converts):
        """converts: list of dicts with leadId, accountId, contactId, opportunityId|None, convertedStatus."""
        results = []
        for i in range(0, len(converts), 100):  # SOAP allows 200 per call; 100 keeps each call well under the CPU limit
            items = []
            for c in converts[i:i + 100]:
                parts = [f"<urn:accountId>{c['accountId']}</urn:accountId>",
                         f"<urn:contactId>{c['contactId']}</urn:contactId>",
                         f"<urn:convertedStatus>{escape(c['convertedStatus'])}</urn:convertedStatus>",
                         "<urn:leadId>" + c["leadId"] + "</urn:leadId>",
                         "<urn:overwriteLeadSource>false</urn:overwriteLeadSource>",
                         "<urn:sendNotificationEmail>false</urn:sendNotificationEmail>"]
                if c.get("opportunityId"):
                    parts.insert(3, "<urn:doNotCreateOpportunity>false</urn:doNotCreateOpportunity>")
                    parts.append(f"<urn:opportunityId>{c['opportunityId']}</urn:opportunityId>")
                else:
                    parts.insert(3, "<urn:doNotCreateOpportunity>true</urn:doNotCreateOpportunity>")
                items.append("<urn:leadConverts>" + "".join(parts) + "</urn:leadConverts>")
            self.get("/limits")  # refreshes the token first if it has expired (SOAP faults don't return 401)
            envelope = (
                '<?xml version="1.0" encoding="utf-8"?>'
                '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
                'xmlns:urn="urn:partner.soap.sforce.com">'
                f"<soapenv:Header><urn:SessionHeader><urn:sessionId>{self.token}</urn:sessionId></urn:SessionHeader>"
                "<urn:AssignmentRuleHeader><urn:useDefaultRule>false</urn:useDefaultRule></urn:AssignmentRuleHeader>"
                "<urn:DuplicateRuleHeader><urn:allowSave>true</urn:allowSave></urn:DuplicateRuleHeader>"
                "</soapenv:Header>"
                f"<soapenv:Body><urn:convertLead>{''.join(items)}</urn:convertLead></soapenv:Body></soapenv:Envelope>"
            )
            url = f"{self.instance_url}/services/Soap/u/{API_VERSION}"
            raw = self._send("POST", url, envelope.encode(), {"Content-Type": "text/xml; charset=utf-8", "SOAPAction": '""'}, ok=(500,))
            results.extend(_parse_convert(raw.decode()))
        return results

    # -- safety ----------------------------------------------------------------
    def guard(self, org_id, allow_production=False):
        """Refuse to run against any org other than the configured trial/developer/sandbox org."""
        if self.org_id[:15] != org_id[:15]:
            raise SystemExit(f"sf alias {self.alias} is org {self.org_id}, config expects {org_id}. Stopping.")
        org = next(self.query_all("SELECT Name, OrganizationType, IsSandbox, TrialExpirationDate FROM Organization"))
        is_test = org["IsSandbox"] or org["TrialExpirationDate"] or org["OrganizationType"] == "Developer Edition"
        if not is_test and not allow_production:
            raise SystemExit(f"Org {org_id} is a production {org['OrganizationType']} org, not a trial or sandbox. Stopping.")
        return org


def _parse_convert(xml_text):
    import xml.etree.ElementTree as ET
    ns = {"p": "urn:partner.soap.sforce.com", "s": "http://schemas.xmlsoap.org/soap/envelope/"}
    root = ET.fromstring(xml_text)
    fault = root.find(".//s:Fault", ns)
    if fault is not None:
        raise SalesforceError(500, fault.findtext("faultstring"), "convertLead")
    out = []
    for r in root.iter("{urn:partner.soap.sforce.com}result"):
        errors = [e.findtext("p:message", namespaces=ns) for e in r.findall("p:errors", ns)]
        out.append({"leadId": r.findtext("p:leadId", namespaces=ns),
                    "success": r.findtext("p:success", namespaces=ns) == "true",
                    "errors": errors})
    return out
