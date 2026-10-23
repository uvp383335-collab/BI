import json, subprocess, sys
src, out = sys.argv[1], sys.argv[2]
data = open(src, encoding="utf-8").read()
base = ["hubspot", "objects", "upsert", "--type", "contacts", "--id-property", "ridgeline_id"]
dry = subprocess.run(base + ["--dry-run"], input=data, capture_output=True, text=True, encoding="utf-8").stdout
info = json.loads(dry.splitlines()[0])
res = subprocess.run(base + ["--digest", info["digest"], "--confirm", str(info["impact"]["records_affected"])],
                     input=data, capture_output=True, text=True, encoding="utf-8")
open(out, "w", encoding="utf-8").write(res.stdout)
lines = [json.loads(l) for l in res.stdout.splitlines() if l.strip()]
print("in", data.count("\n"), "out", len(lines), "ok", sum(1 for l in lines if l.get("ok")), "fail", sum(1 for l in lines if not l.get("ok")), file=sys.stderr)
if res.stderr.strip(): print(res.stderr[:1500], file=sys.stderr)
