"""
Compares the Python (python_dump.py) and Node (nodeDump.ts) Oryon dumps.

Every number is compared; a difference is a mismatch when it is larger than
1e-6 absolute AND 1e-9 relative (float summation order - Python's own set
ordering changes between runs - moves only the last bits). Prints one line per
metric/view and a summary; exit code 1 on any mismatch.

    python compare.py py.json node.json [report.md]
"""
import json
import math
import sys


def walk(a, b, path, out, stats):
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None or isinstance(a, str) or isinstance(b, str):
        stats["values"] += 1
        if a != b:
            out.append((path, a, b))
        else:
            stats["exact"] += 1
        return
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        stats["values"] += 1
        d = abs(a - b)
        if d == 0:
            stats["exact"] += 1
        elif d > 1e-6 and d > 1e-9 * max(abs(a), abs(b)):
            out.append((path, a, b))
        else:
            stats["max_rel"] = max(stats["max_rel"], d / max(abs(a), abs(b), 1e-300))
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append((f"{path}.{k}", a.get(k, "<missing>"), b.get(k, "<missing>")))
                continue
            walk(a[k], b[k], f"{path}.{k}", out, stats)
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append((f"{path}[len]", len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            walk(x, y, f"{path}[{i}]", out, stats)
        return
    out.append((path, a, b))


def main():
    py, nd = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
    lines, total_bad, total_vals, total_exact, worst = [], 0, 0, 0, 0.0
    lines.append("| Metric | View | Rows | Values compared | Mismatches | Latest (Python = Node) |")
    lines.append("|---|---|---|---|---|---|")
    for name in py:
        for pv, nv in zip(py[name], nd.get(name, [])):
            out, stats = [], {"values": 0, "exact": 0, "max_rel": 0.0}
            walk({k: v for k, v in pv.items() if k != "query"}, {k: v for k, v in nv.items() if k != "query"}, name, out, stats)
            total_bad += len(out)
            total_vals += stats["values"]
            total_exact += stats["exact"]
            worst = max(worst, stats["max_rel"])
            q = ",".join(f"{k}={v}" for k, v in pv["query"].items()) or "default"
            lat = pv.get("latest") or {}
            head = next((f"{k}={lat[k]:.4f}" for k in ("grr", "total_mrr", "payback", "pct", "margin", "ltv_cac", "growth", "runway",
                                                        "fcf_pct", "ccc", "share", "logged", "m2s_pct", "blended") if isinstance(lat.get(k), (int, float))), "-")
            lines.append(f"| {name} | {q} | {len(pv.get('rows') or [])} | {stats['values']} | {len(out)} | {head} |")
            for p, a, b in out[:8]:
                print(f"  MISMATCH {name} [{q}] {p}: py={a!r} node={b!r}")
        if len(py[name]) != len(nd.get(name, [])):
            print(f"  MISMATCH {name}: view count {len(py[name])} vs {len(nd.get(name, []))}")
            total_bad += 1
    summary = (f"\n{total_vals} values compared, {total_exact} bit-identical, mismatches: {total_bad}; "
               f"largest relative float difference among the rest: {worst:.2e}")
    text = "\n".join(lines) + summary
    print(text)
    if len(sys.argv) > 3:
        open(sys.argv[3], "w", encoding="utf8").write(text + "\n")
    sys.exit(1 if total_bad else 0)


if __name__ == "__main__":
    main()
