"""
Checks the oryon-web portfolio API values (dashboardDump.ts) against the Python
reference dump (python_dump.py): every series point of every metric must equal
the value the Python page shows for that month / quarter.

    python dashboardCheck.py py.json dash.json [report.md]
"""
import json
import sys

py = json.load(open(sys.argv[1]))
dash = json.load(open(sys.argv[2]))["metrics"]


def view(name, **q):
    for v in py[name]:
        if all(v["query"].get(k) == x for k, x in q.items()):
            return v
    raise KeyError((name, q))


def by(rows, key="month"):
    return {r.get(key): r for r in rows or []}


def qend(r):  # cogs_periods quarter rows -> keyed by their end month when they are full quarters
    return r["end"] if len(r["months"]) == 3 and r["complete"] else None


def quarter_rows(name, **q):
    return {qend(r): r for r in view(name, **q)["rows"] if qend(r)}


ret = by(view("retention", grain="month", window="ttm", scope="all")["rows"], "m1")
nl = view("new_logos", grain="quarter")
cac = by(view("cac")["rows"])
ltv = by(view("ltv", grain="month")["rows"])
cogs = quarter_rows("cogs", grain="quarter", window="period")
ga = quarter_rows("ga", grain="quarter", window="period")
eb = quarter_rows("ebitda", grain="quarter", window="period")
rec = quarter_rows("recurring", grain="quarter", window="period")
gr = quarter_rows("growth", grain="quarter", window="period")
cash = by(view("cash", grain="month")["rows"])
fcf = by(view("fcf", view="ttm")["rows"])
ccc = by(view("ccc", view="month")["rows"])
conc = by(view("concentration")["rows"])
div = by(view("diversification")["rows"])
wr_view = view("win_rate", view="period", grain="month")
wr, wr_head = by(wr_view["rows"]), wr_view.get("headline")
msp = by(view("msp", grain="quarter", view="period")["rows"])
fn = by(view("funnel", grain="quarter", view="period")["rows"])
roi = by(view("roi", grain="quarter", view="period")["rows"])
mql = by(view("mql", grain="month", view="period")["rows"])


def g(d, m, k):
    r = d.get(m)
    return None if r is None else r.get(k)


def vc03(m):
    t, p = nl.get("ttm"), nl.get("prev")
    if not t or m != t["hi"]:
        return "skip"   # the Python page shows the 12-month growth only at the last complete close month
    return (t["arr"] - p["arr"]) / p["arr"] * 100 if p["arr"] and p["full"] else None


EXPECT = {
    "VC-01": lambda m: g(ret, m, "grr"), "VC-02": lambda m: g(ret, m, "nrr"), "VC-03": vc03,
    "VC-04": lambda m: g(cogs, m, "pct"), "VC-06": lambda m: g(cac, m, "payback"),
    "VC-07": lambda m: g(ltv, m, "ltv_cac"), "VC-09": lambda m: g(ga, m, "pct"), "VC-10": lambda m: g(eb, m, "margin"),
    "VC-12": lambda m: g(rec, m, "pct") if rec.get(m, {}).get("complete") else None,
    "VC-13": lambda m: g(gr, m, "growth") if gr.get(m, {}).get("has_prior") else None,
    "VC-14": lambda m: g(ltv, m, "base_ltv_cac"),
    "CB-05": lambda m: g(cash, m, "cash"), "CB-07": lambda m: g(fcf, m, "fcf_pct"), "CB-10": lambda m: g(ccc, m, "ccc"),
    "CM-02": lambda m: g(conc, m, "share"), "ER-05": lambda m: g(div, m, "share"),
    "CM-03": lambda m: (wr[m]["comp"].get(wr_head) or {}).get("rate") if m in wr and wr_head else None,
    "CM-05": lambda m: g(msp, m, "pct"), "CM-06": lambda m: g(fn, m, "m2s_pct"), "CM-07": lambda m: g(roi, m, "blended"),
    "CM-08": lambda m: g(mql, m, "mqls"),
}


def month_of(p):
    return f"{p[:4]}-{int(p[-1]) * 3:02d}" if "Q" in p else p


bad, checked, lines = 0, 0, ["| Metric | Periods checked | Mismatches | Latest period | Python | Node API |", "|---|---|---|---|---|---|"]
for mid, views in dash.items():
    n = nb = 0
    last = None
    for asof, v in views.items():
        for pt in v["series"]:
            m = month_of(pt["period"])
            e = EXPECT[mid](m)
            if e == "skip":
                continue
            a = pt["value"]
            n += 1
            ok = (a is None and e is None) or (a is not None and e is not None and abs(a - e) <= 1e-9 * max(1, abs(e)))
            if not ok:
                nb += 1
                print(f"  MISMATCH {mid} {pt['period']}: python={e!r} node={a!r}")
            if asof == "2026-Q3" or last is None:
                last = (pt["period"], e, a)
    bad += nb
    checked += n
    f = lambda x: "-" if x is None else f"{x:,.4f}"
    lines.append(f"| {mid} | {n} | {nb} | {last[0]} | {f(last[1])} | {f(last[2])} |")
text = "\n".join(lines) + f"\n\n{checked} dashboard series points checked, mismatches: {bad}"
print(text)
if len(sys.argv) > 3:
    open(sys.argv[3], "w", encoding="utf8").write(text + "\n")
sys.exit(1 if bad else 0)
