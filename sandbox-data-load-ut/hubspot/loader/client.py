"""Minimal HubSpot API client: retries, rate-limit backoff, pagination, portal guard."""
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "https://api.hubapi.com"


class HubSpotError(Exception):
    def __init__(self, status, body, path):
        super().__init__(f"HubSpot {status} on {path}: {str(body)[:500]}")
        self.status = status
        self.body = body
        self.path = path


class HubSpot:
    def __init__(self, token, portal_id, timeout=120, max_retries=7):
        self.token = token
        self.portal_id = portal_id
        self.timeout = timeout
        self.max_retries = max_retries

    def request(self, method, path, body=None, params=None, ok=(200, 201, 204, 207)):
        url = BASE_URL + path
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        for attempt in range(self.max_retries):
            try:
                req = urllib.request.Request(url, data=data, method=method, headers=headers)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if e.code == 429 or e.code >= 500:
                    time.sleep(min(2 ** attempt, 30))
                    continue
                if e.code in ok:
                    return json.loads(text) if text else {}
                raise HubSpotError(e.code, text, path) from None
            except (TimeoutError, socket.timeout, urllib.error.URLError, ConnectionError):
                # Callers only send idempotent writes (upserts, association creates)
                # or reconcile before retrying, so a retry after a timeout is safe.
                time.sleep(min(2 ** attempt, 30))
        raise HubSpotError(0, "retries exhausted", path)

    def get(self, path, **params):
        return self.request("GET", path, params=params or None)

    def post(self, path, body):
        return self.request("POST", path, body)

    def guard(self, allow_non_test=False):
        """Refuse to run against any account other than the configured test account."""
        info = self.get("/account-info/v3/details")
        if info.get("portalId") != self.portal_id:
            raise SystemExit(f"Token is for portal {info.get('portalId')}, config expects {self.portal_id}. Stopping.")
        if info.get("accountType") != "DEVELOPER_TEST" and not allow_non_test:
            raise SystemExit(f"Portal {self.portal_id} is {info.get('accountType')}, not DEVELOPER_TEST. Stopping.")
        return info

    def list_all(self, object_type, properties=(), extra_params=None):
        """Yield every record of an object type via the v3 list endpoint (no 10k search cap)."""
        after = None
        while True:
            params = {"limit": 100}
            if properties:
                params["properties"] = list(properties)
            if extra_params:
                params.update(extra_params)
            if after:
                params["after"] = after
            page = self.get(f"/crm/v3/objects/{object_type}", **params)
            yield from page.get("results", [])
            after = (page.get("paging") or {}).get("next", {}).get("after")
            if not after:
                return

    def search_total(self, object_type, filters=()):
        body = {"filterGroups": [{"filters": list(filters)}] if filters else [], "limit": 1}
        return self.post(f"/crm/v3/objects/{object_type}/search", body).get("total", 0)
