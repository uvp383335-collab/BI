import json, subprocess, sys
obj, out, props = sys.argv[1], sys.argv[2], sys.argv[3]
after, n = None, 0
with open(out, "w", encoding="utf-8") as f:
    while True:
        cmd = ["hubspot", "objects", "list", "--type", obj, "--limit", "100", "--format", "json", "--properties", props]
        if after: cmd += ["--after", after]
        r = json.loads(subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8").stdout)
        for d in r["data"]:
            f.write(json.dumps(d) + "\n"); n += 1
        after = (r.get("meta") or {}).get("next")
        if not after: break
print(n, file=sys.stderr)
