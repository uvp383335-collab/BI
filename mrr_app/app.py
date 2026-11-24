#!/usr/bin/env python3
"""
Oryon MRR app (Flask)
=====================

    Settings  ->  every QuickBooks product found in the tenant's invoices, with an
                  automatic MRR mapping already selected (subscription monthly /
                  quarterly / annual, retainer, or not MRR). Review, change, Save.
                  Also: CAD->USD rates, first month, early-invoice day.
    MRR       ->  monthly MRR, ARR and active customers from the invoices using the
                  saved mapping, with a chart, CSV download and per-customer drill-down.

Data:   MONGO_URI (default mongodb://localhost:27017)
        MONGO_DB  (default tenant_6b053ce9f7b1f33b5dc92236)
        reads  `invoices` and `products`
        writes `mrr_product_mapping` and `mrr_settings` (its own collections -
        the backend's `products` collection is never modified)

Run:    pip install -r requirements.txt
        python app.py           ->  http://localhost:5050
"""

from __future__ import annotations

import csv
import io
import os
from datetime import datetime, timezone

from collections import defaultdict
from flask import Flask, Response, flash, redirect, render_template, request, url_for
from pymongo import MongoClient

from mrr_engine import (DEFAULT_SETTINGS, MAPPING_TYPES, SEGMENTS, add_months, compute_mrr, compute_native_mrr,
                        fx_for, link_customers, month_range, new_logos, period_ends, quarter_of, retention,
                        suggest_mapping, summarize, summarize_new_logos, to_date_str, window_start,
                        cac_series, pl_by_month, suggest_cac_account, account_number,
                        PRODUCT_LINES, COGS_LINE_CHOICES, suggest_cogs_line, suggest_cogs_da, cogs_period,
                        suggest_ga_account, ga_period, EBITDA_CATEGORIES, suggest_ebitda_account, ebitda_period,
                        ltv_cac_row, suggest_recurring_tag, recurring_period, growth_period, ltv_base_fields,
                        cash_series, suggest_cash_account, bs_accounts, CASH_CATEGORIES, suggest_cash_category,
                        CAPEX_CATEGORIES, suggest_capex_category, capex_accounts, suggest_fa_da, fcf_series,
                        WC_CATEGORIES, WC_ASSET_CATS, WC_LIAB_CATS, WC_SECTIONS, suggest_wc_category,
                        CCC_CATEGORIES, CCC_SECTIONS, suggest_ccc_category, ccc_series,
                        customer_groups, concentration_series, invoice_classes,
                        STD_COMPETITOR, STD_COMPETITORS, suggest_competitor_field, suggest_loss_reason_field,
                        suggest_new_business_types, win_rate_series,
                        FUNNEL_STEPS, suggest_marketing_sources, funnel_contacts, funnel_series, funnel_rate,
                        quarter_key, mql_vs_plan,
                        ROI_DEFAULT_CHANNELS, suggest_roi_sources, suggest_roi_accounts, roi_deal_rows,
                        roi_channel_of, roi_series, duplicate_accounts, msp_rows, msp_series, deal_outcome)

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGO_DB", "tenant_6b053ce9f7b1f33b5dc92236")
PROVIDER = os.environ.get("MRR_PROVIDER", "quickbooks")
QBO_CUSTOMERS = os.environ.get("QBO_CUSTOMERS_COLLECTION", "quickbookscustomers")
SF_ACCOUNTS = os.environ.get("SF_ACCOUNTS_COLLECTION", "salesforceaccounts")
DEALS = os.environ.get("DEALS_COLLECTION", "deals")
STAGE_DEFS = os.environ.get("STAGE_DEFS_COLLECTION", "pipelinestagedefinitions")
CONTACTS = os.environ.get("CONTACTS_COLLECTION", "contacts")
PL_MONTHLY = os.environ.get("PL_MONTHLY_COLLECTION", "plmonthlysnapshots")
BS_MONTHLY = os.environ.get("BS_MONTHLY_COLLECTION", "balancesheetmonthlysnapshots")
CAC_THRESHOLD = 18  # months - spec VC-06: payback above 18 months is a warning

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "oryon-mrr-local")
_client: MongoClient | None = None


def db():
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI)
    return _client[MONGO_DB]


# ---------------------------------------------------------------------------
# data access
# ---------------------------------------------------------------------------
def load_invoices() -> list[dict]:
    return list(db()["invoices"].find(
        {"provider": PROVIDER},
        {"_id": 0, "customerRecordId": 1, "txnDate": 1, "billingAddress.country": 1,
         "lines.itemId": 1, "lines.amount": 1, "lines.className": 1, "totalAmount": 1}))


def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    doc = db()["mrr_settings"].find_one({"_id": "settings"}) or {}
    for k in DEFAULT_SETTINGS:
        if k in doc:
            s[k] = doc[k]
    return s


def product_catalog(invoices: list[dict]) -> list[dict]:
    """Every item that appears on an invoice (plus everything in `products`), with usage
    stats, the backend's category, the auto-suggestion and the saved mapping."""
    stats: dict[str, dict] = {}
    for inv in invoices:
        month = to_date_str(inv.get("txnDate"))[:7]
        for line in inv.get("lines") or []:
            item = str(line.get("itemId") or "")
            if not item:
                continue
            s = stats.setdefault(item, {"lines": 0, "amount": 0.0, "classes": set(), "first": month, "last": month})
            s["lines"] += 1
            s["amount"] += float(line.get("amount") or 0)
            if line.get("className"):
                s["classes"].add(line["className"])
            s["first"], s["last"] = min(s["first"], month), max(s["last"], month)

    products = {str(p.get("providerRecordId")): p for p in db()["products"].find(
        {"provider": PROVIDER}, {"_id": 0, "providerRecordId": 1, "name": 1, "category": 1, "billingFrequency": 1})}
    saved = {d["itemId"]: d for d in db()["mrr_product_mapping"].find({}, {"_id": 0})}

    out = []
    for item in sorted(set(stats) | set(products), key=lambda x: (-stats.get(x, {}).get("amount", 0), x)):
        p = products.get(item, {})
        name = p.get("name") or f"Item {item}"
        auto, reason = suggest_mapping(name, p.get("category"), p.get("billingFrequency"))
        s = stats.get(item, {"lines": 0, "amount": 0.0, "classes": set(), "first": "", "last": ""})
        out.append({
            "itemId": item, "name": name,
            "category": p.get("category") or "-", "frequency": p.get("billingFrequency") or "",
            "lines": s["lines"], "amount": s["amount"], "classes": ", ".join(sorted(s["classes"])) or "-",
            "first": s["first"], "last": s["last"],
            "auto": auto, "reason": reason,
            "mapping": saved.get(item, {}).get("type", auto),
            "saved": item in saved,
        })
    return out


def current_mapping(catalog: list[dict]) -> dict[str, str]:
    return {p["itemId"]: p["mapping"] for p in catalog}


def calculate(start: str | None = None, end: str | None = None):
    invoices = load_invoices()
    settings = load_settings()
    catalog = product_catalog(invoices)
    mrr, is_cad = compute_mrr(invoices, current_mapping(catalog), settings)
    months_with_data = sorted(m for m in mrr if mrr[m])
    last_invoice = max((to_date_str(i.get("txnDate"))[:7] for i in invoices if i.get("txnDate")), default=None)
    start = start or settings["start_month"]
    end = end or last_invoice or (months_with_data[-1] if months_with_data else start)
    rows = summarize(mrr, month_range(start, end)) if start <= end else []
    return rows, mrr, is_cad, catalog, settings, len(invoices)


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Metric catalogue (Oryon spec codes) - drives the grouped menu and page titles
# ---------------------------------------------------------------------------
METRIC_GROUPS = [
    ("Value creation", [
        ("VC-01", "Gross revenue retention (GRR)", "retention_page"),
        ("VC-02", "Net revenue retention (NRR)", "retention_page"),
        ("VC-03", "New-logo revenue growth", "newlogo_page"),
        ("VC-04", "COGS % and mix", "cogs_page"),
        ("VC-06", "CAC & payback period", "cac_page"),
        ("VC-07", "LTV / CAC - new customers", "ltv_page"),
        ("VC-09", "G&A % of revenue", "ga_page"),
        ("VC-10", "EBITDA margin trend", "ebitda_page"),
        ("VC-12", "Recurring revenue % of total", "recurring_page"),
        ("VC-13", "Revenue growth (recurring / non-rec.)", "growth_page"),
        ("VC-14", "LTV / CAC - whole base", "ltv_page"),
    ]),
    ("Capital & balance sheet", [
        ("CB-05", "Cash position & runway", "cash_page"),
        ("CB-07", "Free cash flow conversion", "fcf_page"),
        ("CB-10", "Cash conversion cycle", "ccc_page"),
        ("CB-15", "Currency exposure & hedging", None),
    ]),
    ("Customer & market", [
        ("CM-01", "Net Promoter Score (NPS)", None),
        ("CM-02", "Customer concentration (top 10)", "conc_page"),
        ("CM-03", "Competitive win rate", "wr_page"),
        ("CM-04", "Pipeline coverage ratio", None),
        ("CM-05", "Marketing-sourced pipeline %", "msp_page"),
        ("CM-06", "Funnel conversion (Lead → won)", "fn_page"),
        ("CM-07", "Marketing ROI by channel", "roi_page"),
        ("CM-08", "Lead volume vs plan (MQLs)", "mql_page"),
    ]),
    ("Exit readiness", [
        ("ER-05", "Customer & revenue diversification", "div_page"),
    ]),
]


def metric_codes_for(endpoint: str | None) -> list[str]:
    """Codes of the metrics shown on a page (detail / csv endpoints map to their page)."""
    if not endpoint:
        return []
    base = endpoint
    for suffix in ("_detail", "_csv"):
        if base.endswith(suffix):
            base = base[: -len(suffix)] + "_page"
    alias = {"month_detail": "mrr_page", "newlogo_detail": "newlogo_page"}
    base = alias.get(endpoint, base)
    return [c for _, items in METRIC_GROUPS for c, _, ep in items if ep and ep == base]


@app.context_processor
def inject_metric_menu():
    path = request.path or ""
    groups = []
    for name, items in METRIC_GROUPS:
        rows, active = [], False
        for code, label, ep in items:
            url = url_for(ep) if ep else None
            on = bool(url) and path.startswith(url)
            active = active or on
            rows.append({"code": code, "label": label, "url": url, "on": on})
        groups.append({"name": name, "items": rows, "on": active})
    return {"metric_groups": groups, "page_codes": metric_codes_for(request.endpoint)}


@app.route("/")
def index():
    return redirect(url_for("mrr_page"))


@app.route("/settings")
def settings_page():
    catalog = product_catalog(load_invoices())
    settings = load_settings()
    unsaved = sum(1 for p in catalog if not p["saved"])
    fx_text = "\n".join(f"{m}, {r}" for m, r in sorted(settings["fx_cad_usd"].items()))
    pl = pl_by_month(load_pl_snapshots())
    cac_accs, cac_saved = cac_accounts(pl)
    last12 = sorted(m for m in pl if pl[m]["revenue"])[-12:]
    cogs_accs, _, _, cogs_saved = cogs_accounts(pl)
    ga_accs, _, ga_saved = ga_accounts(pl)
    eb_accs, _, _, eb_saved = ebitda_accounts(pl)
    rt_accs, _, rt_saved = recurring_accounts(pl)
    bs = load_bs_snapshots()
    bs_last = max(bs, key=lambda d: d["month"]) if bs else None
    cash_accs, _, cash_accs_saved, _ = cash_accounts(bs)
    cash_sections_avail = [(k, (bs_last["sectionTotals"].get(k) or {}).get("Total")) for k in
                           sorted({k for d in bs for k in (d.get("sectionTotals") or {})})] if bs else []
    plan_text = "\n".join(f"{m}, {round(e, 2)}, {round(r, 2)}" for m, (e, r) in sorted(load_plan().items()))
    capex_accs, _, capex_saved = fcf_capex_accounts(bs)
    fa_da_accs, _ = fcf_fa_da_accounts(eb_accs)
    wc_accs, _, wc_saved = fcf_wc_accounts(bs)
    ccc_accs, _, ccc_saved = ccc_accounts(bs)
    wr = wr_config()
    fn = fn_config()
    return render_template("settings.html", catalog=catalog, types=MAPPING_TYPES, settings=settings,
                           fx_text=fx_text, unsaved=unsaved, db_name=MONGO_DB, cac_accs=cac_accs,
                           cac_saved=cac_saved, cac_window=(last12[0], last12[-1]) if last12 else None,
                           cogs_accs=cogs_accs, cogs_saved=cogs_saved, cogs_choices=COGS_LINE_CHOICES,
                           ga_accs=ga_accs, ga_saved=ga_saved, eb_accs=eb_accs, eb_saved=eb_saved,
                           eb_cats=EBITDA_CATEGORIES, plan_text=plan_text, rt_accs=rt_accs, rt_saved=rt_saved,
                           cash_sections_avail=cash_sections_avail, bs_last_month=bs_last["month"] if bs_last else None,
                           bs_collection=BS_MONTHLY, cash_accs=cash_accs, cash_accs_saved=cash_accs_saved,
                           cash_cats=CASH_CATEGORIES, capex_accs=capex_accs, capex_saved=capex_saved,
                           capex_cats=CAPEX_CATEGORIES, fa_da_accs=fa_da_accs,
                           wc_accs=wc_accs, wc_saved=wc_saved, wc_cats=WC_CATEGORIES, wc_sections=WC_SECTIONS,
                           wc_section_totals={k: (bs_last["sectionTotals"].get(k) or {}).get("Total") for k in WC_SECTIONS} if bs_last else {},
                           ccc_accs=ccc_accs, ccc_saved=ccc_saved, conc_classes=invoice_classes(load_invoices()), wr=wr, fn=fn, fn_steps=FUNNEL_STEPS,
                           mql_plan=sorted(mql_plan_quarters().items()), roi=roi_config(), msp=msp_config(), div=div_settings(), ccc_cats=CCC_CATEGORIES, ccc_sections=CCC_SECTIONS,
                           bs_sections=sorted({k for d in bs for k in (d.get("sectionTotals") or {})} - _BS_ROLLUPS))


@app.post("/settings/mapping")
def save_mapping():
    now = datetime.now(timezone.utc)
    col = db()["mrr_product_mapping"]
    n = 0
    for key, value in request.form.items():
        if key.startswith("map_") and value in MAPPING_TYPES:
            col.update_one({"itemId": key[4:]}, {"$set": {"itemId": key[4:], "type": value, "updatedAt": now}},
                           upsert=True)
            n += 1
    flash(f"Saved the mapping for {n} products.", "ok")
    return redirect(url_for("settings_page"))


@app.post("/settings/mapping/reset")
def reset_mapping():
    db()["mrr_product_mapping"].delete_many({})
    flash("Mapping reset to the automatic suggestions (not saved yet - review and click Save).", "ok")
    return redirect(url_for("settings_page"))


@app.post("/settings/general")
def save_general():
    form = request.form
    errors, fx = [], {}
    for raw in form.get("fx_cad_usd", "").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            m, r = [x.strip() for x in raw.replace("\t", ",").split(",")[:2]]
            datetime.strptime(m, "%Y-%m")
            fx[m] = float(r)
        except (ValueError, TypeError):
            errors.append(raw)
    start = form.get("start_month", "").strip()
    try:
        datetime.strptime(start, "%Y-%m")
    except ValueError:
        errors.append(f"start month '{start}'")
    try:
        early = int(form.get("early_invoice_day", 16))
        if not 1 <= early <= 31:
            raise ValueError
    except ValueError:
        errors.append("early invoice day must be 1-31")
        early = 16
    if errors:
        flash("Not saved - fix these: " + "; ".join(errors[:5]), "err")
        return redirect(url_for("settings_page"))
    countries = [c.strip().upper() for c in form.get("cad_countries", "").split(",") if c.strip()]
    try:
        lag = max(0, min(6, int(form.get("newlogo_lag_months", 1))))
    except ValueError:
        lag = 1
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {
        "start_month": start, "early_invoice_day": early, "cad_countries": countries, "fx_cad_usd": fx,
        "newlogo_lag_months": lag, "newlogo_group_parent": form.get("newlogo_group_parent") == "on"}},
        upsert=True)
    flash("Settings saved.", "ok")
    return redirect(url_for("settings_page"))


@app.route("/mrr")
def mrr_page():
    start, end = request.args.get("from") or None, request.args.get("to") or None
    rows, _, is_cad, catalog, settings, n_inv = calculate(start, end)
    unsaved = sum(1 for p in catalog if not p["saved"])
    latest = rows[-1] if rows else None
    return render_template("mrr.html", rows=rows, latest=latest, n_inv=n_inv, n_cad=len(is_cad),
                           start=start or settings["start_month"], end=end or (rows[-1]["month"] if rows else ""),
                           unsaved=unsaved, db_name=MONGO_DB)


@app.route("/mrr/<month>")
def month_detail(month):
    _, mrr, is_cad, _, _, _ = calculate()
    custs = sorted(((c, v["subscription"], v["retainer"], v["subscription"] + v["retainer"],
                      (v["subscription"] + v["retainer"]) * 12)
                    for c, v in mrr.get(month, {}).items() if v["subscription"] + v["retainer"] > 0.005),
                   key=lambda x: -x[3])
    total = sum(c[3] for c in custs)
    return render_template("month.html", month=month, custs=custs, total=total, is_cad=is_cad)


@app.route("/mrr.csv")
def mrr_csv():
    rows, *_ = calculate(request.args.get("from") or None, request.args.get("to") or None)
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=mrr_monthly.csv"})


@app.route("/mrr/<month>.csv")
def month_csv(month):
    _, mrr, is_cad, *_ = calculate()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["month", "customerRecordId", "currency", "subscription_mrr_usd", "retainer_mrr_usd",
                "total_mrr_usd", "arr_usd"])
    for c, v in sorted(mrr.get(month, {}).items()):
        t = v["subscription"] + v["retainer"]
        if t > 0.005:
            w.writerow([month, c, "CAD" if is_cad.get(c) else "USD", round(v["subscription"], 2),
                        round(v["retainer"], 2), round(t, 2), round(t * 12, 2)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=mrr_customers_{month}.csv"})


# ---------------------------------------------------------------------------
# retention: GRR / NRR
# ---------------------------------------------------------------------------
def retention_inputs():
    invoices = load_invoices()
    settings = load_settings()
    catalog = product_catalog(invoices)
    native, is_cad = compute_native_mrr(invoices, current_mapping(catalog), settings)
    mrr_months = sorted(m for m, custs in native.items()
                        if any(v["subscription"] + v["retainer"] > 0.005 for v in custs.values()))
    last_invoice = max((to_date_str(i.get("txnDate"))[:7] for i in invoices if i.get("txnDate")), default=None)
    # annual invoices are only fully captured once the data covers 12 months, so a cohort
    # that starts earlier than this understates starting MRR
    reliable_from = add_months(mrr_months[0], 11) if mrr_months else None
    unsaved = sum(1 for p in catalog if not p["saved"])
    return native, is_cad, settings, last_invoice, reliable_from, unsaved


def retention_args():
    grain = request.args.get("grain", "quarter")
    grain = grain if grain in ("month", "quarter") else "quarter"
    window = request.args.get("window", "ttm")
    window = window if window in ("ttm", "period") else "ttm"
    return grain, window, request.args.get("scope", "all") == "subscription"


@app.route("/retention")
def retention_page():
    grain, window, sub_only = retention_args()
    native, is_cad, settings, last_invoice, reliable_from, unsaved = retention_inputs()
    rates = settings["fx_cad_usd"]
    end = request.args.get("to") or last_invoice or ""
    start = request.args.get("from") or (add_months(reliable_from, 12) if reliable_from and window == "ttm"
                                         else reliable_from or settings["start_month"])
    rows = []
    for m1 in period_ends(start, end, grain) if start and end else []:
        m0 = window_start(m1, grain, window)
        r = retention(native, is_cad, rates, m0, m1, subscription_only=sub_only)
        if r:
            r["reliable"] = bool(reliable_from) and m0 >= reliable_from
            r["label"] = (f"Q{(int(m1[5:7]) - 1) // 3 + 1}-{m1[:4]}" if grain == "quarter" else m1)
            rows.append(r)
    latest = rows[-1] if rows else None
    return render_template("retention.html", rows=rows, latest=latest, grain=grain, window=window,
                           sub_only=sub_only, start=start, end=end, reliable_from=reliable_from,
                           unsaved=unsaved, db_name=MONGO_DB)


@app.route("/retention/<m1>")
def retention_detail(m1):
    grain, window, sub_only = retention_args()
    native, is_cad, settings, *_ = retention_inputs()
    m0 = window_start(m1, grain, window)
    r = retention(native, is_cad, settings["fx_cad_usd"], m0, m1, subscription_only=sub_only, with_customers=True)
    if not r:
        flash(f"No customers with MRR in {m0}.", "err")
        return redirect(url_for("retention_page", grain=grain, window=window))
    bucket = request.args.get("bucket", "")
    custs = [c for c in r["customers"] if not bucket or c["bucket"] == bucket]
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["start_month", "end_month", "customerRecordId", "currency", "start_mrr_usd", "end_mrr_usd",
                    "change_usd", "bucket"])
        for c in custs:
            w.writerow([m0, m1, c["customer"], c["currency"], round(c["start"], 2), round(c["end"], 2),
                        round(c["change"], 2), c["bucket"]])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=retention_{m0}_to_{m1}.csv"})
    return render_template("retention_detail.html", r=r, custs=custs, bucket=bucket, grain=grain, window=window,
                           sub_only=sub_only, rate=fx_for(m0, settings["fx_cad_usd"]), db_name=MONGO_DB)


@app.route("/retention.csv")
def retention_csv():
    grain, window, sub_only = retention_args()
    native, is_cad, settings, last_invoice, reliable_from, _ = retention_inputs()
    end = request.args.get("to") or last_invoice
    start = request.args.get("from") or reliable_from
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["start_month", "end_month", "cohort_customers", "starting_mrr", "churn", "downgrades", "upgrades",
                "kept_mrr", "ending_mrr", "grr_pct", "nrr_pct", "churned_customers", "downgraded", "upgraded",
                "flat", "reliable"])
    for m1 in period_ends(start, end, grain):
        m0 = window_start(m1, grain, window)
        r = retention(native, is_cad, settings["fx_cad_usd"], m0, m1, subscription_only=sub_only)
        if r:
            w.writerow([m0, m1, r["cohort"], round(r["S"], 2), round(r["C"], 2), round(r["Dn"], 2), round(r["U"], 2),
                        round(r["K"], 2), round(r["E"], 2), round(r["grr"], 2), round(r["nrr"], 2),
                        r["churn"], r["downgrade"], r["upgrade"], r["flat"],
                        bool(reliable_from) and m0 >= reliable_from])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=retention_{grain}_{window}.csv"})


# ---------------------------------------------------------------------------
# new logos: QuickBooks invoices + Salesforce accounts
# ---------------------------------------------------------------------------
def newlogo_inputs():
    invoices = load_invoices()
    settings = load_settings()
    catalog = product_catalog(invoices)
    mrr, _ = compute_mrr(invoices, current_mapping(catalog), settings)
    qbo_customers = list(db()[QBO_CUSTOMERS].find({"provider": PROVIDER},
                                                   {"_id": 0, "providerRecordId": 1, "displayName": 1, "parentRecordId": 1}))
    sf_accounts = list(db()[SF_ACCOUNTS].find({"provider": "salesforce"},
                                               {"_id": 0, "providerRecordId": 1, "name": 1, "segment": 1,
                                                "parentRecordId": 1, "qboCustomerId": 1}))
    links = link_customers(qbo_customers, sf_accounts)
    lag = int(settings.get("newlogo_lag_months", 1))
    logos = new_logos(mrr, links, lag, bool(settings.get("newlogo_group_parent")))
    mrr_months = sorted(m for m, c in mrr.items() if any(v["subscription"] + v["retainer"] > 0.005 for v in c.values()))
    last_invoice = max((to_date_str(i.get("txnDate"))[:7] for i in invoices if i.get("txnDate")), default=None)
    # customers already paying when the data starts only show up at their first renewal (up to
    # 12 months later), so "first MRR" is only a real new logo from 12 months after MRR begins
    first_valid_billing = add_months(mrr_months[0], 12) if mrr_months else None
    first_valid_close = add_months(first_valid_billing, -lag) if first_valid_billing else None
    complete_until = add_months(last_invoice, -lag) if last_invoice else None
    with_mrr = {l["customer"] for l in logos}
    linked = sum(1 for c in with_mrr if (links.get(c) or {}).get("account"))
    info = {"lag": lag, "group_parent": bool(settings.get("newlogo_group_parent")), "first_valid_close": first_valid_close,
            "complete_until": complete_until, "last_invoice": last_invoice, "customers": len(with_mrr), "linked": linked,
            "n_qbo": len(qbo_customers), "n_sf": len(sf_accounts), "unsaved": sum(1 for p in catalog if not p["saved"])}
    return logos, info


def newlogo_periods(grain, start, end):
    months = month_range(start, end)
    if grain == "quarter":
        out = []
        for m in months:
            q = quarter_of(m)
            if q not in out:
                out.append(q)
        return out
    return months


@app.route("/new-logos")
def newlogo_page():
    grain = request.args.get("grain", "quarter")
    grain = grain if grain in ("month", "quarter") else "quarter"
    logos, info = newlogo_inputs()
    start = request.args.get("from") or info["first_valid_close"] or load_settings()["start_month"]
    if grain == "quarter" and not request.args.get("from"):
        while int(start[5:7]) % 3 != 1:   # first full quarter
            start = add_months(start, 1)
    end = request.args.get("to") or info["last_invoice"] or start
    rows = summarize_new_logos([l for l in logos if l["close_month"] >= (info["first_valid_close"] or "")],
                               newlogo_periods(grain, start, end), grain, info["complete_until"] or "")
    # trailing 12 complete close months vs the 12 before
    cu = info["complete_until"]
    ttm = prev = None
    if cu:
        def window(lo, hi):
            sel = [l for l in logos if lo <= l["close_month"] <= hi and l["counted"]
                   and l["close_month"] >= (info["first_valid_close"] or "")]
            seg = {s: {"arr": sum(l["arr"] for l in sel if l["segment"] == s),
                       "n": sum(1 for l in sel if l["segment"] == s)} for s in SEGMENTS}
            return {"lo": lo, "hi": hi, "arr": sum(l["arr"] for l in sel), "n": len(sel), "seg": seg,
                    "full": lo >= (info["first_valid_close"] or "")}
        ttm = window(add_months(cu, -11), cu)
        prev = window(add_months(cu, -23), add_months(cu, -12))
    return render_template("new_logos.html", rows=rows, grain=grain, start=start, end=end, info=info,
                           ttm=ttm, prev=prev, segments=SEGMENTS, unsaved=info["unsaved"], db_name=MONGO_DB)


@app.route("/new-logos/<period>")
def newlogo_detail(period):
    grain = "quarter" if period.startswith("Q") else "month"
    logos, info = newlogo_inputs()
    sel = [l for l in logos if (quarter_of(l["close_month"]) if grain == "quarter" else l["close_month"]) == period]
    sel.sort(key=lambda l: (l["close_month"], -l["arr"]))
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        cols = ["close_month", "billing_month", "customer", "customer_name", "account_id", "account_name", "segment",
                "parent_id", "link_method", "first_mrr", "arr", "subsidiary_of_existing", "counted"]
        w.writerow(cols)
        for l in sel:
            w.writerow([round(l[c], 2) if isinstance(l[c], float) else l[c] for c in cols])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=new_logos_{period}.csv"})
    counted = [l for l in sel if l["counted"]]
    return render_template("new_logos_detail.html", period=period, logos=sel, info=info,
                           total=sum(l["arr"] for l in counted), n=len(counted), db_name=MONGO_DB)


@app.route("/new-logos.csv")
def newlogo_csv():
    grain = request.args.get("grain", "quarter")
    logos, info = newlogo_inputs()
    start = request.args.get("from") or info["first_valid_close"]
    if grain == "quarter" and not request.args.get("from"):
        while int(start[5:7]) % 3 != 1:
            start = add_months(start, 1)
    end = request.args.get("to") or info["last_invoice"]
    rows = summarize_new_logos([l for l in logos if l["close_month"] >= (info["first_valid_close"] or "")],
                               newlogo_periods(grain, start, end), grain, info["complete_until"] or "")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["period", "complete", "new_logos", "new_logo_arr", *[f"arr_{s}" for s in SEGMENTS],
                *[f"logos_{s}" for s in SEGMENTS], "growth_vs_prior_period_pct", "growth_vs_year_ago_pct"])
    for r in rows:
        w.writerow([r["period"], r["complete"], r["n"], round(r["arr"], 2), *[round(r[s], 2) for s in SEGMENTS],
                    *[r[f"n_{s}"] for s in SEGMENTS],
                    None if r["pop_pct"] is None else round(r["pop_pct"], 2),
                    None if r["yoy_pct"] is None else round(r["yoy_pct"], 2)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=new_logos_{grain}.csv"})


# ---------------------------------------------------------------------------
# CAC & payback (VC-06): plmonthlysnapshots (P&L by month) + new logos
# ---------------------------------------------------------------------------
def load_pl_snapshots() -> list[dict]:
    return list(db()[PL_MONTHLY].find({}, {"_id": 0, "month": 1, "income": 1, "cogs": 1,
                                           "expenses": 1, "otherExpenses": 1}))


def cac_accounts(pl: dict) -> tuple[list[dict], bool]:
    """Every expense account in the P&L snapshots with its auto suggestion and the saved choice.
    -> (accounts, saved). While nothing is saved the suggestions are used."""
    doc = db()["mrr_settings"].find_one({"_id": "settings"}) or {}
    saved_ids = doc.get("cac_account_ids")
    acc: dict[str, dict] = {}
    last12 = set(sorted(m for m in pl if pl[m]["revenue"])[-12:])
    for m in sorted(pl):
        for sec, aid, name, amt in pl[m]["lines"]:
            a = acc.setdefault(aid, {"id": aid, "name": name, "section": sec, "total": 0.0, "ttm": 0.0,
                                     "first": m, "last": m})
            a["name"], a["last"] = name or a["name"], m
            a["total"] += amt
            if m in last12:
                a["ttm"] += amt
    numbered = any(account_number(a["name"]) for a in acc.values())
    for a in acc.values():
        a["auto"], a["reason"] = suggest_cac_account(a["name"], a["section"], numbered)
        a["selected"] = (a["id"] in saved_ids) if saved_ids is not None else a["auto"]
    rows = sorted(acc.values(), key=lambda a: (a["section"] != "expenses", account_number(a["name"]) or 99999, a["name"]))
    return rows, saved_ids is not None


def cac_inputs():
    pl = pl_by_month(load_pl_snapshots())
    accounts, saved = cac_accounts(pl)
    ids = {a["id"] for a in accounts if a["selected"]}
    logos, info = newlogo_inputs()
    months_with_pl = sorted(m for m in pl if pl[m]["revenue"])
    info.update({"pl_first": months_with_pl[0] if months_with_pl else None,
                 "pl_last": months_with_pl[-1] if months_with_pl else None,
                 "n_selected": len(ids), "accounts_saved": saved, "threshold": CAC_THRESHOLD})
    return pl, accounts, ids, logos, info


def cac_rows(pl, ids, logos, info, start=None, end=None):
    if not info["pl_first"]:
        return []
    first = add_months(max(info["pl_first"], info["first_valid_close"] or info["pl_first"]), 11)
    start = max(start or first, first)
    end = end or info["pl_last"]
    return cac_series(pl, ids, logos, month_range(start, end), info["first_valid_close"], info["complete_until"])


@app.route("/cac")
def cac_page():
    pl, accounts, ids, logos, info = cac_inputs()
    rows = cac_rows(pl, ids, logos, info, request.args.get("from") or None, request.args.get("to") or None)
    latest = next((r for r in reversed(rows) if r["complete"] and r["cac"]), None)
    year_ago = next((r for r in rows if latest and r["month"] == add_months(latest["month"], -12)), None)
    q_rows = [r for r in rows if int(r["month"][5:7]) % 3 == 0]
    return render_template("cac.html", rows=rows, q_rows=q_rows, latest=latest, year_ago=year_ago, info=info,
                           unsaved=info["unsaved"], db_name=MONGO_DB,
                           start=rows[0]["month"] if rows else "", end=rows[-1]["month"] if rows else "")


@app.route("/cac/<month>")
def cac_detail(month):
    pl, accounts, ids, logos, info = cac_inputs()
    rows = cac_series(pl, ids, logos, [month], info["first_valid_close"], info["complete_until"])
    r = rows[0]
    window = month_range(r["start"], month)
    names = {a["id"]: a for a in accounts}
    by_acc = {}
    for m in window:
        for sec, aid, name, amt in (pl.get(m) or {"lines": []})["lines"]:
            if aid in ids:
                by_acc.setdefault(aid, {"name": names[aid]["name"], "reason": names[aid]["reason"],
                                        "months": {}, "total": 0.0})
                by_acc[aid]["months"][m] = by_acc[aid]["months"].get(m, 0) + amt
                by_acc[aid]["total"] += amt
    acc_rows = sorted(by_acc.values(), key=lambda a: account_number(a["name"]) or 99999)
    month_tot = {m: sum(a["months"].get(m, 0) for a in acc_rows) for m in window}
    sel = sorted((l for l in logos if l["counted"] and r["start"] <= l["close_month"] <= month),
                 key=lambda l: (l["close_month"], -l["arr"]))
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["account", *window, "total"])
        for a in acc_rows:
            w.writerow([a["name"], *[round(a["months"].get(m, 0), 2) for m in window], round(a["total"], 2)])
        w.writerow(["S&M total", *[round(month_tot[m], 2) for m in window], round(r["sm"], 2)])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=cac_sm_{month}.csv"})
    return render_template("cac_detail.html", r=r, window=window, acc_rows=acc_rows, month_tot=month_tot,
                           logos=sel, info=info, db_name=MONGO_DB)


@app.route("/cac.csv")
def cac_csv():
    pl, accounts, ids, logos, info = cac_inputs()
    rows = cac_rows(pl, ids, logos, info, request.args.get("from") or None, request.args.get("to") or None)
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["month", "start", "complete", "sm", "new_logos", "new_logo_arr", "avg_arr", "revenue", "cogs", "gm",
            "cac", "payback", "sm_per_arr"]
    w.writerow(["ttm_end" if c == "month" else "ttm_start" if c == "start" else c for c in cols])
    for r in rows:
        w.writerow([round(r[c], 4) if isinstance(r[c], float) else r[c] for c in cols])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=cac_payback.csv"})


@app.post("/settings/cac")
def save_cac_accounts():
    ids = [k[4:] for k in request.form if k.startswith("acc_")]
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {"cac_account_ids": ids}}, upsert=True)
    flash(f"Saved {len(ids)} sales & marketing expense account{'s' if len(ids) != 1 else ''} for CAC.", "ok")
    return redirect(url_for("settings_page") + "#cac")


@app.post("/settings/cac/reset")
def reset_cac_accounts():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {"cac_account_ids": ""}}, upsert=True)
    flash("CAC accounts reset to the automatic selection.", "ok")
    return redirect(url_for("settings_page") + "#cac")


# ---------------------------------------------------------------------------
# COGS % and mix (VC-04): plmonthlysnapshots income[] / cogs[]
# ---------------------------------------------------------------------------
def cogs_accounts(pl: dict) -> tuple[list[dict], dict, set, bool]:
    """Every income / COGS account with its automatic product line and D&A flag, and the saved choice.
    -> (accounts, line_map, da_ids, saved)"""
    doc = db()["mrr_settings"].find_one({"_id": "settings"}) or {}
    saved_map, saved_da = doc.get("cogs_account_map"), doc.get("cogs_da_ids")
    acc: dict[str, dict] = {}
    last12 = set(sorted(m for m in pl if pl[m]["revenue"])[-12:])
    for m in sorted(pl):
        for sec, aid, name, amt in pl[m]["rc_lines"]:
            a = acc.setdefault(aid, {"id": aid, "name": name, "section": sec, "total": 0.0, "ttm": 0.0,
                                     "first": m, "last": m})
            a["name"], a["last"] = name or a["name"], m
            a["total"] += amt
            if m in last12:
                a["ttm"] += amt
    numbered = any(account_number(a["name"]) for a in acc.values())
    for a in acc.values():
        a["auto"], a["reason"] = suggest_cogs_line(a["name"], a["section"], numbered)
        a["auto_da"] = suggest_cogs_da(a["name"], a["section"])
        a["line"] = (saved_map or {}).get(a["id"], a["auto"]) if saved_map is not None else a["auto"]
        a["da"] = (a["id"] in saved_da) if saved_da is not None else a["auto_da"]
    rows = sorted(acc.values(), key=lambda a: (a["section"] != "income", account_number(a["name"]) or 99999, a["name"]))
    return rows, {a["id"]: a["line"] for a in rows}, {a["id"] for a in rows if a["da"]}, saved_map is not None


def cogs_periods(pl: dict, grain: str, window: str) -> list[dict]:
    months = sorted(m for m in pl if pl[m]["revenue"])
    if not months:
        return []
    out = []
    if grain == "quarter":
        ends = [m for m in months if int(m[5:7]) % 3 == 0]
        if months[-1] not in ends:
            ends.append(months[-1])
    else:
        ends = months
    for e in ends:
        if window == "ttm":
            ms = [add_months(e, -k) for k in range(11, -1, -1)]
            label = f"TTM {e}"
        elif grain == "quarter":
            ms = [add_months(e, -k) for k in (2, 1, 0)]
            label = quarter_of(e)
        else:
            ms, label = [e], e
        out.append({"label": label, "end": e, "months": ms, "complete": all(m in months for m in ms)})
    return out


def cogs_inputs(grain: str, window: str):
    pl = pl_by_month(load_pl_snapshots())
    accounts, line_map, da_ids, saved = cogs_accounts(pl)
    rows = []
    for p in cogs_periods(pl, grain, window):
        r = cogs_period(pl, p["months"], line_map, da_ids)
        r.update(p)
        rows.append(r)
    return pl, accounts, line_map, da_ids, saved, rows


def cogs_args():
    grain = request.args.get("grain", "month")
    grain = grain if grain in ("month", "quarter") else "month"
    window = request.args.get("window", "period")
    window = window if window in ("period", "ttm") else "period"
    return grain, window


@app.route("/cogs")
def cogs_page():
    grain, window = cogs_args()
    pl, accounts, line_map, da_ids, saved, rows = cogs_inputs(grain, window)
    rows = [r for r in rows if r["complete"]] if window == "ttm" else rows
    latest = next((r for r in reversed(rows) if r["complete"]), None)
    prev = None
    if latest:
        back = 12 if grain == "month" else 4
        idx = rows.index(latest)
        prev = rows[idx - back] if idx - back >= 0 else None
    da_names = [a["name"] for a in accounts if a["da"]]
    return render_template("cogs.html", rows=rows, latest=latest, prev=prev, grain=grain, window=window,
                           lines=PRODUCT_LINES, saved=saved, da_names=da_names, db_name=MONGO_DB,
                           unassigned=[a for a in accounts if a["line"] == "Unassigned" and abs(a["total"]) > 0.5],
                           excluded=[a for a in accounts if a["line"] == "Exclude" and abs(a["total"]) > 0.5])


@app.route("/cogs/<period>")
def cogs_detail(period):
    pl = pl_by_month(load_pl_snapshots())
    accounts, line_map, da_ids, saved = cogs_accounts(pl)
    months = period_months(period)
    r = cogs_period(pl, months, line_map, da_ids)
    by = {}
    for m in months:
        for sec, aid, name, amt in (pl.get(m) or {}).get("rc_lines", []):
            a = by.setdefault(aid, {"id": aid, "name": name, "section": sec, "line": line_map.get(aid, "Unassigned"),
                                    "da": aid in da_ids, "amount": 0.0})
            a["amount"] += amt
    acc_rows = sorted(by.values(), key=lambda a: (a["section"] != "income", account_number(a["name"]) or 99999, a["name"]))
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["section", "account", "product_line", "capitalized_software_da", "amount"])
        for a in acc_rows:
            w.writerow([a["section"], a["name"], a["line"], a["da"], round(a["amount"], 2)])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=cogs_{period.replace(' ', '_')}.csv"})
    return render_template("cogs_detail.html", period=period, months=months, r=r, acc_rows=acc_rows,
                           lines=PRODUCT_LINES, choices=COGS_LINE_CHOICES, db_name=MONGO_DB)


@app.route("/cogs.csv")
def cogs_csv():
    grain, window = cogs_args()
    *_, rows = cogs_inputs(grain, window)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["period", "first_month", "last_month", "complete", "revenue", "cogs", "cogs_da", "cogs_pct",
                "cogs_pct_excl_cap_software",
                *[f"{p.lower()}_{k}" for p in PRODUCT_LINES for k in ("revenue", "cogs", "cogs_pct", "share_pct")],
                "unassigned_revenue", "unassigned_cogs"])
    rd = lambda v, n=2: None if v is None else round(v, n)
    for r in rows:
        w.writerow([r["label"], r["months"][0], r["months"][-1], r["complete"], rd(r["revenue"]), rd(r["cogs"]),
                    rd(r["da"]), rd(r["pct"], 4), rd(r["pct_ex_da"], 4),
                    *[rd(r["lines"][p][k], 4 if k in ("pct", "share") else 2) for p in PRODUCT_LINES
                      for k in ("revenue", "cogs", "pct", "share")],
                    rd(r["lines"]["Unassigned"]["revenue"]), rd(r["lines"]["Unassigned"]["cogs"])])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=cogs_pct_{grain}_{window}.csv"})


@app.post("/settings/cogs")
def save_cogs_accounts():
    line_map = {k[5:]: v for k, v in request.form.items() if k.startswith("line_") and v in COGS_LINE_CHOICES}
    da = [k[3:] for k in request.form if k.startswith("da_")]
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {"cogs_account_map": line_map, "cogs_da_ids": da}},
                                    upsert=True)
    flash(f"Saved the product line for {len(line_map)} income / COGS accounts.", "ok")
    return redirect(url_for("settings_page") + "#cogs")


@app.post("/settings/cogs/reset")
def reset_cogs_accounts():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {"cogs_account_map": "", "cogs_da_ids": ""}},
                                    upsert=True)
    flash("COGS % accounts reset to the automatic mapping.", "ok")
    return redirect(url_for("settings_page") + "#cogs")


# ---------------------------------------------------------------------------
# G&A % of revenue (VC-09): plmonthlysnapshots expenses[] + income[]
# ---------------------------------------------------------------------------
def ga_accounts(pl: dict) -> tuple[list[dict], set, bool]:
    """Every expense / other-expense account with its automatic G&A choice and the saved one."""
    doc = db()["mrr_settings"].find_one({"_id": "settings"}) or {}
    saved_ids = doc.get("ga_account_ids")
    acc: dict[str, dict] = {}
    last12 = set(sorted(m for m in pl if pl[m]["revenue"])[-12:])
    for m in sorted(pl):
        for sec, aid, name, amt in pl[m]["lines"]:
            a = acc.setdefault(aid, {"id": aid, "name": name, "section": sec, "total": 0.0, "ttm": 0.0,
                                     "first": m, "last": m})
            a["name"], a["last"] = name or a["name"], m
            a["total"] += amt
            if m in last12:
                a["ttm"] += amt
    numbered = any(account_number(a["name"]) for a in acc.values())
    for a in acc.values():
        a["auto"], a["reason"] = suggest_ga_account(a["name"], a["section"], numbered)
        a["selected"] = (a["id"] in saved_ids) if saved_ids is not None else a["auto"]
    rows = sorted(acc.values(), key=lambda a: (not a["selected"], a["section"] != "expenses",
                                               account_number(a["name"]) or 99999, a["name"]))
    return rows, {a["id"] for a in rows if a["selected"]}, saved_ids is not None


def ga_inputs(grain: str, window: str):
    pl = pl_by_month(load_pl_snapshots())
    accounts, ga_ids, saved = ga_accounts(pl)
    _, line_map, _, _ = cogs_accounts(pl)
    rows = []
    for p in cogs_periods(pl, grain, window):
        r = ga_period(pl, p["months"], ga_ids, line_map)
        r.update(p)
        rows.append(r)
    return pl, accounts, ga_ids, line_map, saved, rows


def period_months(period: str) -> list[str]:
    if period.startswith("TTM "):
        return [add_months(period[4:], -k) for k in range(11, -1, -1)]
    if "Q" in period:
        q, y = period.split("-") if period.startswith("Q") else period.split("-")[::-1]
        q = int(q.lstrip("Q"))
        return [f"{y}-{3 * (q - 1) + k:02d}" for k in (1, 2, 3)]
    return [period]


@app.route("/ga")
def ga_page():
    grain, window = cogs_args()
    pl, accounts, ga_ids, line_map, saved, rows = ga_inputs(grain, window)
    rows = [r for r in rows if r["complete"]] if window == "ttm" else rows
    latest = next((r for r in reversed(rows) if r["complete"]), None)
    prev = None
    if latest:
        back = 12 if grain == "month" else 4
        idx = rows.index(latest)
        prev = rows[idx - back] if idx - back >= 0 else None
    # stacked G&A dollars by account (largest accounts first)
    names = {a["id"]: a["name"] for a in accounts}
    order = sorted(ga_ids, key=lambda i: -sum(r["by_account"].get(i, {}).get("amount", 0) for r in rows))
    stacks = [{"name": names[i], "data": [round(r["by_account"].get(i, {}).get("amount", 0), 2) for r in rows]}
              for i in order]
    return render_template("ga.html", rows=rows, latest=latest, prev=prev, grain=grain, window=window, saved=saved,
                           selected=[a for a in accounts if a["selected"]], stacks=stacks, db_name=MONGO_DB,
                           excluded_rev=[a for a in cogs_accounts(pl)[0] if a["section"] == "income" and a["line"] == "Exclude"])


@app.route("/ga/<period>")
def ga_detail(period):
    pl = pl_by_month(load_pl_snapshots())
    accounts, ga_ids, saved = ga_accounts(pl)
    _, line_map, _, _ = cogs_accounts(pl)
    months = period_months(period)
    r = ga_period(pl, months, ga_ids, line_map)
    by = {}
    for m in months:
        for sec, aid, name, amt in (pl.get(m) or {}).get("lines", []):
            if aid in ga_ids:
                a = by.setdefault(aid, {"name": name, "months": {}, "total": 0.0})
                a["months"][m] = a["months"].get(m, 0) + amt
                a["total"] += amt
    acc_rows = sorted(by.values(), key=lambda a: account_number(a["name"]) or 99999)
    month_tot = {m: sum(a["months"].get(m, 0) for a in acc_rows) for m in months}
    month_rev = {m: ga_period(pl, [m], ga_ids, line_map)["revenue"] for m in months}
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["account", *months, "total"])
        for a in acc_rows:
            w.writerow([a["name"], *[round(a["months"].get(m, 0), 2) for m in months], round(a["total"], 2)])
        w.writerow(["G&A total", *[round(month_tot[m], 2) for m in months], round(r["ga"], 2)])
        w.writerow(["Revenue", *[round(month_rev[m], 2) for m in months], round(r["revenue"], 2)])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=ga_{period.replace(' ', '_')}.csv"})
    return render_template("ga_detail.html", period=period, months=months, r=r, acc_rows=acc_rows,
                           month_tot=month_tot, month_rev=month_rev, db_name=MONGO_DB)


@app.route("/ga.csv")
def ga_csv():
    grain, window = cogs_args()
    *_, rows = ga_inputs(grain, window)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["period", "first_month", "last_month", "complete", "revenue", "ga", "ga_pct"])
    for r in rows:
        w.writerow([r["label"], r["months"][0], r["months"][-1], r["complete"], round(r["revenue"], 2),
                    round(r["ga"], 2), None if r["pct"] is None else round(r["pct"], 4)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=ga_pct_{grain}_{window}.csv"})


@app.post("/settings/ga")
def save_ga_accounts():
    ids = [k[3:] for k in request.form if k.startswith("ga_")]
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {"ga_account_ids": ids}}, upsert=True)
    flash(f"Saved {len(ids)} G&A account{'s' if len(ids) != 1 else ''}.", "ok")
    return redirect(url_for("settings_page") + "#ga")


@app.post("/settings/ga/reset")
def reset_ga_accounts():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {"ga_account_ids": ""}}, upsert=True)
    flash("G&A accounts reset to the automatic selection.", "ok")
    return redirect(url_for("settings_page") + "#ga")


# ---------------------------------------------------------------------------
# EBITDA margin (VC-10): every plmonthlysnapshots line + optional monthly plan
# ---------------------------------------------------------------------------
def ebitda_accounts(pl: dict) -> tuple[list[dict], dict, set, bool]:
    doc = db()["mrr_settings"].find_one({"_id": "settings"}) or {}
    saved_map, saved_da = doc.get("ebitda_account_map"), doc.get("ebitda_da_ids")
    acc: dict[str, dict] = {}
    last12 = set(sorted(m for m in pl if pl[m]["revenue"])[-12:])
    for m in sorted(pl):
        for sec, aid, name, amt in pl[m]["rc_lines"] + pl[m]["lines"]:
            a = acc.setdefault(aid, {"id": aid, "name": name, "section": sec, "total": 0.0, "ttm": 0.0})
            a["name"] = name or a["name"]
            a["total"] += amt
            if m in last12:
                a["ttm"] += amt
    numbered = any(account_number(a["name"]) for a in acc.values())
    for a in acc.values():
        a["auto"], a["auto_da"], a["reason"] = suggest_ebitda_account(a["name"], a["section"], numbered)
        a["cat"] = (saved_map or {}).get(a["id"], a["auto"]) if saved_map is not None else a["auto"]
        a["da"] = (a["id"] in saved_da) if saved_da is not None else a["auto_da"]
    order = {"income": 0, "cogs": 1, "expenses": 2, "otherExpenses": 3}
    rows = sorted(acc.values(), key=lambda a: (a["cat"] == "exclude", order.get(a["section"], 9),
                                               account_number(a["name"]) or 99999, a["name"]))
    return rows, {a["id"]: a["cat"] for a in rows}, {a["id"] for a in rows if a["da"]}, saved_map is not None


def load_plan() -> dict:
    doc = db()["mrr_settings"].find_one({"_id": "settings"}) or {}
    return {m: tuple(v) for m, v in (doc.get("ebitda_plan") or {}).items()}


def ebitda_inputs(grain: str, window: str):
    pl = pl_by_month(load_pl_snapshots())
    accounts, cat_map, da_ids, saved = ebitda_accounts(pl)
    plan = load_plan()
    rows = []
    for p in cogs_periods(pl, grain, window):
        r = ebitda_period(pl, p["months"], cat_map, da_ids, plan)
        r.update(p)
        rows.append(r)
    return pl, accounts, cat_map, da_ids, saved, plan, rows


@app.route("/ebitda")
def ebitda_page():
    grain, window = cogs_args()
    grain = request.args.get("grain", "quarter") if "grain" not in request.args else grain
    pl, accounts, cat_map, da_ids, saved, plan, rows = ebitda_inputs(grain, window)
    rows = [r for r in rows if r["complete"]] if window == "ttm" else rows
    latest = next((r for r in reversed(rows) if r["complete"]), None)
    prev = None
    if latest:
        back = 12 if grain == "month" else 4
        idx = rows.index(latest)
        prev = rows[idx - back] if idx - back >= 0 else None
    return render_template("ebitda.html", rows=rows, latest=latest, prev=prev, grain=grain, window=window,
                           saved=saved, has_plan=bool(plan), db_name=MONGO_DB,
                           da_names=[a["name"] for a in accounts if a["da"] and a["cat"] in ("cogs", "opex")],
                           below=[a["name"] for a in accounts if a["cat"] == "below"],
                           excluded=[a["name"] for a in accounts if a["cat"] == "exclude" and abs(a["total"]) > 0.5])


@app.route("/ebitda/<period>")
def ebitda_detail(period):
    pl = pl_by_month(load_pl_snapshots())
    accounts, cat_map, da_ids, saved = ebitda_accounts(pl)
    months = period_months(period)
    r = ebitda_period(pl, months, cat_map, da_ids, load_plan())
    by = {}
    for m in months:
        snap = pl.get(m) or {}
        for sec, aid, name, amt in snap.get("rc_lines", []) + snap.get("lines", []):
            a = by.setdefault(aid, {"name": name, "cat": cat_map.get(aid, "exclude"), "da": aid in da_ids,
                                    "section": sec, "amount": 0.0})
            a["amount"] += amt
    order = {"revenue": 0, "cogs": 1, "opex": 2, "below": 3, "exclude": 4}
    acc_rows = sorted(by.values(), key=lambda a: (order[a["cat"]], account_number(a["name"]) or 99999, a["name"]))
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["category", "account", "da_added_back", "amount"])
        for a in acc_rows:
            w.writerow([EBITDA_CATEGORIES[a["cat"]], a["name"], a["da"], round(a["amount"], 2)])
        for k in ("revenue", "cogs", "opex", "da", "ebitda"):
            w.writerow(["TOTAL", k, "", round(r[k], 2)])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=ebitda_{period.replace(' ', '_')}.csv"})
    return render_template("ebitda_detail.html", period=period, months=months, r=r, acc_rows=acc_rows,
                           cats=EBITDA_CATEGORIES, db_name=MONGO_DB)


@app.route("/ebitda.csv")
def ebitda_csv():
    grain, window = cogs_args()
    *_, rows = ebitda_inputs(grain, window)
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["revenue", "cogs", "opex", "da", "ebitda", "margin", "plan_ebitda", "plan_margin", "vs_plan", "below"]
    w.writerow(["period", "first_month", "last_month", "complete", *cols])
    for r in rows:
        w.writerow([r["label"], r["months"][0], r["months"][-1], r["complete"],
                    *[None if r[c] is None else round(r[c], 4 if c in ("margin", "plan_margin", "vs_plan") else 2)
                      for c in cols]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=ebitda_{grain}_{window}.csv"})


@app.post("/settings/ebitda")
def save_ebitda_accounts():
    cat_map = {k[4:]: v for k, v in request.form.items() if k.startswith("cat_") and v in EBITDA_CATEGORIES}
    da = [k[5:] for k in request.form if k.startswith("eda_")]
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {"ebitda_account_map": cat_map, "ebitda_da_ids": da}},
                                    upsert=True)
    flash(f"Saved the EBITDA classification for {len(cat_map)} accounts.", "ok")
    return redirect(url_for("settings_page") + "#ebitda")


@app.post("/settings/ebitda/reset")
def reset_ebitda_accounts():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {"ebitda_account_map": "", "ebitda_da_ids": ""}},
                                    upsert=True)
    flash("EBITDA accounts reset to the automatic classification.", "ok")
    return redirect(url_for("settings_page") + "#ebitda")


@app.post("/settings/ebitda/plan")
def save_ebitda_plan():
    plan, errors = {}, []
    for raw in request.form.get("plan", "").splitlines():
        raw = raw.strip()
        if not raw or raw.lower().startswith("month"):
            continue
        try:
            parts = [x.strip().replace("$", "").replace("_", "") for x in raw.replace("\t", ",").split(",")]
            m, e, rv = parts[0], float(parts[1]), float(parts[2])
            datetime.strptime(m, "%Y-%m")
            plan[m] = [e, rv]
        except (ValueError, IndexError):
            errors.append(raw)
    if errors:
        flash("Plan not saved - fix these lines (YYYY-MM, plan EBITDA, plan revenue): " + "; ".join(errors[:5]), "err")
    else:
        db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {"ebitda_plan": plan}}, upsert=True)
        flash(f"Saved the EBITDA plan for {len(plan)} months.", "ok")
    return redirect(url_for("settings_page") + "#ebitda-plan")


# ---------------------------------------------------------------------------
# LTV / CAC, new customers (VC-07): TTM GRR (Retention) + CAC page inputs
# ---------------------------------------------------------------------------
def ltv_inputs(start=None, end=None):
    settings = load_settings()
    cap = float(settings.get("ltv_cap_months", 84))
    sub_only = settings.get("ltv_grr_scope") == "subscription"
    pl, accounts, ids, logos, info = cac_inputs()
    cac = cac_rows(pl, ids, logos, info, start, end)
    native, is_cad, _, last_invoice, reliable_from, _ = retention_inputs()
    invoices = load_invoices()
    mrr_usd, _ = compute_mrr(invoices, current_mapping(product_catalog(invoices)), settings)
    rows = []
    for r in cac:
        m0 = add_months(r["month"], -12)
        g = retention(native, is_cad, settings["fx_cad_usd"], m0, r["month"], subscription_only=sub_only)
        row = ltv_cac_row(r, g["grr"] if g else None, cap)
        custs = mrr_usd.get(r["month"], {})
        vals = [v["subscription"] + v["retainer"] for v in custs.values()]
        ltv_base_fields(row, 12 * sum(vals), sum(1 for v in vals if v > 0.005))
        row["grr_reliable"] = bool(reliable_from) and m0 >= reliable_from
        row["complete"] = row["complete"] and row["grr_reliable"]
        rows.append(row)
    info.update({"cap": cap, "threshold": float(settings.get("ltv_threshold", 3.0)), "sub_only": sub_only,
                 "reliable_from": reliable_from})
    return rows, info


@app.route("/ltv-cac")
def ltv_page():
    rows, info = ltv_inputs(request.args.get("from") or None, request.args.get("to") or None)
    grain = request.args.get("grain", "quarter")
    grain = grain if grain in ("month", "quarter") else "quarter"
    shown = [r for r in rows if grain == "month" or int(r["month"][5:7]) % 3 == 0]
    for r in shown:
        r["label"] = f"Q{int(r['month'][5:7]) // 3}-{r['month'][:4]}" if grain == "quarter" else r["month"]
    latest = next((r for r in reversed(shown) if r["complete"] and r["ltv_cac"]), None)
    prev = next((r for r in shown if latest and r["month"] == add_months(latest["month"], -12)), None)
    return render_template("ltv.html", rows=shown, latest=latest, prev=prev, info=info, grain=grain,
                           start=rows[0]["month"] if rows else "", end=rows[-1]["month"] if rows else "",
                           unsaved=info["unsaved"], db_name=MONGO_DB)


@app.route("/ltv-cac/<month>")
def ltv_detail(month):
    rows, info = ltv_inputs(month, month)
    if not rows:
        flash(f"No LTV/CAC for {month}: it needs 12 months of P&L and new logos.", "err")
        return redirect(url_for("ltv_page"))
    return render_template("ltv_detail.html", r=rows[0], info=info, db_name=MONGO_DB)


@app.route("/ltv-cac.csv")
def ltv_csv():
    rows, info = ltv_inputs(request.args.get("from") or None, request.args.get("to") or None)
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["month", "start", "complete", "grr", "churn", "lifetime", "capped", "new_logos", "new_logo_arr", "gm",
            "gp_month", "ltv", "sm", "cac", "payback", "ltv_cac",
            "arr", "customers", "base_avg_mrr", "base_gp_month", "base_ltv", "base_ltv_cac"]
    w.writerow(["ttm_end" if c == "month" else "ttm_start" if c == "start" else
                "monthly_churn" if c == "churn" else "lifetime_months" if c == "lifetime" else
                "ltv_capped" if c == "capped" else "gross_profit_per_logo_month" if c == "gp_month" else
                "active_customers" if c == "customers" else "whole_base_" + c[5:] if c.startswith("base_") else c
                for c in cols])
    for r in rows:
        w.writerow([round(r[c], 6) if isinstance(r[c], float) else r[c] for c in cols])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=ltv_cac.csv"})


@app.post("/settings/ltv")
def save_ltv_settings():
    try:
        cap = float(request.form.get("ltv_cap_months", 84))
        th = float(request.form.get("ltv_threshold", 3.0))
        if not (1 <= cap <= 600 and 0 < th <= 50):
            raise ValueError
    except ValueError:
        flash("Not saved - the lifetime cap must be 1-600 months and the threshold above 0.", "err")
        return redirect(url_for("settings_page") + "#ltv")
    scope = "subscription" if request.form.get("ltv_grr_scope") == "subscription" else "all"
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {
        "ltv_cap_months": cap, "ltv_threshold": th, "ltv_grr_scope": scope}}, upsert=True)
    flash("LTV/CAC settings saved.", "ok")
    return redirect(url_for("settings_page") + "#ltv")


# ---------------------------------------------------------------------------
# Recurring revenue % (VC-12): customer MRR (invoices) / GL revenue (P&L)
# ---------------------------------------------------------------------------
def recurring_accounts(pl: dict) -> tuple[list[dict], set, bool]:
    doc = db()["mrr_settings"].find_one({"_id": "settings"}) or {}
    saved = doc.get("recurring_tag_ids")
    _, line_map, _, _ = cogs_accounts(pl)
    acc: dict[str, dict] = {}
    last12 = set(sorted(m for m in pl if pl[m]["revenue"])[-12:])
    for m in sorted(pl):
        for sec, aid, name, amt in pl[m]["rc_lines"]:
            if sec != "income":
                continue
            a = acc.setdefault(aid, {"id": aid, "name": name, "total": 0.0, "ttm": 0.0})
            a["name"] = name or a["name"]
            a["total"] += amt
            if m in last12:
                a["ttm"] += amt
    for a in acc.values():
        a["auto"], a["reason"] = suggest_recurring_tag(a["name"], "income")
        a["selected"] = (a["id"] in saved) if saved is not None else a["auto"]
        a["in_revenue"] = line_map.get(a["id"]) != "Exclude"
    rows = sorted(acc.values(), key=lambda a: (not a["in_revenue"], account_number(a["name"]) or 99999, a["name"]))
    return rows, {a["id"] for a in rows if a["selected"]}, saved is not None


def recurring_inputs(grain: str, window: str):
    invoices = load_invoices()
    settings = load_settings()
    catalog = product_catalog(invoices)
    mrr, _ = compute_mrr(invoices, current_mapping(catalog), settings)
    pl = pl_by_month(load_pl_snapshots())
    accounts, tag_ids, saved = recurring_accounts(pl)
    _, line_map, _, _ = cogs_accounts(pl)
    last_invoice = max((to_date_str(i.get("txnDate"))[:7] for i in invoices if i.get("txnDate")), default=None)
    rows = []
    for p in cogs_periods(pl, grain, window):
        r = recurring_period(mrr, pl, p["months"], line_map, tag_ids)
        r.update(p)
        r["complete"] = p["complete"] and bool(last_invoice) and p["months"][-1] <= last_invoice
        rows.append(r)
    info = {"saved": saved, "unsaved": sum(1 for p in catalog if not p["saved"]), "last_invoice": last_invoice,
            "tagged": [a["name"] for a in accounts if a["selected"]]}
    return mrr, pl, accounts, line_map, tag_ids, rows, info


@app.route("/recurring")
def recurring_page():
    grain, window = cogs_args()
    grain = "quarter" if "grain" not in request.args else grain
    *_, rows, info = recurring_inputs(grain, window)
    rows = [r for r in rows if r["complete"]] if window == "ttm" else rows
    latest = next((r for r in reversed(rows) if r["complete"]), None)
    prev = None
    if latest:
        back = 12 if grain == "month" else 4
        idx = rows.index(latest)
        prev = rows[idx - back] if idx - back >= 0 else None
    return render_template("recurring.html", rows=rows, latest=latest, prev=prev, grain=grain, window=window,
                           info=info, unsaved=info["unsaved"], db_name=MONGO_DB)


@app.route("/recurring/<period>")
def recurring_detail(period):
    mrr, pl, accounts, line_map, tag_ids, _, info = recurring_inputs("month", "period")
    months = period_months(period)
    r = recurring_period(mrr, pl, months, line_map, tag_ids)
    per_month = [dict(recurring_period(mrr, pl, [m], line_map, tag_ids), month=m) for m in months]
    rev_acc = {}
    for m in months:
        for sec, aid, name, amt in (pl.get(m) or {}).get("rc_lines", []):
            if sec == "income" and line_map.get(aid) != "Exclude":
                a = rev_acc.setdefault(aid, {"name": name, "tagged": aid in tag_ids, "amount": 0.0})
                a["amount"] += amt
    rev_rows = sorted(rev_acc.values(), key=lambda a: account_number(a["name"]) or 99999)
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["month", "subscription_mrr", "retainer_mrr", "total_mrr", "gl_revenue", "tagged_revenue",
                    "recurring_pct", "tagged_pct"])
        for x in per_month + [dict(r, month=period)]:
            w.writerow([x["month"], round(x["sub"], 2), round(x["ret"], 2), round(x["mrr"], 2), round(x["revenue"], 2),
                        round(x["tagged"], 2), None if x["pct"] is None else round(x["pct"], 4),
                        None if x["tagged_pct"] is None else round(x["tagged_pct"], 4)])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=recurring_{period.replace(' ', '_')}.csv"})
    return render_template("recurring_detail.html", period=period, r=r, per_month=per_month, rev_rows=rev_rows,
                           db_name=MONGO_DB)


@app.route("/recurring.csv")
def recurring_csv():
    grain, window = cogs_args()
    *_, rows, info = recurring_inputs(grain, window)
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["sub", "ret", "mrr", "revenue", "tagged", "pct", "sub_pct", "ret_pct", "tagged_pct", "gap"]
    w.writerow(["period", "first_month", "last_month", "complete", "subscription_mrr", "retainer_mrr", "total_mrr",
                "gl_revenue", "tagged_revenue", "recurring_pct", "subscription_pct", "retainer_pct", "account_tagged_pct",
                "gap_pts"])
    for r in rows:
        w.writerow([r["label"], r["months"][0], r["months"][-1], r["complete"],
                    *[None if r[c] is None else round(r[c], 4 if "pct" in c or c == "gap" else 2) for c in cols]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=recurring_pct_{grain}_{window}.csv"})


@app.post("/settings/recurring")
def save_recurring_accounts():
    ids = [k[4:] for k in request.form if k.startswith("rta_")]
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {"recurring_tag_ids": ids}}, upsert=True)
    flash(f"Saved {len(ids)} account-tagged recurring revenue account{'s' if len(ids) != 1 else ''}.", "ok")
    return redirect(url_for("settings_page") + "#recurring")


@app.post("/settings/recurring/reset")
def reset_recurring_accounts():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {"recurring_tag_ids": ""}}, upsert=True)
    flash("Account-tagged recurring accounts reset to the automatic selection.", "ok")
    return redirect(url_for("settings_page") + "#recurring")


# ---------------------------------------------------------------------------
# Revenue growth (VC-13): GL revenue YoY, recurring / non-recurring split, vs plan
# reuses: COGS % revenue mapping, product mapping (MRR), EBITDA plan (plan revenue)
# ---------------------------------------------------------------------------
def growth_inputs(grain: str, window: str):
    invoices = load_invoices()
    settings = load_settings()
    catalog = product_catalog(invoices)
    mrr, _ = compute_mrr(invoices, current_mapping(catalog), settings)
    pl = pl_by_month(load_pl_snapshots())
    _, line_map, _, _ = cogs_accounts(pl)
    plan = load_plan()
    have = {m for m in pl if pl[m]["revenue"]}
    last_invoice = max((to_date_str(i.get("txnDate"))[:7] for i in invoices if i.get("txnDate")), default=None)
    rows = []
    for p in cogs_periods(pl, grain, window):
        r = growth_period(mrr, pl, p["months"], line_map, plan)
        r.update(p)
        r["has_prior"] = all(m in have for m in r["prior"])
        r["complete"] = p["complete"] and r["has_prior"] and bool(last_invoice) and p["months"][-1] <= last_invoice
        rows.append(r)
    by_label = {r["label"]: r for r in rows}
    for r in rows:   # the YoY chip: this growth vs last year's growth
        prev_label = None
        if grain == "quarter" and window == "period":
            q, y = r["label"].split("-")
            prev_label = f"{q}-{int(y) - 1}"
        elif window == "ttm":
            prev_label = f"TTM {add_months(r['end'], -12)}"
        else:
            prev_label = add_months(r["end"], -12)
        pr = by_label.get(prev_label)
        r["growth_ly"] = pr["growth"] if pr and pr["has_prior"] else None
        r["growth_change"] = r["growth"] - r["growth_ly"] if r["growth"] is not None and r["growth_ly"] is not None else None
    info = {"unsaved": sum(1 for p in catalog if not p["saved"]), "has_plan": bool(plan), "last_invoice": last_invoice,
            "first": min(have) if have else None}
    return mrr, pl, line_map, plan, rows, info


@app.route("/growth")
def growth_page():
    grain, window = cogs_args()
    grain = "quarter" if "grain" not in request.args else grain
    *_, rows, info = growth_inputs(grain, window)
    rows = [r for r in rows if r["has_prior"]]
    latest = next((r for r in reversed(rows) if r["complete"]), None)
    return render_template("growth.html", rows=rows, latest=latest, grain=grain, window=window, info=info,
                           unsaved=info["unsaved"], db_name=MONGO_DB)


@app.route("/growth/<period>")
def growth_detail(period):
    mrr, pl, line_map, plan, _, info = growth_inputs("month", "period")
    months = period_months(period)
    r = growth_period(mrr, pl, months, line_map, plan)
    per_month = [dict(growth_period(mrr, pl, [m], line_map, plan), month=m) for m in months]
    rev = {}
    for which, ms in (("cur", months), ("old", r["prior"])):
        for m in ms:
            for sec, aid, name, amt in (pl.get(m) or {}).get("rc_lines", []):
                if sec == "income" and line_map.get(aid) != "Exclude":
                    a = rev.setdefault(aid, {"name": name, "cur": 0.0, "old": 0.0})
                    a[which] += amt
    rev_rows = sorted(rev.values(), key=lambda a: account_number(a["name"]) or 99999)
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["account", f"{months[0]}..{months[-1]}", f"{r['prior'][0]}..{r['prior'][-1]}", "change", "growth_pct"])
        for a in rev_rows:
            w.writerow([a["name"], round(a["cur"], 2), round(a["old"], 2), round(a["cur"] - a["old"], 2),
                        round(100 * (a["cur"] / a["old"] - 1), 4) if a["old"] else None])
        w.writerow(["Total revenue", round(r["revenue"], 2), round(r["prev_revenue"], 2), round(r["added"], 2),
                    None if r["growth"] is None else round(r["growth"], 4)])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=revenue_growth_{period.replace(' ', '_')}.csv"})
    return render_template("growth_detail.html", period=period, months=months, r=r, per_month=per_month,
                           rev_rows=rev_rows, db_name=MONGO_DB)


@app.route("/growth.csv")
def growth_csv():
    grain, window = cogs_args()
    *_, rows, info = growth_inputs(grain, window)
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["revenue", "prev_revenue", "added", "growth", "growth_ly", "growth_change", "mrr", "prev_mrr", "rec_growth",
            "nonrec", "prev_nonrec", "nonrec_growth", "plan_revenue", "vs_plan"]
    w.writerow(["period", "first_month", "last_month", "complete", *cols])
    for r in rows:
        if not r["has_prior"]:
            continue
        w.writerow([r["label"], r["months"][0], r["months"][-1], r["complete"],
                    *[None if r[c] is None else round(r[c], 4 if c.endswith(("growth", "_ly", "change", "plan")) else 2)
                      for c in cols]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=revenue_growth_{grain}_{window}.csv"})


# ---------------------------------------------------------------------------
# Cash position and runway (CB-05): balancesheetmonthlysnapshots
# ---------------------------------------------------------------------------
def load_bs_snapshots() -> list[dict]:
    return list(db()[BS_MONTHLY].find({"provider": PROVIDER},
                                       {"_id": 0, "month": 1, "asOfDate": 1, "sectionTotals": 1, "accounts": 1}))


def cash_accounts(snaps: list[dict]) -> tuple[list[dict], set | None, bool, set]:
    """Bank accounts from the Balance Sheet snapshots, each classified unrestricted / restricted / exclude
    (automatic suggestion, or the saved choice). -> (accounts, unrestricted ids or None when the
    snapshots have no per-account balances, saved, restricted ids)"""
    accs = [a for a in bs_accounts(snaps) if a["section"] == "BankAccounts"]
    if not accs:
        return [], None, False, set()
    st = load_settings()
    saved = st.get("cash_account_map")
    legacy = st.get("cash_account_ids")
    named = any(account_number(a["name"]) or a["name"].strip().lower() not in ("checking", "savings") for a in accs)
    for a in accs:
        a["auto"], a["reason"] = suggest_cash_category(a["name"], a["section"], named)
        if saved is not None:
            a["cat"] = saved.get(a["id"], a["auto"])
        elif legacy is not None:
            a["cat"] = "unrestricted" if a["id"] in legacy else ("restricted" if a["auto"] == "restricted" else "exclude")
        else:
            a["cat"] = a["auto"]
        a["selected"] = a["cat"] == "unrestricted"
    order = {"unrestricted": 0, "restricted": 1, "exclude": 2}
    accs.sort(key=lambda a: (order[a["cat"]], account_number(a["name"]) or 99999, a["name"]))
    return (accs, {a["id"] for a in accs if a["cat"] == "unrestricted"}, saved is not None or legacy is not None,
            {a["id"] for a in accs if a["cat"] == "restricted"})


def cash_inputs():
    settings = load_settings()
    snaps = load_bs_snapshots()
    sections = settings.get("cash_sections") or ["BankAccounts"]
    lookback = int(settings.get("cash_lookback_months") or 3)
    pl = pl_by_month(load_pl_snapshots())
    last_closed = max((m for m in pl if pl[m]["revenue"]), default=None)
    accounts, ids, accounts_saved, restricted_ids = cash_accounts(snaps)
    adjust = float(settings.get("cash_restricted_adjust") or 0)
    rows = cash_series(snaps, sections, lookback, last_closed, ids, adjust, restricted_ids)
    available = sorted({k for d in snaps for k in (d.get("sectionTotals") or {})})
    info = {"sections": sections, "lookback": lookback, "last_closed": last_closed, "available": available,
            "show_ar": bool(settings.get("cash_show_ar_check", True)), "n": len(snaps), "collection": BS_MONTHLY,
            "mode": "accounts" if ids is not None else "sections", "adjust": adjust, "accounts_saved": accounts_saved,
            "chosen": [a for a in accounts if a["cat"] == "unrestricted"],
            "restricted_accts": [a for a in accounts if a["cat"] == "restricted"],
            "excluded_bank": [a for a in accounts if a["cat"] == "exclude"]}
    return rows, info


@app.route("/cash")
def cash_page():
    rows, info = cash_inputs()
    grain = request.args.get("grain", "month")
    grain = grain if grain in ("month", "quarter") else "month"
    shown = [r for r in rows if not r["stale"] and (grain == "month" or int(r["month"][5:7]) % 3 == 0)]
    for r in shown:
        r["label"] = f"Q{int(r['month'][5:7]) // 3}-{r['month'][:4]}" if grain == "quarter" else r["month"]
    latest = next((r for r in reversed(shown) if r["closed"]), shown[-1] if shown else None)
    year_ago = next((r for r in rows if latest and r["month"] == add_months(latest["month"], -12)), None)
    return render_template("cash.html", rows=shown, latest=latest, year_ago=year_ago, info=info, grain=grain,
                           stale=[r["month"] for r in rows if r["stale"]], db_name=MONGO_DB)


@app.route("/cash/<month>")
def cash_detail(month):
    rows, info = cash_inputs()
    r = next((x for x in rows if x["month"] == month), None)
    if not r:
        flash(f"No balance sheet snapshot for {month}.", "err")
        return redirect(url_for("cash_page"))
    back = next((x for x in rows if x["month"] == add_months(month, -info["lookback"])), None)
    chosen = {a["id"] for a in info["chosen"]}
    restricted = {a["id"] for a in info["restricted_accts"]}
    snap = next((d for d in load_bs_snapshots() if d["month"] == month), {})
    accts = [{"name": a.get("name"), "amount": float(a.get("amount") or 0), "chosen": str(a.get("id")) in chosen,
              "restricted": str(a.get("id")) in restricted}
             for a in snap.get("accounts") or [] if a.get("section") == "BankAccounts" or str(a.get("id")) in chosen]
    return render_template("cash_detail.html", r=r, back=back, info=info, accts=accts, db_name=MONGO_DB)


@app.route("/cash.csv")
def cash_csv():
    rows, info = cash_inputs()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["month", "as_of", "closed", "stale_copy_of_prior_month", "cash", "change_vs_prior_month",
                f"avg_monthly_decline_{info['lookback']}m", "runway_months", "self_funding", "ar_total",
                "cash_plus_negative_ar"])
    for r in rows:
        w.writerow([r["month"], r["as_of"], r["closed"], r["stale"], round(r["cash"], 2),
                    None if r["change"] is None else round(r["change"], 2),
                    None if r["avg_decline"] is None else round(r["avg_decline"], 2),
                    None if r["runway"] is None else round(r["runway"], 2), r["self_funding"],
                    None if r["ar"] is None else round(r["ar"], 2), round(r["cash_ex_excess"], 2)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=cash_runway.csv"})


@app.post("/settings/cash")
def save_cash_settings():
    sections = [k[3:] for k in request.form if k.startswith("cs_")] or (load_settings().get("cash_sections") or ["BankAccounts"])
    cat_map = {k[5:]: v for k, v in request.form.items() if k.startswith("cacc_") and v in CASH_CATEGORIES}
    if request.form.get("has_accounts") == "1" and "unrestricted" not in cat_map.values():
        flash("Not saved - pick at least one unrestricted cash account.", "err")
        return redirect(url_for("settings_page") + "#cash")
    if not sections:
        flash("Not saved - pick at least one Balance Sheet section for cash.", "err")
        return redirect(url_for("settings_page") + "#cash")
    try:
        lookback = max(1, min(12, int(request.form.get("cash_lookback_months", 3))))
    except ValueError:
        lookback = 3
    try:
        adjust = float((request.form.get("cash_restricted_adjust") or "0").replace(",", "").replace("$", ""))
    except ValueError:
        adjust = 0.0
    update = {"cash_sections": sections, "cash_lookback_months": lookback, "cash_restricted_adjust": adjust,
              "cash_show_ar_check": request.form.get("cash_show_ar_check") == "on"}
    if request.form.get("has_accounts") == "1":
        update["cash_account_map"] = cat_map
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    flash("Cash & runway settings saved.", "ok")
    return redirect(url_for("settings_page") + "#cash")


@app.post("/settings/cash/reset")
def reset_cash_accounts():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {"cash_account_ids": "", "cash_account_map": ""}},
                                    upsert=True)
    flash("Unrestricted cash accounts reset to the automatic selection.", "ok")
    return redirect(url_for("settings_page") + "#cash")


# ---------------------------------------------------------------------------
# FCF conversion (CB-07): (OCF - capex) / EBITDA, TTM
# ---------------------------------------------------------------------------
_BS_ROLLUPS = {"TotalAssets", "TotalLiabilitiesAndEquity", "CurrentAssets", "CurrentLiabilities", "Liabilities"}


def fcf_capex_accounts(snaps: list[dict]) -> tuple[list[dict], set | None, bool]:
    """Fixed-asset / other-asset accounts from the Balance Sheet snapshots, each classified
    capex / accumulated D&A / exclude. -> (accounts, capex ids or None without per-account balances, saved)"""
    accs = capex_accounts(snaps)
    if not accs:
        return [], None, False
    saved = load_settings().get("fcf_capex_map")
    numbered = any(account_number(a["name"]) for a in accs)
    for a in accs:
        a["auto"], a["reason"] = suggest_capex_category(a["name"], a["section"], numbered)
        a["cat"] = (saved or {}).get(a["id"], a["auto"]) if saved is not None else a["auto"]
    order = {"capex": 0, "accum": 1, "exclude": 2}
    accs.sort(key=lambda a: (order[a["cat"]], a["section"] != "FixedAssets", account_number(a["name"]) or 99999, a["name"]))
    return accs, {a["id"] for a in accs if a["cat"] == "capex"}, saved is not None


def fcf_wc_accounts(snaps: list[dict]) -> tuple[list[dict], dict | None, bool]:
    """Current asset / liability accounts from the Balance Sheet snapshots, each classified into the spec's
    working-capital categories. -> (accounts, {id: category} or None without per-account balances, saved)"""
    accs = [a for a in bs_accounts(snaps) if a["section"] in WC_SECTIONS]
    if not accs:
        return [], None, False
    saved = load_settings().get("fcf_wc_map")
    for a in accs:
        a["auto"], a["reason"] = suggest_wc_category(a["name"], a["section"])
        a["cat"] = (saved or {}).get(a["id"], a["auto"]) if saved is not None else a["auto"]
    order = {k: i for i, k in enumerate(WC_CATEGORIES)}
    accs.sort(key=lambda a: (order[a["cat"]], account_number(a["name"]) or 99999, a["name"]))
    return accs, {a["id"]: a["cat"] for a in accs}, saved is not None


def fcf_fa_da_accounts(eb_accs: list[dict]) -> tuple[list[dict], set]:
    """Fallback only: EBITDA D&A add-back accounts, ticked when charged on fixed assets."""
    saved = load_settings().get("fcf_fa_da_ids")
    rows = [dict(a) for a in eb_accs if a["da"] and a["cat"] in ("cogs", "opex")]
    for a in rows:
        a["auto_fa"] = suggest_fa_da(a["name"])
        a["fa"] = (a["id"] in saved) if saved is not None else a["auto_fa"]
    return rows, {a["id"] for a in rows if a["fa"]}


def fcf_inputs():
    st = load_settings()
    pl = pl_by_month(load_pl_snapshots())
    snaps = load_bs_snapshots()
    eb_accs, cat_map, da_ids, _ = ebitda_accounts(pl)
    capex_accs, capex_ids, capex_saved = fcf_capex_accounts(snaps)
    fa_da_accs, fa_da_ids = fcf_fa_da_accounts(eb_accs)
    last_closed = max((m for m in pl if pl[m]["revenue"]), default=None)
    sections = st.get("fcf_capex_sections") or ["FixedAssets"]
    wc_accs, wc_map, wc_saved = fcf_wc_accounts(snaps)
    wc_sec = st.get("fcf_wc_section_map") or DEFAULT_SETTINGS["fcf_wc_section_map"]
    rows = fcf_series(pl, snaps, cat_map, da_ids, last_closed, capex_ids, sections, fa_da_ids, wc_map, wc_sec)
    wc_mode = rows[-1]["wc_mode"] if rows else ("accounts" if wc_map is not None else "sections")
    if wc_mode == "accounts":
        members = {c: [a["name"] for a in wc_accs if a["cat"] == c] for c in WC_CATEGORIES}
    else:
        members = {c: [k for k, v in wc_sec.items() if v == c] for c in WC_CATEGORIES}
    label = lambda cats: " + ".join(f"{WC_CATEGORIES[c].split(' (')[0]}" for c in cats if members[c]) or "nothing"
    names = {a["id"]: a["name"] for a in capex_accs}
    info = {"n": len(snaps), "collection": BS_MONTHLY, "last_closed": last_closed,
            "mode": rows[-1]["mode"] if rows else ("accounts" if capex_ids is not None else "sections"),
            "capex_saved": capex_saved, "capex_names": [names[i] for i in sorted(capex_ids or [], key=lambda i: names[i])],
            "accum_names": [a["name"] for a in capex_accs if a["cat"] == "accum"],
            "excluded_names": [a["name"] for a in capex_accs if a["cat"] == "exclude"],
            "sections": sections, "fa_da_names": [a["name"] for a in fa_da_accs if a["fa"]],
            "da_names": [a["name"] for a in eb_accs if a["da"] and a["cat"] in ("cogs", "opex")],
            "wc_mode": wc_mode, "wc_saved": wc_saved, "wc_members": members, "wc_cats": WC_CATEGORIES,
            "wc_assets": label(WC_ASSET_CATS), "wc_liabs": label(WC_LIAB_CATS), "ar_names": members["ar"],
            "show_ar": bool(st.get("fcf_show_ar_check", True)), "names": names}
    return rows, info


@app.route("/fcf")
def fcf_page():
    rows, info = fcf_inputs()
    view = request.args.get("view", "ttm")
    view = view if view in ("ttm", "month") else "ttm"
    shown = [r for r in rows if r["ttm_ok"]] if view == "ttm" else rows
    latest = shown[-1] if shown else None
    year_ago = next((r for r in shown if latest and r["month"] == add_months(latest["month"], -12)), None)
    return render_template("fcf.html", rows=[{k: v for k, v in r.items() if k != "capex_lines"} for r in shown],
                           latest=latest, year_ago=year_ago, info=info, view=view, db_name=MONGO_DB)


@app.route("/fcf/<month>")
def fcf_detail(month):
    rows, info = fcf_inputs()
    r = next((x for x in rows if x["month"] == month), None)
    if not r:
        flash(f"No FCF data for {month}.", "err")
        return redirect(url_for("fcf_page"))
    by = {x["month"]: x for x in rows}
    win = [by[m] for m in r["window"] if m in by]
    capex_by_acct = {}
    for x in win:
        for i, v in x["capex_lines"].items():
            capex_by_acct[info["names"].get(i, i)] = capex_by_acct.get(info["names"].get(i, i), 0.0) + v
    return render_template("fcf_detail.html", r=r, win=win, info=info, db_name=MONGO_DB,
                           capex_by_acct=sorted(capex_by_acct.items()))


@app.route("/fcf.csv")
def fcf_csv():
    rows, info = fcf_inputs()
    buf = io.StringIO()
    w = csv.writer(buf)
    mcols = ["ni", "da", "ebitda", "dwc", "dar", "ocf", "capex", "fcf", "m_fcf_pct"]
    tcols = ["t_ni", "t_da", "t_ebitda", "t_dwc", "t_ocf", "t_capex", "t_fcf", "fcf_pct", "t_ocf_x_ar", "fcf_pct_x_ar"]
    cats = [c for c in WC_CATEGORIES if c != "exclude"]
    w.writerow(["month", "capex_mode", "wc_mode", *["month_" + c for c in mcols], *["ttm_" + c.removeprefix("t_") for c in tcols],
                *["ttm_change_" + c for c in cats]])
    for r in rows:
        w.writerow([r["month"], r["mode"], r["wc_mode"], *[None if r.get(c) is None else round(r[c], 2) for c in mcols],
                    *[None if r.get(c) is None else round(r[c], 2) for c in tcols],
                    *[round(r["t_dwc_parts"][c], 2) if r.get("t_dwc_parts") else None for c in cats]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=fcf_conversion.csv"})


@app.post("/settings/fcf")
def save_fcf_settings():
    cat_map = {k[5:]: v for k, v in request.form.items() if k.startswith("capx_") and v in CAPEX_CATEGORIES}
    if request.form.get("has_accounts") == "1" and "capex" not in cat_map.values():
        flash("Not saved - pick at least one capex account.", "err")
        return redirect(url_for("settings_page") + "#fcf")
    update = {"fcf_show_ar_check": request.form.get("fcf_show_ar_check") == "on"}
    if request.form.get("has_wc_accounts") == "1":
        update["fcf_wc_map"] = {k[4:]: v for k, v in request.form.items() if k.startswith("wcc_") and v in WC_CATEGORIES}
    else:
        update["fcf_wc_section_map"] = {k[4:]: v for k, v in request.form.items()
                                        if k.startswith("wcs_") and k[4:] in WC_SECTIONS and v in WC_CATEGORIES}
    if request.form.get("has_accounts") == "1":
        update["fcf_capex_map"] = cat_map
    else:
        update["fcf_capex_sections"] = [k[4:] for k in request.form if k.startswith("cxs_")] or ["FixedAssets"]
        update["fcf_fa_da_ids"] = [k[5:] for k in request.form if k.startswith("fada_")]
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    flash("FCF conversion settings saved.", "ok")
    return redirect(url_for("settings_page") + "#fcf")


@app.post("/settings/fcf/reset")
def reset_fcf_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {k: "" for k in (
        "fcf_capex_map", "fcf_capex_sections", "fcf_fa_da_ids", "fcf_wc_map", "fcf_wc_section_map")}}, upsert=True)
    flash("FCF conversion settings reset to the automatic selection.", "ok")
    return redirect(url_for("settings_page") + "#fcf")


# ---------------------------------------------------------------------------
# Cash conversion cycle (CB-10): quarter-end AR / inventory / AP vs quarterly revenue and COGS
# ---------------------------------------------------------------------------
def ccc_accounts(snaps: list[dict]) -> tuple[list[dict], dict | None, bool]:
    """Current asset / liability accounts classified AR / Inventory / AP / Exclude.
    -> (accounts, {id: category} or None without per-account balances, saved)"""
    accs = [a for a in bs_accounts(snaps) if a["section"] in CCC_SECTIONS]
    if not accs:
        return [], None, False
    saved = load_settings().get("ccc_account_map")
    for a in accs:
        a["auto"], a["reason"] = suggest_ccc_category(a["name"], a["section"])
        a["cat"] = (saved or {}).get(a["id"], a["auto"]) if saved is not None else a["auto"]
    order = {k: i for i, k in enumerate(CCC_CATEGORIES)}
    accs.sort(key=lambda a: (order[a["cat"]], account_number(a["name"]) or 99999, a["name"]))
    return accs, {a["id"]: a["cat"] for a in accs}, saved is not None


def ccc_inputs():
    st = load_settings()
    pl = pl_by_month(load_pl_snapshots())
    snaps = load_bs_snapshots()
    eb_accs, cat_map, da_ids, _ = ebitda_accounts(pl)
    accs, ccc_map, saved = ccc_accounts(snaps)
    sec_map = st.get("ccc_section_map") or DEFAULT_SETTINGS["ccc_section_map"]
    include_da = bool(st.get("ccc_cogs_include_da", True))
    last_closed = max((m for m in pl if pl[m]["revenue"]), default=None)
    rows = ccc_series(pl, snaps, cat_map, da_ids, last_closed, ccc_map, sec_map, include_da)
    mode = rows[-1]["mode"] if rows else ("accounts" if ccc_map is not None else "sections")
    members = ({c: [a["name"] for a in accs if a["cat"] == c] for c in CCC_CATEGORIES} if mode == "accounts"
               else {c: [k for k, v in sec_map.items() if v == c] for c in CCC_CATEGORIES})
    info = {"n": len(snaps), "collection": BS_MONTHLY, "last_closed": last_closed, "mode": mode, "saved": saved,
            "members": members, "include_da": include_da,
            "cogs_da_names": [a["name"] for a in eb_accs if a["da"] and a["cat"] == "cogs"]}
    return rows, info


@app.route("/ccc")
def ccc_page():
    rows, info = ccc_inputs()
    view = request.args.get("view", "quarter")
    view = view if view in ("quarter", "month") else "quarter"
    shown = [r for r in rows if r["quarter_end"]] if view == "quarter" else rows
    latest_q = next((r for r in reversed(rows) if r["quarter_end"]), None)
    year_ago = next((r for r in rows if latest_q and r["month"] == add_months(latest_q["month"], -12)), None)
    return render_template("ccc.html", rows=shown, latest=latest_q, year_ago=year_ago, info=info, view=view,
                           db_name=MONGO_DB)


@app.route("/ccc/<month>")
def ccc_detail(month):
    rows, info = ccc_inputs()
    r = next((x for x in rows if x["month"] == month), None)
    if not r:
        flash(f"No cash conversion cycle for {month}.", "err")
        return redirect(url_for("ccc_page"))
    snap = next((d for d in load_bs_snapshots() if d["month"] == month), {})
    accs, ccc_map, _ = ccc_accounts(load_bs_snapshots())
    lines = []
    if info["mode"] == "accounts":
        for a in snap.get("accounts") or []:
            c = (ccc_map or {}).get(str(a.get("id")))
            if c in ("ar", "inventory", "ap"):
                lines.append({"cat": c, "name": a.get("name"), "amount": float(a.get("amount") or 0)})
    return render_template("ccc_detail.html", r=r, info=info, lines=lines, cats=CCC_CATEGORIES, db_name=MONGO_DB)


@app.route("/ccc.csv")
def ccc_csv():
    rows, info = ccc_inputs()
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["days", "revenue", "cogs", "cogs_da", "ar", "inventory", "ap", "dso", "dio", "dpo", "ccc", "wc"]
    w.writerow(["month_end", "quarter_end", "first_month", "balances_by", *cols])
    for r in rows:
        w.writerow([r["month"], r["quarter_end"], r["window"][0], r["mode"],
                    *[None if r[c] is None else round(r[c], 2) for c in cols]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=cash_conversion_cycle.csv"})


@app.post("/settings/ccc")
def save_ccc_settings():
    update = {"ccc_cogs_include_da": request.form.get("ccc_cogs_include_da") == "on"}
    if request.form.get("has_accounts") == "1":
        m = {k[5:]: v for k, v in request.form.items() if k.startswith("ccca_") and v in CCC_CATEGORIES}
        if "ar" not in m.values() or "ap" not in m.values():
            flash("Not saved - pick at least one AR and one AP account.", "err")
            return redirect(url_for("settings_page") + "#ccc")
        update["ccc_account_map"] = m
    else:
        update["ccc_section_map"] = {k[5:]: v for k, v in request.form.items()
                                     if k.startswith("cccs_") and k[5:] in CCC_SECTIONS and v in CCC_CATEGORIES}
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    flash("Cash conversion cycle settings saved.", "ok")
    return redirect(url_for("settings_page") + "#ccc")


@app.post("/settings/ccc/reset")
def reset_ccc_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {k: "" for k in (
        "ccc_account_map", "ccc_section_map", "ccc_cogs_include_da")}}, upsert=True)
    flash("Cash conversion cycle settings reset to automatic.", "ok")
    return redirect(url_for("settings_page") + "#ccc")


# ---------------------------------------------------------------------------
# Customer concentration (CM-02): top-N parent groups' share of TTM recognized revenue
# ---------------------------------------------------------------------------
def conc_inputs(line: str | None = None, top_n: int | None = None):
    st = load_settings()
    invoices = load_invoices()
    catalog = product_catalog(invoices)
    mapping = current_mapping(catalog)
    classes = invoice_classes(invoices)
    qbo_customers = list(db()[QBO_CUSTOMERS].find({"provider": PROVIDER},
                                                   {"_id": 0, "providerRecordId": 1, "displayName": 1, "parentRecordId": 1}))
    sf_accounts = list(db()[SF_ACCOUNTS].find({"provider": "salesforce"},
                                               {"_id": 0, "providerRecordId": 1, "name": 1, "segment": 1,
                                                "parentRecordId": 1, "qboCustomerId": 1}))
    links = link_customers(qbo_customers, sf_accounts)
    group_parent = bool(st.get("conc_group_parent", True))
    groups = customer_groups(qbo_customers, sf_accounts, links, group_parent)
    top_n = max(1, int(top_n or st.get("conc_top_n") or 10))
    rows = [r for r in concentration_series(invoices, mapping, st, groups, top_n, line)
            if r["month"] >= (st.get("start_month") or "")]
    custs = {str(i.get("customerRecordId")) for i in invoices if i.get("customerRecordId")}
    hows = defaultdict(int)
    for c in custs:
        hows[(groups.get(c) or {}).get("how", "itself")] += 1
    info = {"top_n": top_n, "group_parent": group_parent, "line": line, "start_month": st.get("start_month"), "n_qbo": len(qbo_customers),
            "n_sf": len(sf_accounts), "customers": len(custs), "hows": dict(hows),
            "annual_items": [p["name"] for p in catalog if p["mapping"] == "subscription_yearly"],
            "classes": classes}
    return rows, info


def conc_line_arg():
    line = request.args.get("line", "All")
    return None if line in ("", "All") else line


@app.route("/concentration")
def conc_page():
    line = conc_line_arg()
    rows, info = conc_inputs(line)
    latest = rows[-1] if rows else None
    year_ago = next((r for r in rows if latest and r["month"] == add_months(latest["month"], -12)), None)
    by_line = {}
    if line is None and latest:
        for l in info["classes"]:
            lr, _ = conc_inputs(l)
            by_line[l] = [{"month": r["month"], "share": r["share"], "largest": r["largest"], "total": r["total"],
                           "groups": r["groups"]} for r in lr]
    return render_template("concentration.html", rows=[{k: v for k, v in r.items() if k not in ("ranking", "window")} for r in rows],
                           latest=latest, year_ago=year_ago, info=info, line=line or "All", lines=info["classes"],
                           by_line=by_line, db_name=MONGO_DB)


@app.route("/concentration/<month>")
def conc_detail(month):
    line = conc_line_arg()
    n = request.args.get("n", type=int)
    rows, info = conc_inputs(line, n)
    r = next((x for x in rows if x["month"] == month), None)
    if not r:
        flash(f"No concentration figures for {month}.", "err")
        return redirect(url_for("conc_page"))
    return render_template("concentration_detail.html", r=r, info=info, line=line or "All", db_name=MONGO_DB)


@app.route("/concentration.csv")
def conc_csv():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["month", "class", "top_n", "top_n_share_pct", "largest_share_pct", "largest_customer",
                "top_n_invoiced_share_pct", "top_n_revenue_ttm", "total_revenue_ttm", "customer_groups"])
    for line in [None, *invoice_classes(load_invoices())]:
        rows, info = conc_inputs(line)
        for r in rows:
            w.writerow([r["month"], line or "All", r["top_n"], round(r["share"], 4),
                        None if r["largest"] is None else round(r["largest"], 4), r["largest_name"],
                        None if r["inv_share"] is None else round(r["inv_share"], 4), round(r["top"], 2),
                        round(r["total"], 2), r["groups"]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=customer_concentration.csv"})


@app.post("/settings/concentration")
def save_conc_settings():
    try:
        n = max(1, min(100, int(request.form.get("conc_top_n", 10))))
    except ValueError:
        n = 10
    update = {"conc_top_n": n, "conc_group_parent": request.form.get("conc_group_parent") == "on"}
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    flash("Customer concentration settings saved.", "ok")
    return redirect(url_for("settings_page") + "#concentration")


@app.post("/settings/concentration/reset")
def reset_conc_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {k: "" for k in (
        "conc_top_n", "conc_group_parent", "conc_item_lines")}}, upsert=True)
    flash("Customer concentration settings reset to automatic.", "ok")
    return redirect(url_for("settings_page") + "#concentration")


# ---------------------------------------------------------------------------
# Win rate vs tracked competitor (CM-03): CRM deals
# ---------------------------------------------------------------------------
def load_deals(provider: str) -> list[dict]:
    return list(db()[DEALS].find({"provider": provider}, {
        "_id": 0, "dealname": 1, "dealstage": 1, "pipeline": 1, "closedate": 1, "type": 1, "accountId": 1,
        "accountName": 1, "competitor": 1, "competitors": 1, "customFields": 1}))


def wr_config(deals: list[dict] | None = None) -> dict:
    """Resolved CM-03 settings plus the choices found in the deals (custom field labels, types, competitors)."""
    st = load_settings()
    provider = st.get("wr_provider") or "salesforce"
    deals = load_deals(provider) if deals is None else deals
    labels, types = defaultdict(int), defaultdict(int)
    has_std = has_multi = False
    for d in deals:
        for f in d.get("customFields") or []:
            if f.get("label"):
                labels[f["label"]] += 1
        types[d.get("type") or ""] += 1
        has_std = has_std or bool(d.get("competitor"))
        has_multi = has_multi or bool(d.get("competitors"))
    label_list = sorted(labels, key=lambda l: (-labels[l], l))
    type_list = sorted((t for t in types if t), key=lambda t: (-types[t], t))
    auto_comp = suggest_competitor_field(label_list, has_std, has_multi)
    auto_loss = suggest_loss_reason_field(label_list)
    auto_types = suggest_new_business_types(type_list)
    providers = sorted(p for p in db()[DEALS].distinct("provider") if p) or [provider]
    return {"provider": provider, "providers": providers, "n_deals": len(deals),
            "labels": label_list, "label_counts": dict(labels), "types": type_list, "type_counts": dict(types),
            "has_std": has_std, "has_multi": has_multi,
            "comp_field": st.get("wr_competitor_field") or auto_comp, "comp_auto": auto_comp,
            "loss_field": (st.get("wr_loss_reason_field") if st.get("wr_loss_reason_field") is not None else auto_loss) or None,
            "loss_auto": auto_loss,
            "exclude_reasons": st.get("wr_exclude_loss_reasons") or [],
            "nb_types": st.get("wr_new_business_types") if st.get("wr_new_business_types") is not None else auto_types,
            "nb_auto": auto_types, "headline": st.get("wr_headline"), "window": int(st.get("wr_window_months") or 6),
            "std": {STD_COMPETITOR: "Standard field: competitor", STD_COMPETITORS: "Standard field: competitors (OpportunityCompetitor)"}}


def wr_inputs(window: int | None = None, segment: str | None = None):
    cfg = wr_config()
    deals = load_deals(cfg["provider"])
    defs = list(db()[STAGE_DEFS].find({"provider": cfg["provider"], "entityType": "deal"},
                                       {"_id": 0, "pipeline": 1, "rawStage": 1, "isWon": 1, "isClosed": 1}))
    won_keys = {f"{x.get('pipeline')}::{x.get('rawStage')}" for x in defs if x.get("isWon")}
    closed_keys = {f"{x.get('pipeline')}::{x.get('rawStage')}" for x in defs if x.get("isClosed")}
    seg = {}
    if segment:
        seg = {str(a.get("providerRecordId")): a.get("segment") for a in db()[SF_ACCOUNTS].find(
            {"provider": "salesforce"}, {"_id": 0, "providerRecordId": 1, "segment": 1})}
    rows, comps = win_rate_series(deals, cfg["comp_field"], cfg["loss_field"], cfg["exclude_reasons"],
                                  set(cfg["nb_types"] or []), won_keys, closed_keys, window or cfg["window"],
                                  lambda d: seg.get(str(d.get("accountId"))), segment)
    this_month = datetime.now(timezone.utc).strftime("%Y-%m")
    rows = [r for r in rows if r["month"] < this_month]   # the current month isn't complete yet
    headline = cfg["headline"] if cfg["headline"] in comps else ("Verdance FSM" if "Verdance FSM" in comps
                                                                 else (comps[0] if comps else None))
    loss_seen = any(d for d in deals if cfg["loss_field"] and any(
        (f.get("label") or "").strip().lower() == cfg["loss_field"].strip().lower() for f in d.get("customFields") or []))
    info = {**cfg, "competitors": comps, "headline": headline, "stage_defs": bool(defs), "loss_seen": loss_seen,
            "segments": sorted({a.get("segment") for a in db()[SF_ACCOUNTS].find({}, {"_id": 0, "segment": 1}) if a.get("segment")})}
    return rows, info


def wr_args():
    view = request.args.get("view", "period")
    view = view if view in ("period", "ttm") else "period"
    seg = request.args.get("segment") or None
    return view, (None if seg in (None, "", "All") else seg)


def wr_grain():
    g = request.args.get("grain", "month")
    return g if g in ("month", "quarter") else "month"


def wr_label(r: dict, grain: str) -> dict:
    m = int(r["month"][5:7])
    r["quarter_end"] = m % 3 == 0
    r["label"] = f"Q{m // 3}-{r['month'][:4]}" if grain == "quarter" and r["quarter_end"] else r["month"]
    return r


@app.route("/win-rate")
def wr_page():
    view, segment = wr_args()
    st_window = int(load_settings().get("wr_window_months") or 6)
    rows, info = wr_inputs(12 if view == "ttm" else st_window, segment)
    grain = wr_grain()
    rows = [wr_label(r, grain) for r in rows if r["month"] >= (load_settings().get("start_month") or "")]
    if grain == "quarter":
        rows = [r for r in rows if r["quarter_end"]]
    latest = rows[-1] if rows else None
    year_ago = next((r for r in rows if latest and r["month"] == add_months(latest["month"], -12)), None)
    return render_template("win_rate.html", rows=rows, latest=latest, year_ago=year_ago, info=info, view=view,
                           segment=segment or "All", window=12 if view == "ttm" else st_window, grain=grain,
                           db_name=MONGO_DB)


@app.route("/win-rate/<month>")
def wr_detail(month):
    view, segment = wr_args()
    window = 12 if view == "ttm" else int(load_settings().get("wr_window_months") or 6)
    rows, info = wr_inputs(window, segment)
    r = next((x for x in rows if x["month"] == month), None)
    if not r:
        flash(f"No win-rate figures for {month}.", "err")
        return redirect(url_for("wr_page"))
    grain = wr_grain()
    return render_template("win_rate_detail.html", r=wr_label(r, grain), info=info, view=view, segment=segment or "All",
                           window=window, grain=grain, db_name=MONGO_DB)


@app.route("/win-rate.csv")
def wr_csv():
    view, segment = wr_args()
    window = 12 if view == "ttm" else int(load_settings().get("wr_window_months") or 6)
    rows, info = wr_inputs(window, segment)
    grain = wr_grain()
    rows = [wr_label(r, grain) for r in rows]
    if grain == "quarter":
        rows = [r for r in rows if r["quarter_end"]]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["period", "month", "window_months", "segment", "competitor", "deals", "no_decision_dropped", "decided", "won",
                "win_rate_pct", "closed_new_business", "competitor_logged_pct"])
    for r in rows:
        for c in info["competitors"]:
            x = r["comp"][c]
            w.writerow([r["label"], r["month"], window, segment or "All", c, x["deals"], x["no_decision"], x["decided"], x["won"],
                        None if x["rate"] is None else round(x["rate"], 4), r["closed"], round(r["logged"], 4)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=competitor_win_rate.csv"})


@app.post("/settings/win-rate")
def save_wr_settings():
    f = request.form
    try:
        window = max(1, min(24, int(f.get("wr_window_months", 6))))
    except ValueError:
        window = 6
    types = [k[6:] for k in f if k.startswith("wrtyp_")]
    if not types:
        flash("Not saved - pick at least one New Business deal type.", "err")
        return redirect(url_for("settings_page") + "#win-rate")
    update = {"wr_provider": f.get("wr_provider") or "salesforce",
              "wr_competitor_field": f.get("wr_competitor_field") or None,
              "wr_loss_reason_field": f.get("wr_loss_reason_field") or "",
              "wr_exclude_loss_reasons": [x.strip() for x in (f.get("wr_exclude_loss_reasons") or "").splitlines() if x.strip()],
              "wr_new_business_types": types, "wr_headline": f.get("wr_headline") or None, "wr_window_months": window}
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    flash("Competitor win rate settings saved.", "ok")
    return redirect(url_for("settings_page") + "#win-rate")


@app.post("/settings/win-rate/reset")
def reset_wr_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {k: "" for k in (
        "wr_provider", "wr_competitor_field", "wr_loss_reason_field", "wr_exclude_loss_reasons",
        "wr_new_business_types", "wr_headline", "wr_window_months")}}, upsert=True)
    flash("Competitor win rate settings reset to automatic.", "ok")
    return redirect(url_for("settings_page") + "#win-rate")


# ---------------------------------------------------------------------------
# Funnel conversion (CM-06): contacts' lifecycle-stage dates + won deals
# ---------------------------------------------------------------------------
def load_contacts(provider: str) -> list[dict]:
    return list(db()[CONTACTS].find({"provider": provider}, {
        "_id": 0, "providerRecordId": 1, "email": 1, "analyticsSource": 1, "leadCreatedAt": 1,
        "lifecycleStageHistory": 1}))


def fn_config(contacts: list[dict] | None = None) -> dict:
    st = load_settings()
    provider = st.get("fn_provider") or "hubspot"
    contacts = load_contacts(provider) if contacts is None else contacts
    stages, sources = defaultdict(int), defaultdict(int)
    for c in contacts:
        for h in c.get("lifecycleStageHistory") or []:
            if h.get("value"):
                stages[h["value"]] += 1
        sources[c.get("analyticsSource") or ""] += 1
    src_list = sorted((x for x in sources if x), key=lambda x: (-sources[x], x))
    auto_mkt = suggest_marketing_sources(src_list)
    md = list(st.get("fn_mature_days") or [60, 90, 180, 60, 180])
    md = (md + [60, 90, 180, 60, 180][len(md):])[:5]
    return {"provider": provider, "providers": sorted(p for p in db()[CONTACTS].distinct("provider") if p) or [provider],
            "n": len(contacts), "stages": sorted(stages, key=lambda x: (-stages[x], x)), "stage_counts": dict(stages),
            "sources": src_list, "source_counts": dict(sources), "no_source": sources.get("", 0),
            "lead_stage": st.get("fn_lead_stage") or "lead", "mql_stage": st.get("fn_mql_stage") or "marketingqualifiedlead",
            "sql_stage": st.get("fn_sql_stage") or "salesqualifiedlead",
            "opp_stage": st.get("fn_opp_stage") or "opportunity",
            "sql_via_mql": bool(st.get("fn_sql_via_mql", True)),
            "marketing": st.get("fn_marketing_sources") if st.get("fn_marketing_sources") is not None else auto_mkt,
            "mkt_auto": auto_mkt, "dedupe": bool(st.get("fn_dedupe_email", True)), "mature": [int(x) for x in md]}


def fn_inputs():
    cfg = fn_config()
    contacts = load_contacts(cfg["provider"])
    defs = list(db()[STAGE_DEFS].find({"provider": cfg["provider"], "entityType": "deal", "isWon": True},
                                       {"_id": 0, "pipeline": 1, "rawStage": 1}))
    won_keys = {f"{x.get('pipeline')}::{x.get('rawStage')}" for x in defs}
    won_ids = set()
    for d in db()[DEALS].find({"provider": cfg["provider"]}, {"_id": 0, "pipeline": 1, "dealstage": 1, "contactIds": 1}):
        stage = d.get("dealstage") or ""
        won = (f"{d.get('pipeline')}::{stage}" in won_keys) if won_keys else stage.replace(" ", "").lower() in ("closedwon", "won")
        if won:
            won_ids.update(str(i) for i in d.get("contactIds") or [])
    rows = funnel_contacts(contacts, cfg["lead_stage"], cfg["mql_stage"], cfg["sql_stage"], won_ids, cfg["opp_stage"])
    today = datetime.now(timezone.utc).date()
    last = add_months(today.strftime("%Y-%m"), -1)
    data_last = max((r["created"][:7] for r in rows if r["created"]), default=None)
    if data_last and data_last < last:
        last = data_last          # no contacts synced after this month
    start = load_settings().get("start_month") or "2023-10"
    first = add_months(start, -11)
    series = funnel_series(rows, set(cfg["marketing"]), cfg["dedupe"], today.isoformat(), cfg["mature"], first, last,
                           cfg["sql_via_mql"])
    cfg.update({"won_contacts": len(won_ids), "cutoff": today.isoformat(), "start": start, "stage_defs": bool(defs)})
    return series, cfg


def fn_periods(series: list[dict], grain: str, view: str, start: str) -> list[dict]:
    by = {r["month"]: r for r in series}
    out = []
    for r in series:
        m = r["month"]
        if m < start or (grain == "quarter" and int(m[5:]) % 3):
            continue
        k = 12 if view == "ttm" else (3 if grain == "quarter" else 1)
        win = [add_months(m, -i) for i in range(k)][::-1]
        if not all(w in by for w in win):
            continue
        t = funnel_rate([by[w] for w in win])
        t.update({"month": m, "window": [win[0], win[-1]],
                  "label": f"Q{int(m[5:]) // 3}-{m[:4]}" if grain == "quarter" else m})
        out.append(t)
    return out


def fn_args():
    g = request.args.get("grain", "month")
    v = request.args.get("view", "period")
    return (g if g in ("month", "quarter") else "month"), (v if v in ("period", "ttm") else "period")


@app.route("/funnel")
def fn_page():
    grain, view = fn_args()
    series, info = fn_inputs()
    rows = fn_periods(series, grain, view, info["start"])
    latest = rows[-1] if rows else None
    year_ago = next((r for r in rows if latest and r["month"] == add_months(latest["month"], -12)), None)
    return render_template("funnel.html", rows=rows, latest=latest, year_ago=year_ago, info=info, grain=grain,
                           view=view, steps=FUNNEL_STEPS, db_name=MONGO_DB)


@app.route("/funnel/<month>")
def fn_detail(month):
    grain, view = fn_args()
    series, info = fn_inputs()
    rows = fn_periods(series, grain, view, "0000")
    r = next((x for x in rows if x["month"] == month), None)
    if not r:
        flash(f"No funnel figures for {month}.", "err")
        return redirect(url_for("fn_page"))
    months = [x for x in series if r["window"][0] <= x["month"] <= r["window"][1]]
    return render_template("funnel_detail.html", r=r, months=months, info=info, grain=grain, view=view,
                           steps=FUNNEL_STEPS, db_name=MONGO_DB)


@app.route("/funnel.csv")
def fn_csv():
    grain, view = fn_args()
    series, info = fn_inputs()
    rows = fn_periods(series, grain, view, info["start"])
    buf = io.StringIO()
    w = csv.writer(buf)
    rp = lambda v: None if v is None else round(v, 4)
    w.writerow(["period", "first_month", "last_month", "view", "lead_cohort", "lead_to_mql", "lead_to_mql_pct",
                "mql_cohort", "mql_to_sql", "mql_to_sql_pct", "sql_cohort", "sql_to_opportunity", "sql_to_opportunity_pct",
                "opportunities", "opportunity_to_won", "opportunity_to_won_pct", "sql_to_won", "sql_to_won_pct",
                "immature_lead_to_mql", "immature_mql_to_sql", "immature_sql_to_opportunity", "immature_opportunity_to_won",
                "immature_sql_to_won"])
    for r in rows:
        w.writerow([r["label"], r["window"][0], r["window"][1], view, r["lead"], r["l2m"], rp(r["l2m_pct"]),
                    r["mql"], r["m2s"], rp(r["m2s_pct"]), r["sql"], r["s2o"], rp(r["s2o_pct"]), r["opp"], r["o2w"],
                    rp(r["o2w_pct"]), r["s2w"], rp(r["s2w_pct"]), r["immature"]["l2m"], r["immature"]["m2s"],
                    r["immature"]["s2o"], r["immature"]["o2w"], r["immature"]["s2w"]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=funnel_conversion.csv"})


@app.post("/settings/funnel")
def save_fn_settings():
    f = request.form
    try:
        md = [max(0, int(f.get(f"fn_mature_{i}", d))) for i, d in enumerate((60, 90, 180, 60, 180))]
    except ValueError:
        md = [60, 90, 180, 60, 180]
    update = {"fn_provider": f.get("fn_provider") or "hubspot", "fn_lead_stage": f.get("fn_lead_stage") or "lead",
              "fn_mql_stage": f.get("fn_mql_stage") or "marketingqualifiedlead",
              "fn_sql_stage": f.get("fn_sql_stage") or "salesqualifiedlead",
              "fn_opp_stage": f.get("fn_opp_stage") or "opportunity", "fn_sql_via_mql": f.get("fn_sql_via_mql") == "on",
              "fn_marketing_sources": [k[6:] for k in f if k.startswith("fnsrc_")],
              "fn_dedupe_email": f.get("fn_dedupe_email") == "on", "fn_mature_days": md}
    if update["fn_mql_stage"] == update["fn_sql_stage"]:
        flash("Not saved - the MQL and SQL stages must be different.", "err")
        return redirect(url_for("settings_page") + "#funnel")
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    flash("Funnel conversion settings saved.", "ok")
    return redirect(url_for("settings_page") + "#funnel")


@app.post("/settings/funnel/reset")
def reset_fn_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {k: "" for k in (
        "fn_provider", "fn_lead_stage", "fn_mql_stage", "fn_sql_stage", "fn_opp_stage", "fn_sql_via_mql", "fn_marketing_sources",
        "fn_dedupe_email", "fn_mature_days")}}, upsert=True)
    flash("Funnel conversion settings reset to automatic.", "ok")
    return redirect(url_for("settings_page") + "#funnel")


# ---------------------------------------------------------------------------
# Lead volume vs plan (CM-08): MQL first-entry dates vs the Budget sheet's quarterly MQL target
# ---------------------------------------------------------------------------
def mql_plan_quarters() -> dict:
    return {k: float(v) for k, v in (load_settings().get("mql_plan_quarters") or {}).items() if v not in (None, "")}


def mql_inputs(grain: str, view: str):
    st = load_settings()
    cfg = fn_config()
    contacts = load_contacts(cfg["provider"])
    firsts = []
    for c in contacts:
        t = [to_date_str(h["timestamp"]) for h in c.get("lifecycleStageHistory") or []
             if h.get("value") == cfg["mql_stage"] and h.get("timestamp")]
        if t:
            firsts.append(min(t)[:7])
    today = datetime.now(timezone.utc).date()
    last = add_months(today.strftime("%Y-%m"), -1)
    data_last = max(firsts) if firsts else None
    if data_last and data_last < last:
        last = data_last          # the contacts haven't been synced past this month - later months would show 0 MQLs
    start = st.get("start_month") or "2023-10"
    months = month_range(add_months(start, -11), last)
    plan = mql_plan_quarters()
    rows = [r for r in mql_vs_plan(firsts, plan, months, grain, view) if r["month"] >= start]
    info = {"provider": cfg["provider"], "mql_stage": cfg["mql_stage"], "n": len(contacts), "mql_contacts": len(firsts),
            "data_last": data_last,
            "threshold": float(st.get("mql_threshold") or 0), "plan_quarters": plan,
            "missing_plan": sorted({quarter_key(m) for m in months if m >= start and quarter_key(m) not in plan})}
    return rows, info


@app.route("/lead-volume")
def mql_page():
    grain, view = fn_args()
    rows, info = mql_inputs(grain, view)
    latest = next((r for r in reversed(rows) if r["plan"] is not None), rows[-1] if rows else None)
    year_ago = next((r for r in rows if latest and r["month"] == add_months(latest["month"], -12)), None)
    return render_template("lead_volume.html", rows=rows, latest=latest, year_ago=year_ago, info=info, grain=grain,
                           view=view, db_name=MONGO_DB)


@app.route("/lead-volume.csv")
def mql_csv():
    grain, view = fn_args()
    rows, info = mql_inputs(grain, view)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["period", "first_month", "last_month", "view", "mqls", "plan", "mqls_minus_plan", "vs_plan_pct"])
    for r in rows:
        w.writerow([r["label"], r["window"][0], r["window"][1], view, r["mqls"],
                    None if r["plan"] is None else round(r["plan"], 2), None if r["diff"] is None else round(r["diff"], 2),
                    None if r["pct"] is None else round(r["pct"], 4)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=lead_volume_vs_plan.csv"})


@app.post("/settings/lead-volume")
def save_mql_settings():
    f = request.form
    plan, bad = {}, []
    for k, v in f.items():
        if not k.startswith("mqlq_"):
            continue
        v = (v or "").replace(",", "").strip()
        if not v:
            continue
        try:
            plan[k[5:]] = float(v)
        except ValueError:
            bad.append(k[5:])
    new_q = (f.get("mql_new_quarter") or "").strip().upper()
    if new_q and (f.get("mql_new_target") or "").strip():
        import re as _re2
        if _re2.fullmatch(r"\d{4}-Q[1-4]", new_q):
            try:
                plan[new_q] = float(f.get("mql_new_target").replace(",", ""))
            except ValueError:
                bad.append(new_q)
        else:
            bad.append(new_q)
    if bad:
        flash("Not saved - check the target for " + ", ".join(bad) + " (quarter as YYYY-Q1..Q4, target as a number).", "err")
        return redirect(url_for("settings_page") + "#lead-volume")
    try:
        thr = float(f.get("mql_threshold") or 0)
    except ValueError:
        thr = 0.0
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {"mql_plan_quarters": plan, "mql_threshold": thr}},
                                    upsert=True)
    flash("Lead volume plan saved.", "ok")
    return redirect(url_for("settings_page") + "#lead-volume")


@app.post("/settings/lead-volume/reset")
def reset_mql_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {"mql_plan_quarters": "", "mql_threshold": ""}},
                                    upsert=True)
    flash("MQL targets reset to the Budget sheet values.", "ok")
    return redirect(url_for("settings_page") + "#lead-volume")


@app.template_filter("usd")
def usd(v):
    if v is None:
        return "-"
    return f"-${abs(v):,.0f}" if v < -0.5 else f"${abs(v):,.0f}"



# ---------------------------------------------------------------------------
# Marketing ROI by channel (CM-07): CRM deals (leadSource / campaign / ARR) + P&L marketing accounts + channel spend
# ---------------------------------------------------------------------------
def load_roi_deals(provider: str) -> list[dict]:
    return list(db()[DEALS].find({"provider": provider}, {
        "_id": 0, "dealname": 1, "dealstage": 1, "type": 1, "accountName": 1, "amount": 1, "arr": 1,
        "leadSource": 1, "campaignName": 1, "dealCreatedAt": 1, "createdDate": 1}))


def roi_expense_accounts(pl: dict) -> list[tuple[str, str]]:
    seen = {}
    for m in sorted(pl):
        for (_, aid, name, _) in pl[m]["lines"]:
            seen[aid] = name
    return sorted(seen.items(), key=lambda x: x[1])


def roi_config(deals: list[dict] | None = None, pl: dict | None = None) -> dict:
    """Resolved CM-07 settings plus the choices found in the data (lead sources, deal types, P&L accounts)."""
    import copy
    st = load_settings()
    provider = st.get("roi_provider") or "salesforce"
    deals = load_roi_deals(provider) if deals is None else deals
    pl = pl_by_month(load_pl_snapshots()) if pl is None else pl
    src_n, type_n = defaultdict(int), defaultdict(int)
    has_arr = 0
    for d in deals:
        if d.get("leadSource"):
            src_n[d["leadSource"]] += 1
        if d.get("type"):
            type_n[d["type"]] += 1
        has_arr += d.get("arr") is not None
    sources = sorted(src_n, key=lambda s: (-src_n[s], s))
    types = sorted(type_n, key=lambda t: (-type_n[t], t))
    accounts = roi_expense_accounts(pl)
    auto_bl, auto_pr = suggest_roi_accounts(accounts)
    auto_src = suggest_roi_sources(sources)
    auto_types = suggest_new_business_types(types)
    value_field = st.get("roi_value_field") or "arr"
    providers = sorted(p for p in db()[DEALS].distinct("provider") if p) or [provider]
    saved = st.get("roi_channels")
    if saved and any("monthly" in c or c.get("spend") == "manual" for c in saved):
        saved = None      # an older save with typed-in ad spend - back to the MongoDB-only default
    channels = [{"name": c.get("name") or "", "sources": list(c.get("sources") or []),
                 "gl_accounts": list(c.get("gl_accounts") or [])} for c in copy.deepcopy(saved or ROI_DEFAULT_CHANNELS)]
    return {"provider": provider, "providers": providers, "n_deals": len(deals), "has_arr": has_arr,
            "value_field": value_field if value_field in ("arr", "amount") else "arr",
            "sources": sources, "source_counts": dict(src_n), "types": types, "type_counts": dict(type_n),
            "mk_sources": st.get("roi_marketing_sources") if st.get("roi_marketing_sources") is not None else auto_src,
            "mk_auto": auto_src,
            "nb_types": st.get("roi_new_business_types") if st.get("roi_new_business_types") is not None else auto_types,
            "nb_auto": auto_types, "accounts": accounts,
            "blended_ids": st.get("roi_blended_accounts") if st.get("roi_blended_accounts") is not None else auto_bl,
            "programs_ids": st.get("roi_programs_accounts") if st.get("roi_programs_accounts") is not None else auto_pr,
            "bl_auto": auto_bl, "pr_auto": auto_pr, "channels": channels,
            "threshold": float(st.get("roi_threshold") if st.get("roi_threshold") is not None else 1.0)}


def roi_inputs(grain: str, view: str):
    st = load_settings()
    pl = pl_by_month(load_pl_snapshots())
    deals = load_roi_deals(st.get("roi_provider") or "salesforce")
    cfg = roi_config(deals, pl)
    rows = roi_deal_rows(deals, cfg["value_field"], set(cfg["nb_types"] or []), set(cfg["mk_sources"] or []))
    gl = {m: [(aid, name, a) for (_, aid, name, a) in pl[m]["lines"]] for m in pl}
    today = datetime.now(timezone.utc).date()
    last = add_months(today.strftime("%Y-%m"), -1)
    if pl and max(pl) < last:
        last = max(pl)            # P&L not synced past this month - later months would show no spend
    if grain == "quarter" and int(last[5:7]) % 3:
        last_q = add_months(last, -(int(last[5:7]) % 3))   # only complete quarters
    else:
        last_q = last
    start = st.get("start_month") or "2023-10"
    months = month_range(add_months(start, -11), last_q if grain == "quarter" else last)
    series = [r for r in roi_series(rows, gl, set(cfg["blended_ids"]), set(cfg["programs_ids"]), cfg["channels"],
                                    months, grain, view) if r["month"] >= start]
    cfg.update({"start": start, "last": last, "pl_last": max(pl) if pl else None, "n_rows": len(rows),
                "missing_spend": sorted({c["name"] for r in series for c in r["channels"] if c["spend"] is None})})
    return series, rows, cfg


def roi_args():
    g = request.args.get("grain", "quarter")
    v = request.args.get("view", "period")
    return (g if g in ("month", "quarter") else "quarter"), (v if v in ("period", "ttm") else "period")


@app.route("/marketing-roi")
def roi_page():
    grain, view = roi_args()
    series, _, cfg = roi_inputs(grain, view)
    latest = series[-1] if series else None
    year_ago = next((r for r in series if latest and r["month"] == add_months(latest["month"], -12)), None)
    return render_template("marketing_roi.html", rows=series, latest=latest, year_ago=year_ago, cfg=cfg, grain=grain,
                           view=view, db_name=MONGO_DB)


@app.route("/marketing-roi/<month>")
def roi_detail(month):
    grain, view = roi_args()
    series, rows, cfg = roi_inputs(grain, view)
    r = next((x for x in series if x["month"] == month), None)
    if not r:
        flash(f"No {grain} ending {month}.", "err")
        return redirect(url_for("roi_page", grain=grain, view=view))
    lo, hi = r["window"]
    deals = sorted((d for d in rows if lo <= d["month"] <= hi), key=lambda d: (-d["value"], d["date"]))
    for d in deals:
        d["channels"] = [c["name"] for c in cfg["channels"] if roi_channel_of(d, c)]
    by_src = defaultdict(lambda: [0, 0.0])
    for d in deals:
        by_src[d["source"]][0] += 1
        by_src[d["source"]][1] += d["value"]
    return render_template("marketing_roi_detail.html", r=r, deals=deals, by_src=sorted(by_src.items(), key=lambda x: -x[1][1]),
                           cfg=cfg, grain=grain, view=view)


@app.route("/marketing-roi.csv")
def roi_csv():
    grain, view = roi_args()
    series, _, cfg = roi_inputs(grain, view)
    buf = io.StringIO()
    w = csv.writer(buf)
    names = [c["name"] for c in cfg["channels"]]
    head = ["period", "first_month", "last_month", "view", "pipeline_" + cfg["value_field"], "deals",
            "blended_spend", "blended_roi", "programs_spend", "programs_roi"]
    for n in names:
        head += [f"{n}_pipeline", f"{n}_deals", f"{n}_spend", f"{n}_roi"]
    w.writerow(head)
    rnd = lambda v, k=2: None if v is None else round(v, k)
    for r in series:
        line = [r["label"], r["window"][0], r["window"][1], view, rnd(r["pipeline"]), r["deals"], rnd(r["blended_spend"]),
                rnd(r["blended"], 4), rnd(r["programs_spend"]), rnd(r["programs"], 4)]
        for c in r["channels"]:
            line += [rnd(c["pipeline"]), c["deals"], rnd(c["spend"]), rnd(c["roi"], 4)]
        w.writerow(line)
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=marketing_roi_by_channel.csv"})


@app.post("/settings/marketing-roi")
def save_roi_settings():
    f = request.form
    channels = []
    idx = sorted({k.split("_")[2] for k in f if k.startswith("roi_ch_")}, key=lambda x: int(x) if x.isdigit() else 999)
    for i in idx:
        name = (f.get(f"roi_ch_{i}_name") or "").strip()
        if not name or f.get(f"roi_ch_{i}_remove") == "on":
            continue
        channels.append({"name": name, "sources": f.getlist(f"roi_ch_{i}_sources"), "gl_accounts": f.getlist(f"roi_ch_{i}_gl")})
    try:
        thr = float(f.get("roi_threshold") or 1)
    except ValueError:
        thr = 1.0
    update = {"roi_provider": f.get("roi_provider") or "salesforce",
              "roi_value_field": f.get("roi_value_field") if f.get("roi_value_field") in ("arr", "amount") else "arr",
              "roi_marketing_sources": f.getlist("roi_sources"), "roi_new_business_types": f.getlist("roi_types"),
              "roi_blended_accounts": f.getlist("roi_blended"), "roi_programs_accounts": f.getlist("roi_programs"),
              "roi_channels": channels, "roi_threshold": thr}
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    flash("Marketing ROI settings saved.", "ok")
    return redirect(url_for("settings_page") + "#marketing-roi")


@app.post("/settings/marketing-roi/reset")
def reset_roi_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {k: "" for k in (
        "roi_provider", "roi_value_field", "roi_marketing_sources", "roi_new_business_types", "roi_blended_accounts",
        "roi_programs_accounts", "roi_channels", "roi_threshold")}}, upsert=True)
    flash("Marketing ROI settings reset to automatic.", "ok")
    return redirect(url_for("settings_page") + "#marketing-roi")



# ---------------------------------------------------------------------------
# Marketing-sourced pipeline (CM-05): CRM deals - share of new-business ARR created from marketing lead sources
# ---------------------------------------------------------------------------
def load_msp_deals(provider: str) -> list[dict]:
    return list(db()[DEALS].find({"provider": provider}, {
        "_id": 0, "dealname": 1, "dealstage": 1, "pipeline": 1, "type": 1, "accountId": 1, "accountName": 1,
        "amount": 1, "arr": 1, "leadSource": 1, "closedate": 1, "dealCreatedAt": 1, "createdDate": 1}))


def msp_config(deals: list[dict] | None = None) -> dict:
    st = load_settings()
    provider = st.get("msp_provider") or "salesforce"
    deals = load_msp_deals(provider) if deals is None else deals
    src_n, type_n = defaultdict(int), defaultdict(int)
    has_arr = 0
    for d in deals:
        if d.get("leadSource"):
            src_n[d["leadSource"]] += 1
        if d.get("type"):
            type_n[d["type"]] += 1
        has_arr += d.get("arr") is not None
    sources = sorted(src_n, key=lambda s: (-src_n[s], s))
    types = sorted(type_n, key=lambda t: (-type_n[t], t))
    auto_src, auto_types = suggest_roi_sources(sources), suggest_new_business_types(types)
    vf = st.get("msp_value_field") or "arr"
    providers = sorted(p for p in db()[DEALS].distinct("provider") if p) or [provider]
    return {"provider": provider, "providers": providers, "n_deals": len(deals), "has_arr": has_arr,
            "value_field": vf if vf in ("arr", "amount") else "arr",
            "sources": sources, "source_counts": dict(src_n), "types": types, "type_counts": dict(type_n),
            "mk_sources": st.get("msp_marketing_sources") if st.get("msp_marketing_sources") is not None else auto_src,
            "mk_auto": auto_src,
            "nb_types": st.get("msp_new_business_types") if st.get("msp_new_business_types") is not None else auto_types,
            "nb_auto": auto_types, "exclude_dups": bool(st.get("msp_exclude_duplicates", True)),
            "true_new": bool(st.get("msp_true_new_logos", True)),
            "threshold": float(st.get("msp_threshold") or 0),
            "duplicates": (dups := duplicate_accounts(deals)),
            "dup_list": sorted({(d.get("accountName"), dups[str(d.get("accountId"))]) for d in deals
                                if str(d.get("accountId")) in dups})}


def msp_inputs(grain: str, view: str):
    st = load_settings()
    deals = load_msp_deals(st.get("msp_provider") or "salesforce")
    cfg = msp_config(deals)
    defs = list(db()[STAGE_DEFS].find({"provider": cfg["provider"], "entityType": "deal"},
                                       {"_id": 0, "pipeline": 1, "rawStage": 1, "isWon": 1, "isClosed": 1}))
    won_keys = {f"{x.get('pipeline')}::{x.get('rawStage')}" for x in defs if x.get("isWon")}
    closed_keys = {f"{x.get('pipeline')}::{x.get('rawStage')}" for x in defs if x.get("isClosed")}
    created, won = msp_rows(deals, cfg["value_field"], set(cfg["nb_types"] or []), set(cfg["mk_sources"] or []),
                            set(cfg["duplicates"]), lambda d: deal_outcome(d, won_keys, closed_keys), cfg["true_new"])
    today = datetime.now(timezone.utc).date()
    last = add_months(today.strftime("%Y-%m"), -1)
    data_last = max((r["month"] for r in created), default=None)
    if data_last and data_last < last:
        last = data_last
    if grain == "quarter" and int(last[5:7]) % 3:
        last = add_months(last, -(int(last[5:7]) % 3))
    start = st.get("start_month") or "2023-10"
    months = month_range(add_months(start, -11), last)
    rows = [r for r in msp_series(created, won, months, grain, view, cfg["exclude_dups"]) if r["month"] >= start]
    cfg.update({"start": start, "n_created": len(created), "n_won": len(won), "stage_defs": bool(defs),
                "n_dup_deals": sum(1 for r in created if r["dup"]), "n_repeat": sum(1 for r in won if r["repeat"])})
    return rows, created, won, cfg


@app.route("/marketing-sourced")
def msp_page():
    grain, view = roi_args()
    rows, _, _, cfg = msp_inputs(grain, view)
    latest = rows[-1] if rows else None
    year_ago = next((r for r in rows if latest and r["month"] == add_months(latest["month"], -12)), None)
    return render_template("marketing_sourced.html", rows=rows, latest=latest, year_ago=year_ago, cfg=cfg,
                           grain=grain, view=view, db_name=MONGO_DB)


@app.route("/marketing-sourced/<month>")
def msp_detail(month):
    grain, view = roi_args()
    rows, created, won, cfg = msp_inputs(grain, view)
    r = next((x for x in rows if x["month"] == month), None)
    if not r:
        flash(f"No {grain} ending {month}.", "err")
        return redirect(url_for("msp_page", grain=grain, view=view))
    lo, hi = r["window"]
    cd = sorted((d for d in created if lo <= d["month"] <= hi), key=lambda d: (-d["value"], d["date"]))
    wlo, whi = r["ttm_window"]
    wd = sorted((d for d in won if wlo <= d["month"] <= whi), key=lambda d: (-d["value"], d["date"]))
    by_src = defaultdict(lambda: [0, 0.0, False])
    for d in cd:
        if not (cfg["exclude_dups"] and d["dup"]):
            by_src[d["source"] or "(none)"][0] += 1
            by_src[d["source"] or "(none)"][1] += d["value"]
            by_src[d["source"] or "(none)"][2] = d["mk"]
    return render_template("marketing_sourced_detail.html", r=r, created=cd, won=wd, cfg=cfg, grain=grain, view=view,
                           by_src=sorted(by_src.items(), key=lambda x: -x[1][1]))


@app.route("/marketing-sourced.csv")
def msp_csv():
    grain, view = roi_args()
    rows, _, _, cfg = msp_inputs(grain, view)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["period", "first_month", "last_month", "view", "marketing_" + cfg["value_field"], "all_" + cfg["value_field"],
                "deals", "marketing_deals", "marketing_sourced_pct", "ttm_first_month", "ttm_last_month",
                "won_marketing_" + cfg["value_field"], "won_all_" + cfg["value_field"], "won_deals", "new_logo_arr_won_pct"])
    rnd = lambda v, k=2: None if v is None else round(v, k)
    for r in rows:
        w.writerow([r["label"], r["window"][0], r["window"][1], view, rnd(r["mk"]), rnd(r["total"]), r["n"], r["n_mk"],
                    rnd(r["pct"], 4), r["ttm_window"][0], r["ttm_window"][1], rnd(r["won_mk"]), rnd(r["won_total"]),
                    r["won_n"], rnd(r["won_pct"], 4)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=marketing_sourced_pipeline.csv"})


@app.post("/settings/marketing-sourced")
def save_msp_settings():
    f = request.form
    try:
        thr = float(f.get("msp_threshold") or 0)
    except ValueError:
        thr = 0.0
    update = {"msp_provider": f.get("msp_provider") or "salesforce",
              "msp_value_field": f.get("msp_value_field") if f.get("msp_value_field") in ("arr", "amount") else "arr",
              "msp_marketing_sources": f.getlist("msp_sources"), "msp_new_business_types": f.getlist("msp_types"),
              "msp_exclude_duplicates": f.get("msp_exclude_duplicates") == "on",
              "msp_true_new_logos": f.get("msp_true_new_logos") == "on", "msp_threshold": thr}
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    flash("Marketing-sourced pipeline settings saved.", "ok")
    return redirect(url_for("settings_page") + "#marketing-sourced")


@app.post("/settings/marketing-sourced/reset")
def reset_msp_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {k: "" for k in (
        "msp_provider", "msp_value_field", "msp_marketing_sources", "msp_new_business_types", "msp_exclude_duplicates",
        "msp_true_new_logos", "msp_threshold")}}, upsert=True)
    flash("Marketing-sourced pipeline settings reset to automatic.", "ok")
    return redirect(url_for("settings_page") + "#marketing-sourced")



# ---------------------------------------------------------------------------
# Customer & revenue diversification (ER-05): CM-02's build (parent groups, recognized revenue), top 5 instead of 10
# ---------------------------------------------------------------------------
def div_settings() -> dict:
    st = load_settings()
    try:
        n = max(1, min(100, int(st.get("div_top_n") or 5)))
    except (TypeError, ValueError):
        n = 5
    return {"top_n": n, "threshold": float(st.get("div_threshold") or 0), "group_parent": bool(st.get("conc_group_parent", True))}


@app.route("/diversification")
def div_page():
    cfg = div_settings()
    rows, info = conc_inputs(None, cfg["top_n"])
    latest = rows[-1] if rows else None
    year_ago = next((r for r in rows if latest and r["month"] == add_months(latest["month"], -12)), None)
    q = [r for r in rows if int(r["month"][5:7]) % 3 == 0]
    return render_template("diversification.html", rows=[{k: v for k, v in r.items() if k not in ("ranking", "window")} for r in rows],
                           latest=latest, year_ago=year_ago, info=info, cfg=cfg, quarters=q, db_name=MONGO_DB)


@app.route("/diversification.csv")
def div_csv():
    cfg = div_settings()
    rows, _ = conc_inputs(None, cfg["top_n"])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["month", "top_n", "top_n_share_pct", "largest_share_pct", "largest_customer", "top_n_revenue_ttm",
                "total_revenue_ttm", "customer_groups"] + [f"top_{i}_group" for i in range(1, cfg["top_n"] + 1)])
    for r in rows:
        names = [g[0] if isinstance(g, (list, tuple)) else (g.get("name") if isinstance(g, dict) else g)
                 for g in (r.get("ranking") or [])[:cfg["top_n"]]]
        w.writerow([r["month"], r["top_n"], round(r["share"], 4), None if r["largest"] is None else round(r["largest"], 4),
                    r["largest_name"], round(r["top"], 2), round(r["total"], 2), r["groups"]] + names)
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=customer_revenue_diversification.csv"})


@app.post("/settings/diversification")
def save_div_settings():
    try:
        n = max(1, min(100, int(request.form.get("div_top_n", 5))))
    except ValueError:
        n = 5
    try:
        thr = float(request.form.get("div_threshold") or 0)
    except ValueError:
        thr = 0.0
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$set": {"div_top_n": n, "div_threshold": thr}}, upsert=True)
    flash("Diversification settings saved.", "ok")
    return redirect(url_for("settings_page") + "#diversification")


@app.post("/settings/diversification/reset")
def reset_div_settings():
    db()["mrr_settings"].update_one({"_id": "settings"}, {"$unset": {"div_top_n": "", "div_threshold": ""}}, upsert=True)
    flash("Diversification settings reset (top 5).", "ok")
    return redirect(url_for("settings_page") + "#diversification")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5050)), debug=True)
