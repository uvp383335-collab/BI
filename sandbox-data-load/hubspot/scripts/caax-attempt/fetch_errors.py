import json, subprocess, sys, os
iid = sys.argv[1]; after = None; n = 0
env = dict(os.environ, HUBSPOT_ACCESS_TOKEN=open(r"C:/Users/Utkarsh/.hubspot/token.txt", encoding="utf-8-sig").read().strip())
with open(f"errors_all_{iid}.jsonl", "w") as f:
    while True:
        cmd = ["hubspot", "imports", "errors", iid, "--format", "json"] + (["--after", after] if after else [])
        d = json.loads(subprocess.run(cmd, capture_output=True, text=True, env=env).stdout)
        for e in d["data"]: f.write(json.dumps(e) + "\n"); n += 1
        after = (d.get("meta") or {}).get("next")
        if not after: break
print(n)
