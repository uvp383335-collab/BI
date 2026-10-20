import json, subprocess, sys
obj, src = sys.argv[1], sys.argv[2]
data = open(src).read()
base = ["hubspot", "objects", "delete", "--type", obj]
info = json.loads(subprocess.run(base + ["--dry-run"], input=data, capture_output=True, text=True).stdout.splitlines()[0])
res = subprocess.run(base + ["--digest", info["digest"], "--confirm", str(info["impact"]["records_affected"])], input=data, capture_output=True, text=True)
lines = [json.loads(l) for l in res.stdout.splitlines() if l.strip()]
open(f"delete_result_{obj}.jsonl", "w").write(res.stdout)
fails = [l for l in lines if not l.get("ok")]
print(obj, "input", data.count("\n"), "results", len(lines), "ok", len(lines) - len(fails), "fail", len(fails))
for f in fails[:3]: print(json.dumps(f)[:300])
if res.stderr.strip(): print(res.stderr[-800:])
