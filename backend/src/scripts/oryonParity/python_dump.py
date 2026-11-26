"""
Dumps what every mrr_app (Python reference) page computes, for the parity check
against the Node port (backend/src/modules/metrics/oryon).

Each page function is called inside a Flask test request with the query string
of the view, and `render_template` is replaced by a function that returns the
template variables - so the dump is exactly what the Python page shows.

Usage (from the repo root):
    MONGO_DB=tenant_oryon_parity python backend/src/scripts/oryonParity/python_dump.py out.json
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import date, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "mrr_app")))

import app as A  # noqa: E402

A.render_template = lambda _tpl, **kw: kw
A.flash = lambda *a, **k: None

# page keys to keep: the computed series and the headline rows picked from it
KEEP = ("rows", "latest", "prev", "year_ago", "ttm", "q_rows", "quarters", "stacks", "by_line", "stale")

VIEWS = {
    "mrr": ("mrr_page", [{}]),
    "retention": ("retention_page", [{"grain": g, "window": w, "scope": s}
                                     for g in ("quarter", "month") for w in ("ttm", "period") for s in ("all", "subscription")]),
    "new_logos": ("newlogo_page", [{"grain": "quarter"}, {"grain": "month"}]),
    "cac": ("cac_page", [{}]),
    "cogs": ("cogs_page", [{"grain": g, "window": w} for g in ("month", "quarter") for w in ("period", "ttm")]),
    "ga": ("ga_page", [{"grain": g, "window": w} for g in ("month", "quarter") for w in ("period", "ttm")]),
    "ebitda": ("ebitda_page", [{"grain": g, "window": w} for g in ("month", "quarter") for w in ("period", "ttm")]),
    "ltv": ("ltv_page", [{"grain": "quarter"}, {"grain": "month"}]),
    "recurring": ("recurring_page", [{"grain": g, "window": w} for g in ("month", "quarter") for w in ("period", "ttm")]),
    "growth": ("growth_page", [{"grain": g, "window": w} for g in ("month", "quarter") for w in ("period", "ttm")]),
    "cash": ("cash_page", [{"grain": "month"}, {"grain": "quarter"}]),
    "fcf": ("fcf_page", [{"view": "ttm"}, {"view": "month"}]),
    "ccc": ("ccc_page", [{"view": "quarter"}, {"view": "month"}]),
    "concentration": ("conc_page", [{}]),
    "diversification": ("div_page", [{}]),
    "win_rate": ("wr_page", [{"view": v, "grain": g} for v in ("period", "ttm") for g in ("month", "quarter")]),
    "funnel": ("fn_page", [{"grain": g, "view": v} for g in ("month", "quarter") for v in ("period", "ttm")]),
    "mql": ("mql_page", [{"grain": g, "view": v} for g in ("month", "quarter") for v in ("period", "ttm")]),
    "roi": ("roi_page", [{"grain": g, "view": v} for g in ("quarter", "month") for v in ("period", "ttm")]),
    "msp": ("msp_page", [{"grain": g, "view": v} for g in ("quarter", "month") for v in ("period", "ttm")]),
}


def clean(v):
    if isinstance(v, float):
        if math.isinf(v):
            return "inf" if v > 0 else "-inf"
        if math.isnan(v):
            return None
        return v
    if isinstance(v, dict):
        return {str(k): clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if isinstance(v, set):
        return sorted(clean(x) for x in v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def main():
    out = {}
    only = set(sys.argv[2:])
    for name, (fn, views) in VIEWS.items():
        if only and name not in only:
            continue
        out[name] = []
        for q in views:
            with A.app.test_request_context("/", query_string=q):
                kw = getattr(A, fn)()
            entry = {"query": q, **{k: clean(kw[k]) for k in KEEP if k in kw}}
            if name == "win_rate":
                entry["headline"] = kw["info"]["headline"]   # the dashboard's CM-03 value is this competitor's rate
            out[name].append(entry)
        print(name, "ok", file=sys.stderr)
    with open(sys.argv[1], "w") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
