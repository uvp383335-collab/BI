import json, urllib.request, urllib.error, time, socket
T = open(r"C:/Users/Utkarsh/.hubspot/token.txt", encoding="utf-8-sig").read().strip()
H = {"Authorization": "Bearer " + T, "Content-Type": "application/json"}
def call(method, path, body=None):
    for attempt in range(7):
        try:
            r = urllib.request.urlopen(urllib.request.Request("https://api.hubapi.com" + path,
                data=json.dumps(body).encode() if body is not None else None, method=method, headers=H), timeout=120)
            raw = r.read(); return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500: time.sleep(2 ** attempt); continue
            return e.code, e.read().decode()[:600]
        except (TimeoutError, socket.timeout, urllib.error.URLError, ConnectionError):
            time.sleep(5); continue
    return 0, "retries exhausted"
assert call("GET", "/account-info/v3/details")[1]["portalId"] == 247726307
