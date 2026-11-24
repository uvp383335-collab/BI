"""
MRR engine - pure functions, no database or web code.

Mapping types (one per product, chosen on the Settings page):
    subscription_monthly    counts in its invoice month
    subscription_quarterly  Amount / 3 spread over 3 months
    subscription_yearly     Amount / 12 spread over 12 months
    retainer_repeating      recurring only when the same customer is billed the same
                            amount in an adjacent month (e.g. Professional Services,
                            which is used for both retainers and one-off projects)
    retainer_always         every line is recurring, counts in its invoice month
    not_mrr                 one-time / usage / credits - never MRR
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

MAPPING_TYPES = {
    "subscription_monthly": "Subscription - monthly",
    "subscription_quarterly": "Subscription - quarterly (÷3)",
    "subscription_yearly": "Subscription - annual (÷12)",
    "retainer_repeating": "Retainer - only when repeated monthly",
    "retainer_always": "Retainer - always recurring",
    "not_mrr": "Not MRR (one-time / usage / credit)",
}
SPREAD_MONTHS = {"subscription_monthly": 1, "subscription_quarterly": 3, "subscription_yearly": 12}

ROI_DEFAULT_SOURCES = ["Paid Search", "Organic Search", "Review Site", "Webinar", "Web", "Trade Show", "Paid Social",
                       "Content Download", "Email", "Social"]
ROI_DEFAULT_CHANNELS = [   # CM-07: channel = its lead sources ÷ its P&L spend accounts (only spend that is in MongoDB)
    {"name": "Events", "sources": ["Trade Show"], "gl_accounts": ["6130"]},
]

DEFAULT_SETTINGS = {
    "start_month": "2023-10",
    "early_invoice_day": 16,          # multi-month invoice dated on/after this day starts next month
    "cad_countries": ["CA", "CAN", "CANADA"],
    "newlogo_lag_months": 1,          # Salesforce close month = first billing month - this
    "newlogo_group_parent": False,    # True: a new subsidiary of a paying parent is expansion, not a new logo
    "ltv_cap_months": 84,             # VC-07: expected customer lifetime is capped at this many months
    "ltv_threshold": 3.0,             # VC-07: LTV/CAC below this is a warning
    "ltv_grr_scope": "all",           # VC-07: TTM GRR on all recurring revenue ("all") or subscription only
    "cash_sections": ["BankAccounts"],  # CB-05: Balance Sheet section total(s) that make up unrestricted cash
    "cash_lookback_months": 3,        # CB-05: runway uses the average monthly decline over this many months
    "cash_show_ar_check": True,       # CB-05: show the "cash + negative A/R" data-quality line
    "cash_account_ids": None,         # CB-05: chosen unrestricted cash accounts (QuickBooks ids); None = automatic
    "cash_account_map": None,         # CB-05: {account id: unrestricted | restricted | exclude}; None = automatic
    "cash_restricted_adjust": 500000, # CB-05 fallback when snapshots have no per-account balances: subtract this
    "fcf_capex_map": None,            # CB-07: {account id: capex | accum | exclude}; None = automatic
    "fcf_capex_sections": ["FixedAssets"],  # CB-07 fallback (no per-account balances): capex = change in these + D&A
    "fcf_fa_da_ids": None,            # CB-07 fallback: P&L D&A accounts charged on those assets; None = automatic
    "fcf_wc_map": None,               # CB-07: {account id: ar | prepaid | inventory | ap | credit_card | accrued |
                                      #          deferred_revenue | exclude}; None = automatic
    "fcf_wc_section_map": {"AR": "ar", "OtherCurrentAssets": "prepaid", "AP": "ap", "CreditCards": "credit_card",
                           "OtherCurrentLiabilities": "accrued"},  # CB-07 fallback without per-account balances
    "fcf_show_ar_check": True,        # CB-07: show FCF % without the A/R swing (data-quality line)
    "ccc_account_map": None,          # CB-10: {account id: ar | inventory | ap | exclude}; None = automatic
    "ccc_section_map": {"AR": "ar", "AP": "ap", "OtherCurrentAssets": "exclude"},  # CB-10 fallback by section
    "ccc_cogs_include_da": True,      # CB-10: COGS = cogs + cogs D&A (5040); False = cogs excluding D&A
    "conc_top_n": 10,                 # CM-02: top-N customers (spec: 10)
    "conc_group_parent": True,        # CM-02: group customers under their top parent (Salesforce, else QuickBooks)
    "wr_provider": "salesforce",      # CM-03: CRM whose deals are used
    "wr_competitor_field": None,      # CM-03: customFields label holding the competitor ("@competitor" / "@competitors"
                                      #        = the standard fields); None = automatic ("Primary Competitor")
    "wr_loss_reason_field": None,     # CM-03: customFields label holding the loss reason; None = automatic / none
    "wr_exclude_loss_reasons": ["No Decision / Status Quo"],  # CM-03: losses with these reasons are not "decided"
    "wr_new_business_types": None,    # CM-03: deal `type` values that are New Business; None = automatic
    "wr_headline": None,              # CM-03: headline competitor; None = automatic (Verdance FSM / most deals)
    "wr_window_months": 6,            # CM-03: period window (spec: trailing 6 months; TTM view = 12)
    "fn_provider": "hubspot",         # CM-06: CRM whose contacts are used
    "fn_lead_stage": "lead",          # CM-06: lifecycle stage that marks "created" (else the earliest stage date)
    "fn_mql_stage": "marketingqualifiedlead",   # CM-06: lifecycle stage = MQL date
    "fn_sql_stage": "salesqualifiedlead",       # CM-06: lifecycle stage = SQL date
    "fn_opp_stage": "opportunity",    # CM-06: lifecycle stage = opportunity date (SQL to opportunity)
    "fn_sql_via_mql": True,           # CM-06: SQL cohort = contacts with an SQL date that also have an MQL date
    "fn_marketing_sources": None,     # CM-06: original-source values that are marketing-sourced; None = all but OFFLINE
    "fn_dedupe_email": True,          # CM-06: Lead to MQL counts one contact per email address
    "mql_plan_quarters": {            # CM-08: Budget sheet MQL target per quarter (Ridgeline_Operating_Plan_Submission.xlsx)
        "2023-Q1": 418, "2023-Q2": 433, "2023-Q3": 409, "2023-Q4": 457, "2024-Q1": 449, "2024-Q2": 459,
        "2024-Q3": 426, "2024-Q4": 484, "2025-Q1": 481, "2025-Q2": 496, "2025-Q3": 468, "2025-Q4": 514,
        "2026-Q1": 592, "2026-Q2": 611, "2026-Q3": 556, "2026-Q4": 596},
    "mql_threshold": 0.0,
    "roi_provider": "salesforce",     # CM-07: CRM whose deals carry leadSource / campaign
    "roi_value_field": "arr",         # CM-07: pipeline value = deal ARR (Oryon basis); "amount" = total contract value
    "roi_new_business_types": None,   # CM-07: deal types counted as new-business pipeline; None = auto (New Business)
    "roi_marketing_sources": None,    # CM-07: lead sources that are marketing-sourced; None = auto
    "roi_blended_accounts": None,     # CM-07: P&L accounts = total marketing spend; None = auto (61xx marketing)
    "roi_programs_accounts": None,    # CM-07: P&L accounts = program spend; None = auto (marketing minus salaries / payroll)
    "roi_channels": ROI_DEFAULT_CHANNELS,  # CM-07: channel -> lead sources + P&L spend accounts
    "roi_threshold": 1.0,
    "div_top_n": 5,                   # ER-05: top-N customer groups (spec: 5); grouping / revenue build shared with CM-02
    "div_threshold": 0.0,             # ER-05: flag a top-N share above this % (0 = off; spec gives none, direction down)
    "msp_provider": "salesforce",     # CM-05: CRM whose deals carry the lead source
    "msp_value_field": "arr",         # CM-05: ARR__c (spec); "amount" = total contract value
    "msp_marketing_sources": None,    # CM-05: lead sources tagged marketing-sourced; None = auto (all but outbound/partner/referral)
    "msp_new_business_types": None,   # CM-05: deal types counted; None = auto (New Business)
    "msp_exclude_duplicates": True,   # CM-05: drop deals on duplicate accounts (name = another account's name + extra words)
    "msp_true_new_logos": True,       # CM-05 sub: won deals only on accounts with no earlier won deal
    "msp_threshold": 0.0,             # CM-05: flag a marketing-sourced share below this % (0 = off; spec gives none)             # CM-07: flag ROI below this multiple (1x = pipeline < spend)             # CM-08: alert below this % vs plan (spec: 0% = plan)
    "fn_mature_days": [60, 90, 180, 60, 180],  # CM-06: immature days - MQL>SQL, Lead>MQL, SQL>won, SQL>opp, opp>won
    "fx_cad_usd": {                    # USD per 1 CAD by month (QuickBooks ExchangeRate list)
        "2022-10": 0.735, "2022-11": 0.7375, "2022-12": 0.7396, "2023-01": 0.7468, "2023-02": 0.7469,
        "2023-03": 0.7459, "2023-04": 0.744, "2023-05": 0.7416, "2023-06": 0.739, "2023-07": 0.7368,
        "2023-08": 0.7354, "2023-09": 0.735, "2023-10": 0.7357, "2023-11": 0.7375, "2023-12": 0.7398,
        "2024-01": 0.7384, "2024-02": 0.7407, "2024-03": 0.7424, "2024-04": 0.743, "2024-05": 0.7425,
        "2024-06": 0.741, "2024-07": 0.7387, "2024-08": 0.7362, "2024-09": 0.7337, "2024-10": 0.7319,
        "2024-11": 0.731, "2024-12": 0.7313, "2025-01": 0.7116, "2025-02": 0.7137, "2025-03": 0.7163,
        "2025-04": 0.7188, "2025-05": 0.7207, "2025-06": 0.7218, "2025-07": 0.7219, "2025-08": 0.7208,
        "2025-09": 0.7188, "2025-10": 0.7163, "2025-11": 0.7138, "2025-12": 0.7116, "2026-01": 0.7223,
        "2026-02": 0.722, "2026-03": 0.7229, "2026-04": 0.7247, "2026-05": 0.7271, "2026-06": 0.7297,
        "2026-07": 0.7319, "2026-08": 0.7335, "2026-09": 0.734,
    },
}


# ---------------------------------------------------------------------------
# automatic mapping suggestion
# ---------------------------------------------------------------------------
_NOT_MRR_WORDS = ("overage", "usage", "implementation", "onboarding", "training", "workshop",
                  "kit", "hardware", "tablet", "device", "credit", "write-off", "write off",
                  "bad debt", "refund", "setup", "set-up", "installation", "one-time", "one time")
_RETAINER_WORDS = ("professional services", "retainer", "managed services", "consulting")


def suggest_mapping(name: str, category: str | None = None, frequency: str | None = None) -> tuple[str, str]:
    """-> (mapping type, reason). Name rules first, then the backend's Settings category."""
    n = (name or "").lower()
    if any(w in n for w in _RETAINER_WORDS):
        return "retainer_repeating", "name looks like services/retainer"
    if any(w in n for w in _NOT_MRR_WORDS):
        return "not_mrr", "name looks one-time / usage / credit"
    if "annual" in n or "yearly" in n or "12 month" in n:
        return "subscription_yearly", "name says annual"
    if "quarter" in n:
        return "subscription_quarterly", "name says quarterly"
    if "monthly" in n or "/mo" in n or "subscription" in n:
        return "subscription_monthly", "name says monthly"
    if category == "recurring":
        f = {"monthly": "subscription_monthly", "quarterly": "subscription_quarterly",
             "yearly": "subscription_yearly"}.get(frequency or "", "subscription_monthly")
        return f, "categorized recurring in Oryon Settings"
    if category == "non_recurring":
        return "not_mrr", "categorized non-recurring in Oryon Settings"
    return "not_mrr", "no recurring signal - please review"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def add_months(ym: str, k: int) -> str:
    y, m = map(int, ym.split("-"))
    m += k
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}"


def month_range(start: str, end: str) -> list[str]:
    out, m = [], start
    while m <= end:
        out.append(m)
        m = add_months(m, 1)
    return out


def to_date_str(value) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    return str(value or "")[:10]


def fx_for(month: str, rates: dict[str, float]) -> float:
    if not rates:
        return 1.0
    if month in rates:
        return float(rates[month])
    earlier = [m for m in rates if m <= month]
    return float(rates[max(earlier)] if earlier else rates[min(rates)])


# ---------------------------------------------------------------------------
# calculation
# ---------------------------------------------------------------------------
def compute_mrr(invoices: list[dict], mapping: dict[str, str], settings: dict) -> tuple[dict, dict]:
    """
    invoices: [{customerRecordId, txnDate, billingAddress:{country}, lines:[{itemId, amount}]}]
    mapping:  {itemId: mapping type}
    returns:  (mrr[month][customer] = {"subscription": usd, "retainer": usd}, is_cad{customer: True})
    """
    early_day = int(settings.get("early_invoice_day") or 16)
    cad_countries = {c.upper() for c in settings.get("cad_countries") or []}
    rates = settings.get("fx_cad_usd") or {}

    subscription = defaultdict(lambda: defaultdict(float))
    retainer = defaultdict(lambda: defaultdict(float))
    repeat_lines = defaultdict(lambda: defaultdict(list))
    is_cad: dict[str, bool] = {}

    for inv in invoices:
        cust = str(inv.get("customerRecordId") or "")
        date = to_date_str(inv.get("txnDate"))
        if not cust or len(date) < 10:
            continue
        month = date[:7]
        if ((inv.get("billingAddress") or {}).get("country") or "").upper() in cad_countries:
            is_cad[cust] = True

        for line in inv.get("lines") or []:
            item = str(line.get("itemId") or "")
            amount = float(line.get("amount") or 0)
            if not item or not amount:
                continue
            kind = mapping.get(item, "not_mrr")
            if kind in SPREAD_MONTHS:
                n = SPREAD_MONTHS[kind]
                start = add_months(month, 1) if n > 1 and int(date[8:10]) >= early_day else month
                for k in range(n):
                    subscription[add_months(start, k)][cust] += amount / n
            elif kind == "retainer_always":
                retainer[month][cust] += amount
            elif kind == "retainer_repeating":
                repeat_lines[cust][month].append(amount)

    for cust, by_month in repeat_lines.items():
        for month, amounts in by_month.items():
            neighbours = by_month.get(add_months(month, -1), []) + by_month.get(add_months(month, 1), [])
            for a in amounts:
                if a in neighbours:
                    retainer[month][cust] += a

    mrr: dict[str, dict] = defaultdict(dict)
    for month in set(subscription) | set(retainer):
        for cust in set(subscription[month]) | set(retainer[month]):
            fx = fx_for(month, rates) if is_cad.get(cust) else 1.0
            mrr[month][cust] = {"subscription": subscription[month].get(cust, 0.0) * fx,
                                "retainer": retainer[month].get(cust, 0.0) * fx}
    return mrr, is_cad


def summarize(mrr: dict, months: list[str]) -> list[dict]:
    rows, prev = [], None
    for m in months:
        custs = mrr.get(m, {})
        sub = sum(v["subscription"] for v in custs.values())
        ret = sum(v["retainer"] for v in custs.values())
        total = sub + ret
        rows.append({
            "month": m,
            "subscription_mrr": round(sub, 2),
            "retainer_mrr": round(ret, 2),
            "total_mrr": round(total, 2),
            "arr": round(total * 12, 2),
            "active_customers": sum(1 for v in custs.values() if v["subscription"] + v["retainer"] > 0.005),
            "mom_pct": round((total - prev) / prev * 100, 2) if prev else None,
        })
        prev = total
    return rows


# ---------------------------------------------------------------------------
# retention (GRR / NRR) - Oryon spec "Retention(m0, m1)"
# ---------------------------------------------------------------------------
def compute_native_mrr(invoices: list[dict], mapping: dict[str, str], settings: dict) -> tuple[dict, dict]:
    """Customer MRR in each customer's own currency (no FX applied) - retention converts
    both ends of a window at the START month's rate (constant currency)."""
    s = dict(settings)
    s["fx_cad_usd"] = {}
    return compute_mrr(invoices, mapping, s)


def retention(native: dict, is_cad: dict, rates: dict, m0: str, m1: str,
              subscription_only: bool = False, with_customers: bool = False) -> dict | None:
    """
    Cohort = customers with MRR > 0 at m0 (customers who start later are excluded).
    For each: a = MRR at m0, b = MRR at m1, both at m0's CAD rate.
        churn      b = 0        C  += a
        downgrade  0 < b < a    Dn += a - b
        upgrade    b > a        U  += b - a
        flat       b = a
    S = sum a;  K = S - C - Dn;  E = K + U;  GRR = K / S x 100;  NRR = E / S x 100
    """
    def val(month, cust):
        v = native.get(month, {}).get(cust)
        if not v:
            return 0.0
        return v["subscription"] if subscription_only else v["subscription"] + v["retainer"]

    fx0 = fx_for(m0, rates)
    S = C = Dn = U = 0.0
    counts = {"churn": 0, "downgrade": 0, "upgrade": 0, "flat": 0}
    customers = []
    for cust in native.get(m0, {}):
        f = fx0 if is_cad.get(cust) else 1.0
        a = val(m0, cust) * f
        if a <= 0.005:
            continue
        b = val(m1, cust) * f
        S += a
        if b <= 0.005:
            bucket, delta = "churn", -a
            C += a
        elif b < a - 0.005:
            bucket, delta = "downgrade", b - a
            Dn += a - b
        elif b > a + 0.005:
            bucket, delta = "upgrade", b - a
            U += b - a
        else:
            bucket, delta = "flat", 0.0
        counts[bucket] += 1
        if with_customers:
            customers.append({"customer": cust, "currency": "CAD" if is_cad.get(cust) else "USD",
                              "start": a, "end": b, "change": delta, "bucket": bucket})
    if S <= 0:
        return None
    K = S - C - Dn
    E_ = K + U
    out = {"m0": m0, "m1": m1, "S": S, "C": C, "Dn": Dn, "U": U, "K": K, "E": E_,
           "grr": 100 * K / S, "nrr": 100 * E_ / S, "cohort": sum(counts.values()), **counts}
    if with_customers:
        out["customers"] = sorted(customers, key=lambda r: r["change"])
    return out


def window_start(end: str, grain: str, window: str) -> str:
    """TTM -> 12 months back; period view -> prior month (monthly) or prior quarter end (quarterly)."""
    if window == "ttm":
        return add_months(end, -12)
    return add_months(end, -3 if grain == "quarter" else -1)


def period_ends(start: str, end: str, grain: str) -> list[str]:
    months = month_range(start, end)
    if grain == "quarter":
        return [m for m in months if int(m[5:7]) % 3 == 0]
    return months


# ---------------------------------------------------------------------------
# new logos - QuickBooks invoices + Salesforce accounts
# ---------------------------------------------------------------------------
import re as _re

_SUFFIX = _re.compile(r"\b(incorporated|inc|llc|l\.l\.c|co|corp|corporation|company|ltd|limited|the)\b\.?")


def normalize_name(name: str) -> str:
    """'Summit Mechanical Group:Summit HVAC Services LLC' -> 'summithvacservices'."""
    n = (name or "").lower().split(":")[-1]
    n = _SUFFIX.sub("", n)
    return _re.sub(r"[^a-z0-9]", "", n)


def link_customers(qbo_customers: list[dict], sf_accounts: list[dict]) -> dict[str, dict]:
    """QuickBooks customer Id -> Salesforce account.
    1. Account.qboCustomerId (QBO_Customer_Id__c) when it is set - exact key.
    2. otherwise the QuickBooks DisplayName matched to the Account name after normalizing
       (case, punctuation, Inc/LLC/Corp/Co, and the parent part of 'Parent:Child')."""
    by_qbo_id = {str(a["qboCustomerId"]): a for a in sf_accounts if a.get("qboCustomerId")}
    by_name: dict[str, list[dict]] = {}
    for a in sf_accounts:
        by_name.setdefault(normalize_name(a.get("name", "")), []).append(a)
    links = {}
    for c in qbo_customers:
        cid = str(c.get("providerRecordId") or "")
        if not cid:
            continue
        acct, method = by_qbo_id.get(cid), "QBO_Customer_Id__c"
        if not acct:
            cands = by_name.get(normalize_name(c.get("displayName", "")), [])
            # prefer an account without a parent when Salesforce has duplicates
            cands = sorted(cands, key=lambda a: bool(a.get("parentRecordId")))
            acct, method = (cands[0], "name match" + (" (ambiguous)" if len(cands) > 1 else "")) if cands else (None, "")
        links[cid] = {"customer_name": c.get("displayName") or "", "account": acct, "method": method}
    return links


def new_logos(mrr_usd: dict, links: dict, lag_months: int = 1, group_parent: bool = False) -> list[dict]:
    """
    A new logo is a QuickBooks customer whose MRR is above $0 for the first time
    (no recurring MRR in any earlier month - win-backs are excluded).
      billing_month = that first month
      close_month   = billing_month - lag_months  (Salesforce close date; Ridgeline bills the month after close)
      new-logo ARR  = first-month MRR x 12  (annual deal: annual line / 12 x 12 = first-year contract value)
    group_parent=True also excludes customers whose Salesforce parent/group already had MRR
    (the Oryon report counts those subsidiaries as new logos, so it is off by default).
    """
    def group_of(cust: str) -> str:
        acct = (links.get(cust) or {}).get("account")
        if not acct:
            return "qbo:" + cust
        return acct.get("parentRecordId") or acct.get("providerRecordId") or "qbo:" + cust

    seen, seen_groups, out = set(), set(), []
    for month in sorted(mrr_usd):
        active = {c: v["subscription"] + v["retainer"] for c, v in mrr_usd[month].items()
                  if v["subscription"] + v["retainer"] > 0.005}
        for cust, mrr in active.items():
            if cust in seen:
                continue
            g = group_of(cust)
            subsidiary_of_existing = g in seen_groups
            link = links.get(cust) or {}
            acct = link.get("account") or {}
            out.append({
                "customer": cust,
                "customer_name": link.get("customer_name", ""),
                "account_id": acct.get("providerRecordId", ""),
                "account_name": acct.get("name", ""),
                "segment": acct.get("segment") or "Unlinked",
                "parent_id": acct.get("parentRecordId", ""),
                "link_method": link.get("method", "") or "not linked",
                "billing_month": month,
                "close_month": add_months(month, -lag_months),
                "first_mrr": mrr,
                "arr": mrr * 12,
                "subsidiary_of_existing": subsidiary_of_existing,
                "counted": not (group_parent and subsidiary_of_existing),
            })
        seen |= set(active)
        seen_groups |= {group_of(c) for c in active}
    return out


SEGMENTS = ["SMB", "Mid-Market", "Upper Mid-Market", "Enterprise", "Unlinked"]


def quarter_of(month: str) -> str:
    return f"Q{(int(month[5:7]) - 1) // 3 + 1}-{month[:4]}"


def summarize_new_logos(logos: list[dict], periods: list[str], grain: str, complete_until: str) -> list[dict]:
    """Totals per close month (or quarter) with segment split, count and growth.
    complete_until = last close month whose billing month is inside the invoice data."""
    def key(m):
        return quarter_of(m) if grain == "quarter" else m

    buckets = {p: {"arr": 0.0, "n": 0, **{s: 0.0 for s in SEGMENTS}, **{f"n_{s}": 0 for s in SEGMENTS}}
               for p in periods}
    for l in logos:
        k = key(l["close_month"])
        if k in buckets and l["counted"]:
            b = buckets[k]
            b["arr"] += l["arr"]; b["n"] += 1
            b[l["segment"]] += l["arr"]; b[f"n_{l['segment']}"] += 1
    rows, step = [], 4 if grain == "quarter" else 12
    for i, p in enumerate(periods):
        b = buckets[p]
        last_month = p if grain == "month" else f"{p[3:]}-{int(p[1]) * 3:02d}"
        prev = rows[i - 1] if i else None
        ya = rows[i - step] if i >= step else None
        rows.append({
            "period": p, "complete": last_month <= complete_until, **b,
            "pop_pct": (b["arr"] - prev["arr"]) / prev["arr"] * 100 if prev and prev["arr"] else None,
            "yoy_pct": (b["arr"] - ya["arr"]) / ya["arr"] * 100 if ya and ya["arr"] else None,
        })
    return rows


# ---------------------------------------------------------------------------
# CAC & payback (Oryon spec VC-06) - plmonthlysnapshots + new logos
# ---------------------------------------------------------------------------
CAC_RANGES = [(6010, 6050, "Sales"), (6110, 6115, "Marketing payroll"), (6120, 6160, "Marketing programs")]
_CAC_EXCLUDE_WORDS = ("customer success", "support", "cost of", "cogs", "depreciation", "amortization")
_CAC_INCLUDE_WORDS = ("sales", "marketing", "advertis", "sponsorship", "events", "trade show", "lead gen",
                      "partner referral", "commission")


def account_number(name: str) -> int | None:
    head = (name or "").strip().split(" ")[0]
    return int(head) if head.isdigit() else None


def suggest_cac_account(name: str, section: str = "expenses", numbered_chart: bool = False) -> tuple[bool, str]:
    """-> (selected, reason). Account-number ranges from the spec first (6010-6050 sales,
    6110-6115 marketing payroll, 6120-6160 marketing programs; 6210-6216 Customer Success is
    excluded), then a name check for charts of accounts without those numbers."""
    n = account_number(name)
    if n is not None:
        for lo, hi, label in CAC_RANGES:
            if lo <= n <= hi:
                return True, label
        if 6210 <= n <= 6216:
            return False, "Customer Success - excluded from CAC"
        return False, "outside the S&M account ranges"
    if numbered_chart:
        return False, "no account number (the S&M accounts are numbered 6010-6160)"
    low = (name or "").lower()
    if section != "expenses":
        return False, "other expense"
    if any(w in low for w in _CAC_EXCLUDE_WORDS):
        return False, "name looks like support / customer success / COGS"
    if any(w in low for w in _CAC_INCLUDE_WORDS):
        return True, "name looks like sales or marketing"
    return False, "no sales/marketing signal"


def pl_by_month(snapshots: list[dict]) -> dict[str, dict]:
    """plmonthlysnapshots documents -> {month: {"revenue", "cogs", "lines": [(section, accountId, name, amount)]}}"""
    out = {}
    for s in snapshots:
        m = s.get("month")
        if not m:
            continue
        rev = sum(float((l.get("amounts") or {}).get("Total") or 0) for l in s.get("income") or [])
        cogs = sum(float((l.get("amounts") or {}).get("Total") or 0) for l in s.get("cogs") or [])
        rc_lines = []
        for sec in ("income", "cogs"):
            for l in s.get(sec) or []:
                rc_lines.append((sec, str(l.get("accountId") or l.get("account")), l.get("account") or "",
                                 float((l.get("amounts") or {}).get("Total") or 0)))
        lines = []
        for sec in ("expenses", "otherExpenses"):
            for l in s.get(sec) or []:
                lines.append((sec, str(l.get("accountId") or l.get("account")), l.get("account") or "",
                              float((l.get("amounts") or {}).get("Total") or 0)))
        out[m] = {"revenue": rev, "cogs": cogs, "lines": lines, "rc_lines": rc_lines}
    return out


def cac_series(pl: dict, account_ids: set[str], logos: list[dict], ends: list[str],
               first_valid_close: str | None, complete_until: str | None) -> list[dict]:
    """
    For each month e (trailing 12 months ending at e):
      S&M      = sum of the selected expense accounts
      new logos / new-logo ARR = counted new logos by close month (New logos page)
      GM       = (revenue - COGS) / revenue
      CAC      = S&M / new logos
      payback  = CAC / ((new-logo ARR / new logos / 12) x GM)
      S&M per $1 of new ARR = S&M / new-logo ARR
    """
    by_close: dict[str, list[dict]] = {}
    for l in logos:
        if l["counted"]:
            by_close.setdefault(l["close_month"], []).append(l)
    rows = []
    for e in ends:
        window = [add_months(e, -k) for k in range(11, -1, -1)]
        have_pl = all(m in pl and pl[m]["revenue"] for m in window)
        sm = sum(a for m in window if m in pl for (_, aid, _, a) in pl[m]["lines"] if aid in account_ids)
        rev = sum(pl[m]["revenue"] for m in window if m in pl)
        cogs = sum(pl[m]["cogs"] for m in window if m in pl)
        win_logos = [l for m in window for l in by_close.get(m, [])]
        n = len(win_logos)
        arr = sum(l["arr"] for l in win_logos)
        gm = (rev - cogs) / rev if rev else None
        cac = sm / n if n else None
        payback = cac / ((arr / n / 12) * gm) if cac is not None and arr and gm else None
        logos_ok = bool(first_valid_close) and window[0] >= first_valid_close and \
            bool(complete_until) and window[-1] <= complete_until
        rows.append({"month": e, "start": window[0], "sm": sm, "revenue": rev, "cogs": cogs, "gm": gm,
                     "new_logos": n, "new_logo_arr": arr, "avg_arr": arr / n if n else None,
                     "cac": cac, "payback": payback, "sm_per_arr": sm / arr if arr else None,
                     "has_pl": have_pl, "logos_complete": logos_ok, "complete": have_pl and logos_ok})
    return rows



# ---------------------------------------------------------------------------
# COGS % and mix (Oryon spec VC-04) - plmonthlysnapshots income[] / cogs[]
# ---------------------------------------------------------------------------
PRODUCT_LINES = ["Platform", "Services", "Hardware"]
COGS_LINE_CHOICES = {"Platform": "Platform", "Services": "Services", "Hardware": "Hardware",
                     "Unassigned": "Company only (no product line)", "Exclude": "Exclude (not in COGS %)"}
_LINE_RANGES = [(0, 99, "Platform"), (100, 199, "Services"), (200, 299, "Hardware")]


def suggest_cogs_line(name: str, section: str, numbered_chart: bool) -> tuple[str, str]:
    """Income 40xx / COGS 50xx -> Platform, 41xx / 51xx -> Services, 42xx / 52xx -> Hardware."""
    n = account_number(name)
    base = 4000 if section == "income" else 5000
    if n is not None:
        if base <= n < base + 1000:
            for lo, hi, line in _LINE_RANGES:
                if base + lo <= n <= base + hi:
                    return line, f"{base + lo}-{base + hi} -> {line}"
            return "Unassigned", "numbered account outside the product ranges"
        return "Unassigned", "outside the 4xxx / 5xxx ranges"
    if numbered_chart:
        return "Exclude", "no account number - QuickBooks sandbox/demo account"
    low = (name or "").lower()
    for word, line in (("subscription", "Platform"), ("hosting", "Platform"), ("usage", "Platform"),
                       ("implementation", "Services"), ("professional", "Services"), ("training", "Services"),
                       ("hardware", "Hardware"), ("freight", "Hardware")):
        if word in low:
            return line, f"name contains '{word}'"
    return "Unassigned", "no product signal in the name"


def suggest_cogs_da(name: str, section: str) -> bool:
    """Capitalized-software amortization (cogs_da): account 5040 or an amortization/depreciation COGS line."""
    if section != "cogs":
        return False
    low = (name or "").lower()
    return account_number(name) == 5040 or "amortization" in low or "depreciation" in low


def cogs_period(pl: dict, months: list[str], line_map: dict[str, str], da_ids: set[str]) -> dict:
    """Sums over the months: revenue, COGS (incl. D&A), D&A, and revenue / COGS per product line.
    COGS % = 100 x COGS / revenue; excl. capitalized software = 100 x (COGS - D&A) / revenue;
    line COGS % = 100 x line COGS / line revenue; line share = 100 x line revenue / revenue."""
    r = {"revenue": 0.0, "cogs": 0.0, "da": 0.0, "months": len([m for m in months if m in pl]),
         "lines": {p: {"revenue": 0.0, "cogs": 0.0} for p in PRODUCT_LINES + ["Unassigned"]}}
    for m in months:
        for sec, aid, name, amt in (pl.get(m) or {}).get("rc_lines", []):
            line = line_map.get(aid, "Unassigned")
            if line == "Exclude":
                continue
            key = "revenue" if sec == "income" else "cogs"
            r[key] += amt
            r["lines"][line][key] += amt
            if sec == "cogs" and aid in da_ids:
                r["da"] += amt
    pct = lambda a, b: 100 * a / b if b else None
    r["pct"] = pct(r["cogs"], r["revenue"])
    r["pct_ex_da"] = pct(r["cogs"] - r["da"], r["revenue"])
    for p, v in r["lines"].items():
        v["pct"] = pct(v["cogs"], v["revenue"])
        v["share"] = pct(v["revenue"], r["revenue"])
    return r


# ---------------------------------------------------------------------------
# G&A % of revenue (Oryon spec VC-09) - plmonthlysnapshots expenses[] / income[]
# ---------------------------------------------------------------------------
def suggest_ga_account(name: str, section: str, numbered_chart: bool) -> tuple[bool, str]:
    """G&A = 6410-6485 and 6495. Excluded: 6490 transaction & deal fees (one-time) and
    6510 / 6520 D&A. Unnumbered accounts: only 'Insurance' (Ridgeline's prepaid insurance
    amortization lands in QuickBooks' default Insurance account)."""
    n = account_number(name)
    if n is not None:
        if 6410 <= n <= 6485 or n == 6495:
            return True, "G&A (6410-6485, 6495)"
        if n == 6490:
            return False, "one-time transaction & deal fees - excluded"
        if n in (6510, 6520):
            return False, "D&A - excluded"
        return False, "outside the G&A ranges"
    low = (name or "").lower()
    if section == "expenses" and "insurance" in low:
        return True, "insurance (prepaid amortization) - G&A"
    if numbered_chart:
        return False, "no account number - QuickBooks sandbox/demo account"
    if section == "expenses" and any(w in low for w in ("rent", "legal", "accounting", "office", "bank", "recruit",
                                                         "general", "administrative")):
        return True, "name looks like G&A"
    return False, "no G&A signal in the name"


def ga_period(pl: dict, months: list[str], ga_ids: set[str], revenue_map: dict[str, str]) -> dict:
    """G&A % = 100 x sum of the selected G&A accounts / revenue over the months.
    Revenue = income lines not set to Exclude on the COGS % mapping (same revenue as COGS %)."""
    r = {"revenue": 0.0, "ga": 0.0, "by_account": {}, "months": len([m for m in months if m in pl])}
    for m in months:
        snap = pl.get(m) or {}
        for sec, aid, name, amt in snap.get("rc_lines", []):
            if sec == "income" and revenue_map.get(aid) != "Exclude":
                r["revenue"] += amt
        for sec, aid, name, amt in snap.get("lines", []):
            if aid in ga_ids:
                r["ga"] += amt
                a = r["by_account"].setdefault(aid, {"name": name, "amount": 0.0})
                a["amount"] += amt
    r["pct"] = 100 * r["ga"] / r["revenue"] if r["revenue"] else None
    return r


# ---------------------------------------------------------------------------
# EBITDA margin (Oryon spec VC-10) - every plmonthlysnapshots line
# ---------------------------------------------------------------------------
EBITDA_CATEGORIES = {"revenue": "Revenue", "cogs": "COGS", "opex": "Opex",
                     "below": "Below EBITDA (interest, FX, tax)", "exclude": "Exclude"}


def suggest_ebitda_account(name: str, section: str, numbered_chart: bool) -> tuple[str, bool, str]:
    """-> (category, add_back_as_D&A, reason).
    Revenue = income; COGS = cogs (5040 capitalized-software amortization is D&A);
    Opex = 6xxx expenses (S&M, customer success, R&D, G&A incl. 6490 deal fees, 6510/6520 D&A);
    Below EBITDA = 7xxx-8xxx / other expenses (interest, FX, tax). Deal fees are not added back."""
    n = account_number(name)
    low = (name or "").lower()
    if n is None and numbered_chart and not (section == "expenses" and "insurance" in low):
        return "exclude", False, "no account number - QuickBooks sandbox/demo account"
    if section == "income":
        return "revenue", False, "income"
    if section == "cogs":
        da = n == 5040 or "amortization" in low or "depreciation" in low
        return "cogs", da, "COGS" + (" - D&A added back" if da else "")
    if section == "otherExpenses" or (n is not None and n >= 7000):
        return "below", False, "interest / FX / tax - below EBITDA"
    if n in (6510, 6520) or "depreciation" in low or "amortization" in low:
        return "opex", True, "D&A - in opex and added back"
    if n == 6490:
        return "opex", False, "deal fees - in opex, not added back"
    return "opex", False, "operating expense"


def ebitda_period(pl: dict, months: list[str], cat_map: dict[str, str], da_ids: set[str],
                  plan: dict | None = None) -> dict:
    """EBITDA = Revenue - COGS - Opex + D&A; margin = 100 x EBITDA / Revenue.
    Plan margin = sum of plan EBITDA / sum of plan revenue over the months; vs plan = margin - plan margin."""
    r = {"revenue": 0.0, "cogs": 0.0, "opex": 0.0, "da": 0.0, "below": 0.0,
         "months": len([m for m in months if m in pl])}
    for m in months:
        snap = pl.get(m) or {}
        for sec, aid, name, amt in snap.get("rc_lines", []) + snap.get("lines", []):
            cat = cat_map.get(aid, "exclude")
            if cat == "exclude":
                continue
            r[cat] += amt
            if aid in da_ids and cat in ("cogs", "opex"):
                r["da"] += amt
    r["ebitda"] = r["revenue"] - r["cogs"] - r["opex"] + r["da"]
    r["margin"] = 100 * r["ebitda"] / r["revenue"] if r["revenue"] else None
    r["net_income"] = r["ebitda"] - r["da"] - r["below"]
    pe = pr = 0.0
    have = 0
    for m in months:
        if plan and m in plan:
            pe += plan[m][0]
            pr += plan[m][1]
            have += 1
    r["plan_margin"] = 100 * pe / pr if have == len(months) and pr else None
    r["plan_ebitda"] = pe if have == len(months) else None
    r["vs_plan"] = r["margin"] - r["plan_margin"] if r["margin"] is not None and r["plan_margin"] is not None else None
    return r



# ---------------------------------------------------------------------------
# LTV / CAC, new customers (Oryon spec VC-07) - TTM GRR + CAC page inputs
# ---------------------------------------------------------------------------
def ltv_cac_row(cac_row: dict, grr: float | None, cap_months: float) -> dict:
    """
    c        = 1 - (GRR_TTM / 100) ^ (1/12)                 monthly churn
    lifetime = min(1 / c, cap)                              ltv_capped = True when the cap binds
    LTV      = new-logo ARR / (new logos x 12) x GM_TTM x lifetime
    LTV/CAC  = LTV / CAC
    """
    r = dict(cac_row)
    r["grr"] = grr
    if grr is None or not r.get("new_logos") or not r.get("cac") or r.get("gm") is None:
        r.update({"churn": None, "lifetime": None, "capped": None, "gp_month": None, "ltv": None, "ltv_cac": None})
        return r
    c = 1 - (max(grr, 0.0) / 100) ** (1 / 12)
    raw = 1 / c if c > 0 else float("inf")
    r["churn"] = c
    r["lifetime_raw"] = raw
    r["lifetime"] = min(raw, cap_months)
    r["capped"] = raw >= cap_months
    r["gp_month"] = r["new_logo_arr"] / (r["new_logos"] * 12) * r["gm"]
    r["ltv"] = r["gp_month"] * r["lifetime"]
    r["ltv_cac"] = r["ltv"] / r["cac"]
    return r


# ---------------------------------------------------------------------------
# Recurring revenue % (Oryon spec VC-12) - customer MRR vs GL revenue
# ---------------------------------------------------------------------------
def suggest_recurring_tag(name: str, section: str) -> tuple[bool, str]:
    """Account-tagged basis = subscription revenue accounts 4010 + 4015."""
    if section != "income":
        return False, "not income"
    n = account_number(name)
    if n in (4010, 4015):
        return True, "subscription revenue account"
    if n is None and "subscription" in (name or "").lower():
        return True, "name contains 'subscription'"
    return False, "not a subscription revenue account"


def recurring_period(mrr: dict, pl: dict, months: list[str], revenue_map: dict[str, str],
                     tag_ids: set[str]) -> dict:
    """Recurring % = 100 x sum over months of customer MRR (USD at each month's rate) / GL revenue.
    Account-tagged % = 100 x revenue on the tagged accounts / GL revenue."""
    r = {"sub": 0.0, "ret": 0.0, "revenue": 0.0, "tagged": 0.0, "customers": 0}
    for m in months:
        for v in (mrr.get(m) or {}).values():
            r["sub"] += v["subscription"]
            r["ret"] += v["retainer"]
        for sec, aid, name, amt in (pl.get(m) or {}).get("rc_lines", []):
            if sec == "income" and revenue_map.get(aid) != "Exclude":
                r["revenue"] += amt
                if aid in tag_ids:
                    r["tagged"] += amt
    r["mrr"] = r["sub"] + r["ret"]
    pct = lambda a: 100 * a / r["revenue"] if r["revenue"] else None
    r["pct"], r["sub_pct"], r["ret_pct"], r["tagged_pct"] = pct(r["mrr"]), pct(r["sub"]), pct(r["ret"]), pct(r["tagged"])
    r["gap"] = r["pct"] - r["tagged_pct"] if r["pct"] is not None else None
    return r


# ---------------------------------------------------------------------------
# Revenue growth (Oryon spec VC-13) - GL revenue vs the same months a year earlier
# ---------------------------------------------------------------------------
def growth_period(mrr: dict, pl: dict, months: list[str], revenue_map: dict[str, str], plan: dict | None = None) -> dict:
    """
    Growth(W)          = 100 x (Revenue(W) / Revenue(W - 1y) - 1)
    Recurring YoY      = same on summed customer MRR
    Non-recurring YoY  = same on revenue - MRR
    Revenue added      = Revenue(W) - Revenue(W - 1y)
    Vs plan            = 100 x (Revenue(W) / plan total revenue(W) - 1)
    """
    prior = [add_months(m, -12) for m in months]
    cur = recurring_period(mrr, pl, months, revenue_map, set())
    old = recurring_period(mrr, pl, prior, revenue_map, set())
    g = lambda a, b: 100 * (a / b - 1) if b else None
    r = {"revenue": cur["revenue"], "prev_revenue": old["revenue"], "mrr": cur["mrr"], "prev_mrr": old["mrr"],
         "nonrec": cur["revenue"] - cur["mrr"], "prev_nonrec": old["revenue"] - old["mrr"], "prior": prior}
    r["growth"] = g(r["revenue"], r["prev_revenue"])
    r["rec_growth"] = g(r["mrr"], r["prev_mrr"])
    r["nonrec_growth"] = g(r["nonrec"], r["prev_nonrec"]) if r["prev_nonrec"] > 0 else None
    r["added"] = r["revenue"] - r["prev_revenue"]
    have = [m for m in months if plan and m in plan]
    r["plan_revenue"] = sum(plan[m][1] for m in have) if plan and len(have) == len(months) else None
    r["vs_plan"] = g(r["revenue"], r["plan_revenue"]) if r["plan_revenue"] else None
    return r


def ltv_base_fields(row: dict, arr: float, customers: int) -> dict:
    """VC-14 LTV / CAC, whole base: as VC-07 with the average MRR of all active customers at e
    LTV_base = ARR(e) / (customers(e) x 12) x GM_TTM x min(1/c, cap);  LTV/CAC = LTV_base / CAC"""
    row["arr"], row["customers"] = arr, customers
    if not customers or row.get("lifetime") is None or row.get("gm") is None or not row.get("cac"):
        row.update({"base_avg_mrr": None, "base_gp_month": None, "base_ltv": None, "base_ltv_cac": None})
        return row
    row["base_avg_mrr"] = arr / (customers * 12)
    row["base_gp_month"] = row["base_avg_mrr"] * row["gm"]
    row["base_ltv"] = row["base_gp_month"] * row["lifetime"]
    row["base_ltv_cac"] = row["base_ltv"] / row["cac"]
    return row



# ---------------------------------------------------------------------------
# Cash position and runway (Oryon spec CB-05) - balancesheetmonthlysnapshots
# ---------------------------------------------------------------------------
_RESTRICTED_WORDS = ("restricted", "collateral", "escrow", "letter of credit", "pledged")
_DEMO_BANK_NAMES = {"checking", "savings"}   # QuickBooks sandbox sample accounts


CASH_CATEGORIES = {"unrestricted": "Unrestricted cash", "restricted": "Restricted cash (not in runway)",
                   "exclude": "Exclude (not cash)"}


def suggest_cash_category(name: str, section: str | None, has_named_banks: bool) -> tuple[str, str]:
    """-> (category, reason). Spec CB-05: unrestricted = 1010 + 1015 + 1020; 1030 restricted is excluded."""
    low = (name or "").lower()
    if section == "BankAccounts" and (any(w in low for w in _RESTRICTED_WORDS) or account_number(name) == 1030):
        return "restricted", "restricted / collateral cash (1030) - not counted in cash or runway"
    ok, reason = suggest_cash_account(name, section, has_named_banks)
    return ("unrestricted" if ok else "exclude"), reason


def suggest_cash_account(name: str, section: str | None, has_named_banks: bool) -> tuple[bool, str]:
    """Unrestricted cash = bank accounts that aren't restricted / collateral (spec CB-05: 1010 + 1015 + 1020,
    1030 restricted excluded). QuickBooks sandbox sample accounts 'Checking' / 'Savings' are left out."""
    low = (name or "").lower()
    n = account_number(name)
    if section != "BankAccounts":
        return False, "not a bank account"
    if any(w in low for w in _RESTRICTED_WORDS) or n == 1030:
        return False, "restricted cash - excluded (spec CB-05)"
    if has_named_banks and low.strip() in _DEMO_BANK_NAMES:
        return False, "QuickBooks sandbox sample account"
    if n is not None and 1010 <= n <= 1029:
        return True, "unrestricted cash (1010-1029)"
    return True, "bank account - unrestricted"


def bs_accounts(snaps: list[dict]) -> list[dict]:
    """Every account found on the monthly Balance Sheet snapshots (id, name, section, latest balance)."""
    acc: dict[str, dict] = {}
    for d in sorted(snaps, key=lambda x: x["month"]):
        for a in d.get("accounts") or []:
            x = acc.setdefault(str(a["id"]), {"id": str(a["id"]), "name": a.get("name") or "", "section": a.get("section")})
            x["name"], x["section"] = a.get("name") or x["name"], a.get("section") or x["section"]
            x["latest"], x["latest_month"] = float(a.get("amount") or 0), d["month"]
    return list(acc.values())


def cash_series(snaps: list[dict], sections: list[str], lookback: int, last_closed: str | None,
                account_ids: set[str] | None = None, restricted_adjust: float = 0.0,
                restricted_ids: set[str] | None = None) -> list[dict]:
    """
    Cash(e)  = sum of the selected Balance Sheet section totals at month end e
    Runway   = Cash(e) / ((Cash(e - n) - Cash(e)) / n)   n = lookback (spec: 3)
               None ("self-funding") when cash did not fall over those n months
    Also: AR (sectionTotals.AR.Total) for the data-quality check (cash + AR when AR < 0).
    """
    by = {}
    for d in snaps:
        st = d.get("sectionTotals") or {}
        accts = d.get("accounts") or []
        bank_total = float((st.get("BankAccounts") or {}).get("Total") or 0)
        if accts and account_ids is not None:
            # per-account mode: sum exactly the chosen unrestricted cash accounts
            cash = sum(float(a.get("amount") or 0) for a in accts if str(a.get("id")) in account_ids)
            restricted = sum(float(a.get("amount") or 0) for a in accts if str(a.get("id")) in (restricted_ids or set()))
            mode = "accounts"
        else:
            # fallback: section total(s) minus a fixed restricted-cash amount
            cash = sum(float((st.get(k) or {}).get("Total") or 0) for k in sections) - (restricted_adjust or 0)
            restricted = restricted_adjust or 0.0
            mode = "sections"
        ar = (st.get("AR") or {}).get("Total")
        by[d["month"]] = {"month": d["month"], "as_of": d.get("asOfDate"), "cash": cash, "mode": mode,
                          "restricted": restricted,
                          "bank_total": bank_total, "other_bank": bank_total - cash,
                          "accounts": accts, "ar": float(ar) if ar is not None else None, "raw": st}
    months = sorted(by)
    rows = []
    for i, m in enumerate(months):
        r = dict(by[m])
        prev = by.get(add_months(m, -1))
        back = by.get(add_months(m, -lookback))
        r["change"] = r["cash"] - prev["cash"] if prev else None
        r["avg_decline"] = (back["cash"] - r["cash"]) / lookback if back else None
        r["self_funding"] = r["avg_decline"] is not None and r["avg_decline"] <= 0
        r["runway"] = r["cash"] / r["avg_decline"] if r["avg_decline"] and r["avg_decline"] > 0 else None
        r["ar_negative"] = r["ar"] is not None and r["ar"] < 0
        r["cash_ex_excess"] = r["cash"] + r["ar"] if r["ar_negative"] else r["cash"]
        r["closed"] = bool(last_closed) and m <= last_closed
        r["stale"] = bool(prev) and r["raw"] == prev["raw"]   # identical to the month before: nothing synced yet
        r.pop("accounts", None)
        rows.append(r)
    return rows



# ---------------------------------------------------------------------------
# FCF conversion (Oryon spec CB-07) - P&L snapshots (via EBITDA settings) + Balance Sheet snapshots
# ---------------------------------------------------------------------------
CAPEX_CATEGORIES = {"capex": "Capex (purchases)", "accum": "Accumulated depreciation / amortization",
                    "exclude": "Exclude (not capex)"}
_CAPEX_SECTIONS = ("FixedAssets", "OtherAssets")


def suggest_capex_category(name: str, section: str | None, numbered_chart: bool) -> tuple[str, str]:
    """-> (category, reason). Spec CB-07: capex = purchases of fixed assets and capitalized software
    (1510 Computer Equipment + 1520 Capitalized Software Development). Accumulated depreciation /
    amortization (1590, 1595, 1795) moves with D&A, not purchases. Other assets (intangibles, deposits)
    and QuickBooks sandbox sample assets (no account number, e.g. Truck) are left out."""
    low = (name or "").lower()
    n = account_number(name)
    if any(w in low for w in ("accumulated", "depreciation", "amortization")):
        return "accum", "accumulated depreciation / amortization - moves with D&A, not purchases"
    if numbered_chart and n is None:
        return "exclude", "no account number - QuickBooks sandbox/demo asset"
    if section == "FixedAssets":
        return "capex", "fixed asset cost - purchases are capex" + (" (1510-1589)" if n and 1500 <= n < 1590 else "")
    return "exclude", "other asset (intangibles, deposits) - not capex by default"


def capex_accounts(snaps: list[dict]) -> list[dict]:
    """Fixed-asset and other-asset accounts on the Balance Sheet snapshots."""
    return [a for a in bs_accounts(snaps) if a["section"] in _CAPEX_SECTIONS]


def suggest_fa_da(name: str) -> bool:
    """Fallback only: P&L D&A charged on fixed assets (5040 software amortization, 6510 depreciation);
    6520 amortization of intangibles belongs to other assets."""
    return "intangible" not in (name or "").lower() and account_number(name) != 6520


WC_CATEGORIES = {"ar": "AR (accounts receivable)", "prepaid": "Prepaid", "inventory": "Inventory",
                 "ap": "AP (accounts payable)", "credit_card": "Credit card", "accrued": "Accrued",
                 "deferred_revenue": "Deferred revenue", "exclude": "Exclude (not working capital)"}
WC_ASSET_CATS = ("ar", "prepaid", "inventory")
WC_LIAB_CATS = ("ap", "credit_card", "accrued", "deferred_revenue")
WC_SECTIONS = ("AR", "OtherCurrentAssets", "AP", "CreditCards", "OtherCurrentLiabilities")


def suggest_wc_category(name: str, section: str | None) -> tuple[str, str]:
    """-> (category, reason). Spec CB-07 working capital: (AR + Prepaid + Inventory) -
    (AP + Cards + Accrued + Deferred revenue). Undeposited funds, sales-tax payables, loans and payroll
    clearing accounts are not in the spec's list."""
    low = (name or "").lower()
    if section == "AR":
        return "ar", "accounts receivable"
    if section == "AP":
        return "ap", "accounts payable"
    if section == "CreditCards":
        return "credit_card", "credit card"
    if section == "OtherCurrentAssets":
        if "prepaid" in low:
            return "prepaid", "prepaid expenses"
        if "inventory" in low:
            return "inventory", "inventory"
        if "receivable" in low and "undeposited" not in low:
            return "ar", "other receivable"
        return "exclude", "other current asset - not in the spec's working capital (e.g. undeposited funds)"
    if section == "OtherCurrentLiabilities":
        if "deferred revenue" in low or "unearned" in low or "deferred income" in low:
            return "deferred_revenue", "deferred revenue"
        if "accrued" in low or "accrual" in low:
            return "accrued", "accrued expenses"
        return "exclude", "sales tax, loans, payroll and other liabilities - not in the spec's working capital"
    return "exclude", "not a current asset / liability"


def fcf_series(pl: dict, snaps: list[dict], cat_map: dict, da_ids: set, last_closed: str | None,
               capex_ids: set | None, capex_sections: list[str], fa_da_ids: set,
               wc_map: dict | None, wc_section_map: dict) -> list[dict]:
    """
    Per month m (flows):
      NI, D&A, EBITDA    from the P&L with the EBITDA settings (VC-10)
      WC(m)              = (AR + Prepaid + Inventory) - (AP + Cards + Accrued + Deferred revenue) at month end
                           per-account (wc_map) when the snapshots have balances, else by section (wc_section_map)
      OCF(m)             = NI + D&A - (WC(m) - WC(m-1))
      Capex(m)           = per-account: sum over capex accounts of (balance(m) - balance(m-1))
                           fallback:    change in capex_sections total + P&L D&A on those assets
      FCF(m)             = OCF - Capex
    TTM rows (spec): OCF_TTM = NI_TTM + D&A_TTM - (WC(e) - WC(e-12));
    FCF conversion % = 100 x (OCF_TTM - Capex_TTM) / EBITDA_TTM.
    Also OCF / FCF % without the AR change (data check for negative receivables).
    """
    bs = {d["month"]: d for d in snaps}
    ok = lambda m: m in bs and (not last_closed or m <= last_closed)
    has_accts = bool(bs) and all(bs[m].get("accounts") for m in bs)
    per_account = capex_ids is not None and has_accts
    wc_accounts = wc_map is not None and has_accts

    def sec(m, keys):
        st = bs[m].get("sectionTotals") or {}
        return sum(float((st.get(k) or {}).get("Total") or 0) for k in keys)

    def acc(m):
        return {str(a.get("id")): float(a.get("amount") or 0) for a in bs[m].get("accounts") or []}

    def wc_parts(m):
        parts = {k: 0.0 for k in WC_CATEGORIES if k != "exclude"}
        if wc_accounts:
            for i, v in acc(m).items():
                c = wc_map.get(i)
                if c in parts:
                    parts[c] += v
        else:
            for k, c in wc_section_map.items():
                if c in parts:
                    parts[c] += sec(m, [k])
        return parts

    def wc_total(parts):
        return sum(parts[c] for c in WC_ASSET_CATS) - sum(parts[c] for c in WC_LIAB_CATS)

    monthly = {}
    for m in sorted(bs):
        p = add_months(m, -1)
        if not ok(m) or p not in bs or m not in pl:
            continue
        if (bs[m].get("sectionTotals") or {}) == (bs[p].get("sectionTotals") or {}):
            continue      # stale: identical to the month before (nothing synced for it yet)
        e = ebitda_period(pl, [m], cat_map, da_ids)
        w1, w0 = wc_parts(m), wc_parts(p)
        dparts = {k: w1[k] - w0[k] for k in w1}
        dwc = wc_total(w1) - wc_total(w0)
        dar = dparts["ar"]
        if per_account:
            a1, a0 = acc(m), acc(p)
            lines = {i: a1.get(i, 0.0) - a0.get(i, 0.0) for i in capex_ids}
            capex = sum(lines.values())
        else:
            lines = {}
            fa_da = sum(amt for _, aid, _, amt in (pl[m].get("rc_lines", []) + pl[m].get("lines", []))
                        if aid in fa_da_ids)
            capex = (sec(m, capex_sections) - sec(p, capex_sections)) + fa_da
        ocf = e["net_income"] + e["da"] - dwc
        monthly[m] = {"month": m, "ni": e["net_income"], "da": e["da"], "ebitda": e["ebitda"],
                      "revenue": e["revenue"], "dwc": dwc, "dar": dar, "ocf": ocf, "capex": capex,
                      "fcf": ocf - capex, "capex_lines": lines, "dwc_parts": dparts, "wc": w1}
    rows = []
    for m in sorted(monthly):
        r = dict(monthly[m])
        win = [add_months(m, -k) for k in range(12)]
        r["window"] = win[::-1]
        r["ttm_ok"] = all(w in monthly for w in win)
        if r["ttm_ok"]:
            t = {k: sum(monthly[w][k] for w in win) for k in ("ni", "da", "ebitda", "revenue", "dwc", "dar", "ocf", "capex", "fcf")}
            r.update({"t_" + k: v for k, v in t.items()})
            r["t_dwc_parts"] = {k: sum(monthly[w]["dwc_parts"][k] for w in win) for k in r["dwc_parts"]}
            r["fcf_pct"] = 100 * t["fcf"] / t["ebitda"] if t["ebitda"] else None
            r["t_ocf_x_ar"] = t["ocf"] + t["dar"]              # without the AR change
            r["fcf_pct_x_ar"] = 100 * (r["t_ocf_x_ar"] - t["capex"]) / t["ebitda"] if t["ebitda"] else None
        r["m_fcf_pct"] = 100 * r["fcf"] / r["ebitda"] if r["ebitda"] else None
        r["mode"] = "accounts" if per_account else "sections"
        r["wc_mode"] = "accounts" if wc_accounts else "sections"
        rows.append(r)
    return rows



# ---------------------------------------------------------------------------
# Cash conversion cycle (Oryon spec CB-10) - quarter-end balances + quarterly P&L
# ---------------------------------------------------------------------------
CCC_CATEGORIES = {"ar": "AR (accounts receivable)", "inventory": "Inventory", "ap": "AP (accounts payable)",
                  "exclude": "Exclude"}
CCC_SECTIONS = ("AR", "OtherCurrentAssets", "AP", "CreditCards", "OtherCurrentLiabilities")


def suggest_ccc_category(name: str, section: str | None) -> tuple[str, str]:
    """-> (category, reason). Spec CB-10: AR = 1100, 1105; Inventory = 1300; AP = 2000."""
    low = (name or "").lower()
    n = account_number(name)
    if section == "AR" or n in (1100, 1105):
        return "ar", "accounts receivable (1100 / 1105)"
    if "inventory" in low or n == 1300:
        return "inventory", "inventory (1300)"
    if section == "AP" or n == 2000:
        return "ap", "accounts payable (2000)"
    return "exclude", "not AR, inventory or AP"


def ccc_series(pl: dict, snaps: list[dict], cat_map: dict, da_ids: set, last_closed: str | None,
               ccc_map: dict | None, section_map: dict, include_da: bool = True) -> list[dict]:
    """
    For each month end e with 3 P&L months ending at e (quarter-end months are the spec's values):
      D   = calendar days in those 3 months (92 for Q3)
      DSO = AR(e) / Revenue_q x D
      DIO = Inventory(e) / COGS_q x D        (None when no inventory account / section is chosen)
      DPO = AP(e) / COGS_q x D
      CCC = DSO + DIO - DPO;   working capital $ = AR + Inventory - AP
    Revenue / COGS use the EBITDA classification; COGS = cogs + cogs D&A unless include_da is False.
    """
    import calendar
    bs = {d["month"]: d for d in snaps}
    has_accts = bool(bs) and all(bs[m].get("accounts") for m in bs)
    per_account = ccc_map is not None and has_accts

    def bal(m):
        out = {"ar": 0.0, "inventory": 0.0, "ap": 0.0}
        if per_account:
            for a in bs[m].get("accounts") or []:
                c = ccc_map.get(str(a.get("id")))
                if c in out:
                    out[c] += float(a.get("amount") or 0)
        else:
            st = bs[m].get("sectionTotals") or {}
            for k, c in section_map.items():
                if c in out:
                    out[c] += float((st.get(k) or {}).get("Total") or 0)
        return out

    has_inv = ("inventory" in ccc_map.values()) if per_account else ("inventory" in section_map.values())
    rows = []
    for e in sorted(bs):
        if last_closed and e > last_closed:
            continue
        p = add_months(e, -1)
        if p in bs and (bs[e].get("sectionTotals") or {}) == (bs[p].get("sectionTotals") or {}):
            continue      # stale: identical to the month before (nothing synced for it yet)
        win = [add_months(e, -2), add_months(e, -1), e]
        if not all(m in pl and pl[m].get("revenue") for m in win):
            continue
        r = ebitda_period(pl, win, cat_map, da_ids)
        cogs_da = 0.0
        for m in win:
            for sec, aid, name, amt in pl[m].get("rc_lines", []):
                if cat_map.get(aid) == "cogs" and aid in da_ids:
                    cogs_da += amt
        cogs = r["cogs"] if include_da else r["cogs"] - cogs_da
        D = sum(calendar.monthrange(int(m[:4]), int(m[5:]))[1] for m in win)
        b = bal(e)
        dso = b["ar"] / r["revenue"] * D if r["revenue"] else None
        dio = b["inventory"] / cogs * D if cogs and has_inv else None
        dpo = b["ap"] / cogs * D if cogs else None
        ccc = (dso or 0) + (dio or 0) - (dpo or 0) if dso is not None and dpo is not None else None
        rows.append({"month": e, "window": win, "days": D, "revenue": r["revenue"], "cogs": cogs,
                     "cogs_total": r["cogs"], "cogs_da": cogs_da, "ar": b["ar"], "inventory": b["inventory"],
                     "ap": b["ap"], "dso": dso, "dio": dio, "dpo": dpo, "ccc": ccc,
                     "wc": b["ar"] + b["inventory"] - b["ap"], "quarter_end": int(e[5:7]) % 3 == 0,
                     "label": f"Q{int(e[5:7]) // 3}-{e[:4]}" if int(e[5:7]) % 3 == 0 else e,
                     "has_inv": has_inv, "mode": "accounts" if per_account else "sections",
                     "ar_negative": b["ar"] < 0})
    return rows



# ---------------------------------------------------------------------------
# Customer concentration (Oryon spec CM-02) - invoices + QuickBooks customers + Salesforce accounts
# ---------------------------------------------------------------------------
def customer_groups(qbo_customers: list[dict], sf_accounts: list[dict], links: dict, group_parent: bool) -> dict:
    """QuickBooks customer id -> {"key", "name", "how"}. Spec step 1: Salesforce account (via the customer link),
    walk ParentId to the top; else QuickBooks ParentRef (walked to the top); else the customer itself."""
    sf = {str(a.get("providerRecordId")): a for a in sf_accounts}
    qb = {str(c.get("providerRecordId")): c for c in qbo_customers}

    def sf_top(a):
        seen = set()
        while a.get("parentRecordId") and str(a["parentRecordId"]) in sf and a["providerRecordId"] not in seen:
            seen.add(a["providerRecordId"])
            a = sf[str(a["parentRecordId"])]
        return a

    def qb_top(c):
        seen = set()
        while c.get("parentRecordId") and str(c["parentRecordId"]) in qb and c["providerRecordId"] not in seen:
            seen.add(c["providerRecordId"])
            c = qb[str(c["parentRecordId"])]
        return c

    out = {}
    for cid in set(qb) | set(links):
        c = qb.get(cid, {})
        name = c.get("displayName") or (links.get(cid) or {}).get("customer_name") or f"Customer {cid}"
        out[cid] = {"key": "qb:" + cid, "name": name, "how": "itself"}
        if not group_parent:
            continue
        acct = (links.get(cid) or {}).get("account")
        if acct:
            top = sf_top(acct)
            out[cid] = {"key": "sf:" + str(top.get("providerRecordId")), "name": top.get("name") or name,
                        "how": "Salesforce parent" if top is not acct else "Salesforce account"}
        elif c.get("parentRecordId") and str(c["parentRecordId"]) in qb:
            top = qb_top(c)
            out[cid] = {"key": "qb:" + str(top.get("providerRecordId")), "name": top.get("displayName") or name,
                        "how": "QuickBooks parent"}
    return out


NO_CLASS = "No class"


def invoice_classes(invoices: list[dict]) -> list[str]:
    """QuickBooks classes found on invoice lines (product lines: Platform, Services, Hardware ...)."""
    found, blank = set(), False
    for inv in invoices:
        for l in inv.get("lines") or []:
            if l.get("className"):
                found.add(l["className"])
            elif l.get("amount"):
                blank = True
    return sorted(found) + ([NO_CLASS] if blank else [])


def concentration_series(invoices: list[dict], mapping: dict, settings: dict, groups: dict,
                         top_n: int = 10, line: str | None = None) -> list[dict]:
    """
    Recognized revenue per group over the 12 months ending at e (spec CM-02 step 2):
      annual subscription lines (mapping subscription_yearly) spread 1/12 per month from the service start
      (invoice month, or the next month when dated on/after the early-invoice day); all other lines in their month.
      USD = amount x CAD rate for customers billed in a CAD country.
    Top-N share = 100 x sum of the N largest groups / total; largest = 100 x top group / total.
    Invoiced basis: invoice totals by invoice date over the same 12 months (whole company only).
    line: a QuickBooks class on the invoice lines (Platform / Services / Hardware, or "No class") to rank on
          that class's revenue only.
    """
    early_day = int(settings.get("early_invoice_day") or 16)
    cad = {c.upper() for c in settings.get("cad_countries") or []}
    rates = settings.get("fx_cad_usd") or {}
    rec = defaultdict(lambda: defaultdict(float))
    billed = defaultdict(lambda: defaultdict(float))
    first = None
    for inv in invoices:
        cust = str(inv.get("customerRecordId") or "")
        date = to_date_str(inv.get("txnDate"))
        if not cust or len(date) < 10:
            continue
        m = date[:7]
        first = m if first is None or m < first else first
        fx = fx_for(m, rates) if ((inv.get("billingAddress") or {}).get("country") or "").upper() in cad else 1.0
        g = (groups.get(cust) or {"key": "qb:" + cust})["key"]
        if line is None:
            total = inv.get("totalAmount")
            if total is None:
                total = sum(float(l.get("amount") or 0) for l in inv.get("lines") or [])
            billed[m][g] += float(total or 0) * fx
        for l in inv.get("lines") or []:
            item = str(l.get("itemId") or "")
            amt = float(l.get("amount") or 0) * fx
            if not amt or (line and (l.get("className") or NO_CLASS) != line):
                continue
            if mapping.get(item) == "subscription_yearly":
                start = add_months(m, 1) if int(date[8:10]) >= early_day else m
                for k in range(12):
                    rec[add_months(start, k)][g] += amt / 12
            else:
                rec[m][g] += amt
    if not first:
        return []
    last = max(billed or rec)
    names = {}
    for cid, x in groups.items():
        names.setdefault(x["key"], x["name"])
    rows = []
    for e in month_range(add_months(first, 11), last):
        win = [add_months(e, -k) for k in range(12)]
        tot = defaultdict(float)
        inv_tot = defaultdict(float)
        for m in win:
            for g, v in rec[m].items():
                tot[g] += v
            for g, v in billed[m].items():
                inv_tot[g] += v
        T = sum(tot.values())
        if T <= 0:
            continue
        ranked = sorted(((v, g) for g, v in tot.items() if v > 0), reverse=True)
        bt = sorted((v for v in inv_tot.values() if v > 0), reverse=True)
        BT = sum(inv_tot.values())
        rows.append({"month": e, "window": win[::-1], "total": T, "groups": len(ranked), "top_n": top_n,
                     "top": sum(v for v, _ in ranked[:top_n]), "share": 100 * sum(v for v, _ in ranked[:top_n]) / T,
                     "largest": 100 * ranked[0][0] / T if ranked else None,
                     "largest_name": names.get(ranked[0][1], "Customer " + ranked[0][1].split(":", 1)[-1]) if ranked else None,
                     "inv_share": 100 * sum(bt[:top_n]) / BT if BT and line is None else None,
                     "ranking": [{"key": g, "name": names.get(g, "Customer " + g.split(":", 1)[-1]), "revenue": v, "share": 100 * v / T}
                                 for v, g in ranked[:max(top_n, 25)]]})
    return rows



# ---------------------------------------------------------------------------
# Win rate vs tracked competitor (Oryon spec CM-03) - CRM deals
# ---------------------------------------------------------------------------
STD_COMPETITOR = "@competitor"      # Deal.competitor (Salesforce field mode)
STD_COMPETITORS = "@competitors"    # Deal.competitors[] (Salesforce OpportunityCompetitor mode)


def deal_field(deal: dict, field: str | None):
    """Value of a competitor / loss-reason field on a deal: a customFields label or one of the standard fields."""
    if not field:
        return None
    if field == STD_COMPETITOR:
        return deal.get("competitor") or None
    if field == STD_COMPETITORS:
        return [c for c in deal.get("competitors") or [] if c] or None
    want = field.strip().lower()
    for f in deal.get("customFields") or []:
        if (f.get("label") or "").strip().lower() == want:
            v = f.get("value")
            return None if v in (None, "") else v
    return None


def suggest_competitor_field(labels: list[str], has_std: bool, has_multi: bool) -> str | None:
    for l in labels:
        if "competitor" in l.lower():
            return l
    return STD_COMPETITOR if has_std else (STD_COMPETITORS if has_multi else None)


def suggest_loss_reason_field(labels: list[str]) -> str | None:
    for l in labels:
        low = l.lower()
        if "loss" in low and "reason" in low or low in ("reason lost", "closed lost reason"):
            return l
    return None


def suggest_new_business_types(types: list[str]) -> list[str]:
    return [t for t in types if t and t.replace(" ", "").replace("_", "").lower() in ("newbusiness", "new", "newlogo")]


def deal_outcome(deal: dict, won_keys: set, closed_keys: set) -> str | None:
    """'won' / 'lost' / None (open). Pipeline stage definitions (isWon / isClosed) when synced, else the stage name."""
    stage = deal.get("dealstage") or ""
    key = f"{deal.get('pipeline')}::{stage}"
    if closed_keys:
        if key not in closed_keys:
            return None
        return "won" if key in won_keys else "lost"
    low = stage.replace(" ", "").lower()
    if low in ("closedwon", "won"):
        return "won"
    if low in ("closedlost", "lost"):
        return "lost"
    return None


def win_rate_series(deals: list[dict], comp_field: str | None, loss_field: str | None, exclude_reasons: list[str],
                    nb_types: set, won_keys: set, closed_keys: set, window: int = 6,
                    segment_of=None, segment: str | None = None) -> tuple[list[dict], list[str]]:
    """
    For each month end e, deals = New Business, closed (won or lost), CloseDate in the window months ending at e:
      decided(c) = deals naming competitor c, minus losses whose loss reason is in exclude_reasons
      win rate(c) = 100 x won / decided   (None when nothing decided)
      logged     = 100 x deals with any competitor / all closed New Business deals (before the loss-reason drop)
    -> (rows, competitors sorted by number of deals)
    """
    excl = {r.strip().lower() for r in exclude_reasons if r.strip()}
    closed = []
    for d in deals:
        if (d.get("type") or "") not in nb_types:
            continue
        out = deal_outcome(d, won_keys, closed_keys)
        if not out:
            continue
        m = to_date_str(d.get("closedate"))[:7]
        if len(m) < 7:
            continue
        if segment and (segment_of(d) if segment_of else None) != segment:
            continue
        comp = deal_field(d, comp_field)
        comps = comp if isinstance(comp, list) else ([str(comp)] if comp else [])
        reason = deal_field(d, loss_field) if loss_field else None
        no_decision = out == "lost" and reason is not None and str(reason).strip().lower() in excl
        closed.append({"m": m, "won": out == "won", "comps": comps, "no_decision": no_decision,
                       "name": d.get("dealname"), "account": d.get("accountName"), "reason": reason})
    if not closed:
        return [], []
    count = defaultdict(int)
    for x in closed:
        for c in x["comps"]:
            count[c] += 1
    competitors = sorted(count, key=lambda c: (-count[c], c))
    months = sorted({x["m"] for x in closed})
    rows = []
    for e in month_range(add_months(months[0], window - 1), months[-1]):
        win = {add_months(e, -k) for k in range(window)}
        w = [x for x in closed if x["m"] in win]
        if not w:
            continue
        r = {"month": e, "window": [add_months(e, -(window - 1)), e], "closed": len(w),
             "logged_n": sum(1 for x in w if x["comps"]), "comp": {}}
        r["logged"] = 100 * r["logged_n"] / len(w)
        for c in competitors:
            cx = [x for x in w if c in x["comps"]]
            dec = [x for x in cx if not x["no_decision"]]
            won = sum(1 for x in dec if x["won"])
            r["comp"][c] = {"deals": len(cx), "decided": len(dec), "won": won, "no_decision": len(cx) - len(dec),
                            "rate": 100 * won / len(dec) if dec else None}
        rows.append(r)
    return rows, competitors



# ---------------------------------------------------------------------------
# Funnel conversion (Oryon spec CM-06) - CRM contacts' lifecycle-stage dates + won deals
# ---------------------------------------------------------------------------
FUNNEL_STEPS = {"m2s": "MQL to SQL", "l2m": "Lead to MQL", "s2w": "SQL to won", "s2o": "SQL to opportunity",
                "o2w": "Opportunity to won"}
_NON_MARKETING_SOURCES = ("OFFLINE",)


def suggest_marketing_sources(sources: list[str]) -> list[str]:
    """HubSpot original source: everything except OFFLINE (imports, sales-entered, integrations) is marketing."""
    return [x for x in sources if x and x.upper() not in _NON_MARKETING_SOURCES]


def funnel_contacts(contacts: list[dict], lead_stage: str, mql_stage: str, sql_stage: str, won_ids: set,
                    opp_stage: str = "opportunity") -> list[dict]:
    """Slim contact rows: created / MQL / SQL months from lifecycleStageHistory (stage dates, never the current stage)."""
    out = []
    for c in contacts:
        hist = [h for h in c.get("lifecycleStageHistory") or [] if h.get("value") and h.get("timestamp")]
        dates = {}
        for h in hist:
            t = to_date_str(h["timestamp"])
            if h["value"] not in dates or t < dates[h["value"]]:
                dates[h["value"]] = t
        created = to_date_str(c.get("leadCreatedAt")) or dates.get(lead_stage) or (min(dates.values()) if dates else "")
        out.append({"id": str(c.get("providerRecordId")), "email": (c.get("email") or "").strip().lower(),
                    "src": c.get("analyticsSource"), "created": created[:10], "mql": (dates.get(mql_stage) or "")[:10],
                    "sql": (dates.get(sql_stage) or "")[:10], "opp": (dates.get(opp_stage) or "")[:10],
                    "won": str(c.get("providerRecordId")) in won_ids})
    return out


def funnel_series(rows: list[dict], marketing: set, dedupe: bool, cutoff: str, mature_days: list[int],
                  start: str, end: str, sql_via_mql: bool = True) -> list[dict]:
    """
    Per cohort month m:
      MQL to SQL (headline) = contacts with an MQL date in m that have an SQL date
      Lead to MQL           = marketing-sourced (non-duplicate) contacts created in m that have an MQL date
      SQL cohort            = contacts with an SQL date in m that came through the funnel (also have an MQL date;
                              matches the Oryon report exactly) - or, with sql_via_mql off, marketing-sourced ones
      SQL to won / to opportunity = SQL cohort on a won deal / with an opportunity date
      Opportunity to won    = of those that reached opportunity, on a won deal
    Immature when the month ended fewer than mature_days days before the cutoff.
    """
    mature_days = (list(mature_days) + [60, 90, 180, 60, 180][len(mature_days):])[:5]
    import datetime as _dt
    seen, leads = set(), []
    for r in sorted(rows, key=lambda r: r["created"] or "9999"):
        if not r["created"] or r["src"] not in marketing:
            continue
        if dedupe and r["email"]:
            if r["email"] in seen:
                continue
            seen.add(r["email"])
        leads.append(r)
    by = defaultdict(lambda: {"mql": 0, "m2s": 0, "lead": 0, "l2m": 0, "sql": 0, "s2w": 0, "s2o": 0, "opp": 0, "o2w": 0})
    for r in rows:
        if r["mql"]:
            b = by[r["mql"][:7]]
            b["mql"] += 1
            b["m2s"] += bool(r["sql"])
        if r["sql"] and (bool(r["mql"]) if sql_via_mql else r["src"] in marketing):
            b = by[r["sql"][:7]]
            b["sql"] += 1
            b["s2w"] += bool(r["won"])
            if r.get("opp"):
                b["s2o"] += 1
                b["opp"] += 1
                b["o2w"] += bool(r["won"])
    for r in leads:
        b = by[r["created"][:7]]
        b["lead"] += 1
        b["l2m"] += bool(r["mql"])
    cut = _dt.date.fromisoformat(cutoff)
    out = []
    for m in month_range(start, end):
        y, mo = int(m[:4]), int(m[5:])
        month_end = _dt.date(y + (mo == 12), mo % 12 + 1, 1) - _dt.timedelta(days=1)
        age = (cut - month_end).days
        out.append({"month": m, **by[m], "age": age,
                    "immature": {"m2s": age < mature_days[0], "l2m": age < mature_days[1], "s2w": age < mature_days[2],
                             "s2o": age < mature_days[3], "o2w": age < mature_days[4]}})
    return out


def funnel_rate(rows: list[dict]) -> dict:
    """Pool cohorts: sum converted / sum cohort for each step."""
    t = {k: sum(r[k] for r in rows) for k in ("mql", "m2s", "lead", "l2m", "sql", "s2w", "s2o", "opp", "o2w")}
    t["m2s_pct"] = 100 * t["m2s"] / t["mql"] if t["mql"] else None
    t["l2m_pct"] = 100 * t["l2m"] / t["lead"] if t["lead"] else None
    t["s2w_pct"] = 100 * t["s2w"] / t["sql"] if t["sql"] else None
    t["s2o_pct"] = 100 * t["s2o"] / t["sql"] if t["sql"] else None
    t["o2w_pct"] = 100 * t["o2w"] / t["opp"] if t["opp"] else None
    t["immature"] = {k: any(r["immature"][k] for r in rows) for k in FUNNEL_STEPS}
    return t



# ---------------------------------------------------------------------------
# Lead volume vs plan (Oryon spec CM-08) - MQL first-entry dates vs the Budget sheet MQL target
# ---------------------------------------------------------------------------
def quarter_key(month: str) -> str:
    return f"{month[:4]}-Q{(int(month[5:7]) - 1) // 3 + 1}"


def mql_vs_plan(mql_months: list[str], plan_quarters: dict, months: list[str], grain: str, view: str) -> list[dict]:
    """
    MQLs(W) = contacts whose FIRST MQL date falls in W (recycled MQLs count once)
    plan(W) = sum of the quarterly Budget targets in W; a month carries a third of its quarter's target
    MQLs vs plan = 100 x (MQLs / plan - 1)
    grain month | quarter (quarter-end months); view period | ttm (12 months)
    """
    count = defaultdict(int)
    for m in mql_months:
        count[m[:7]] += 1
    month_plan = {m: (plan_quarters.get(quarter_key(m)) / 3 if plan_quarters.get(quarter_key(m)) is not None else None)
                  for m in months}
    rows = []
    for m in months:
        if grain == "quarter" and int(m[5:7]) % 3:
            continue
        k = 12 if view == "ttm" else (3 if grain == "quarter" else 1)
        win = [add_months(m, -i) for i in range(k)][::-1]
        if any(w not in month_plan for w in win):
            continue
        plans = [month_plan[w] for w in win]
        mqls = sum(count[w] for w in win)
        plan = sum(plans) if all(p is not None for p in plans) else None
        rows.append({"month": m, "window": [win[0], win[-1]], "mqls": mqls, "plan": plan,
                     "diff": mqls - plan if plan is not None else None,
                     "pct": 100 * (mqls / plan - 1) if plan else None,
                     "label": f"Q{int(m[5:7]) // 3}-{m[:4]}" if grain == "quarter" else m,
                     "months": [{"month": w, "mqls": count[w], "plan": month_plan[w]} for w in win]})
    return rows



# ---------------------------------------------------------------------------
# Marketing ROI by channel (Oryon spec CM-07) - new-business pipeline created / marketing spend
# ---------------------------------------------------------------------------
_ROI_SOURCE_WORDS = ("paid", "organic", "review", "webinar", "web", "trade show", "event", "social", "content",
                     "seo", "ppc", "advert", "email", "download", "search", "conference", "ad ")
_ROI_NOT_MARKETING = ("outbound", "partner", "referral", "sdr", "prospect", "existing", "customer")


def suggest_roi_sources(sources: list[str]) -> list[str]:
    """Every lead source that isn't sales / partner / customer-sourced (Oryon counts Email and Social too)."""
    out = []
    for s in sources:
        low = (s or "").lower()
        if not low or any(w in low for w in _ROI_NOT_MARKETING):
            continue
        if s in ROI_DEFAULT_SOURCES or any(w in low for w in _ROI_SOURCE_WORDS):
            out.append(s)
    return out


def _acct_no(name: str) -> str:
    m = _re.match(r"\s*(\d{3,6})\b", name or "")
    return m.group(1) if m else ""


def suggest_roi_accounts(accounts: list[tuple[str, str]]) -> tuple[list[str], list[str]]:
    """(blended, programs) account ids from P&L expense accounts [(accountId, name)]."""
    blended, programs = [], []
    numbered = any(_acct_no(n)[:2] == "61" and len(_acct_no(n)) == 4 for _, n in accounts)
    for aid, name in accounts:
        low, no = (name or "").lower(), _acct_no(name)
        if numbered:   # a numbered chart of accounts: the 61xx marketing block only
            mk = no[:2] == "61" and len(no) == 4
        else:
            mk = any(w in low for w in ("marketing", "advertis", "sponsorship", "content & creative", "demand gen"))
        if mk and "sales" not in low:
            blended.append(aid)
            # programs = non-people marketing spend (everything but salaries, payroll taxes, benefits, commissions)
            if not any(w in low for w in ("salar", "payroll", "wage", "benefit", "bonus", "commission", "headcount")):
                programs.append(aid)
    return blended, programs


def roi_account_match(aid: str, name: str, keys: list[str]) -> bool:
    """A GL channel account key is an accountId, the full account name, or the account number (e.g. 6130)."""
    for k in keys or []:
        k = str(k).strip()
        if k and (k == aid or k == name or k == _acct_no(name)):
            return True
    return False


def roi_deal_rows(deals: list[dict], value_field: str, nb_types: set, sources: set) -> list[dict]:
    """New-business deals with a marketing lead source -> {month, value, source, campaign, name, stage}."""
    rows = []
    for d in deals:
        if d.get("type") not in nb_types:
            continue
        src = d.get("leadSource") or ""
        if src not in sources:
            continue
        created = to_date_str(d.get("dealCreatedAt") or d.get("createdDate"))
        if not created:
            continue
        v = d.get(value_field)
        if v is None and value_field != "amount":
            v = d.get("amount")
        rows.append({"month": created[:7], "date": created, "value": float(v or 0), "source": src,
                     "campaign": d.get("campaignName") or "", "name": d.get("dealname") or "",
                     "stage": d.get("dealstage") or "", "account": d.get("accountName") or "",
                     "has_value_field": d.get(value_field) is not None})
    return rows


def roi_channel_of(row: dict, channel: dict) -> bool:
    return row["source"] in (channel.get("sources") or [])


def roi_series(rows: list[dict], gl: dict, blended_ids: set, programs_ids: set, channels: list[dict],
               months: list[str], grain: str, view: str) -> list[dict]:
    """
    pipeline(W)      = value of new-business deals CREATED in W with a marketing lead source
    blended ROI      = pipeline / total marketing spend (blended accounts)
    programs ROI     = pipeline / program spend (programs accounts)
    channel ROI      = pipeline from the channel's lead sources / spend on the channel's P&L accounts
    gl = {month: [(accountId, name, amount)]}; channel spend = the channel's P&L accounts
    grain month | quarter (quarter-end months); view period | ttm
    """
    by_m = defaultdict(list)
    for r in rows:
        by_m[r["month"]].append(r)

    def gl_sum(m, pred):
        return sum(a for (aid, name, a) in gl.get(m, []) if pred(aid, name)) if m in gl else None

    out = []
    for m in months:
        if grain == "quarter" and int(m[5:7]) % 3:
            continue
        k = 12 if view == "ttm" else (3 if grain == "quarter" else 1)
        win = [add_months(m, -i) for i in range(k)][::-1]
        if any(w not in months for w in win):
            continue
        deals = [r for w in win for r in by_m[w]]
        pipe = sum(r["value"] for r in deals)
        have_gl = all(w in gl for w in win)
        bl = sum(gl_sum(w, lambda a, n: a in blended_ids) or 0 for w in win) if have_gl else None
        pr = sum(gl_sum(w, lambda a, n: a in programs_ids) or 0 for w in win) if have_gl else None
        chans = []
        for c in channels:
            cd = [r for r in deals if roi_channel_of(r, c)]
            cp = sum(r["value"] for r in cd)
            keys = c.get("gl_accounts") or []
            sp = sum(gl_sum(w, lambda a, n: roi_account_match(a, n, keys)) or 0 for w in win) if have_gl and keys else None
            chans.append({"name": c["name"], "pipeline": cp, "deals": len(cd), "spend": sp,
                          "roi": cp / sp if sp else None})
        out.append({"month": m, "window": [win[0], win[-1]], "pipeline": pipe, "deals": len(deals),
                    "blended_spend": bl, "programs_spend": pr,
                    "blended": pipe / bl if bl else None, "programs": pipe / pr if pr else None,
                    "channels": chans,
                    "label": f"Q{int(m[5:7]) // 3}-{m[:4]}" if grain == "quarter" else m})
    return out



# ---------------------------------------------------------------------------
# Marketing-sourced pipeline (Oryon spec CM-05) - share of new-business ARR created from marketing lead sources
# ---------------------------------------------------------------------------
def _acct_base(name: str) -> str:
    n = _re.sub(r"[^a-z0-9 ]", " ", str(name or "").lower().replace("&", " and "))
    return " ".join(n.split())


def duplicate_accounts(deals: list[dict]) -> dict[str, str]:
    """{duplicate accountId: original account name}. A duplicate's name is another account's full name plus extra
    words, e.g. 'Stonebridge HVAC Group (Denver branch)' / 'Freeman Appliance Repair Company Inc' /
    'Northstar Building Services Holdings'. Names that only differ in the suffix (Co. vs Inc.) are different companies."""
    names = {}
    for d in deals:
        if d.get("accountId") and d.get("accountName"):
            names[str(d["accountId"])] = d["accountName"]
    base = {a: _acct_base(n) for a, n in names.items()}
    by_base = {}
    for a, b in base.items():
        by_base.setdefault(b, a)
    out = {}
    for a, b in base.items():
        words = b.split()
        for k in range(len(words) - 1, 0, -1):
            pre = " ".join(words[:k])
            if len(pre) >= 8 and pre in by_base and by_base[pre] != a:
                out[a] = names[by_base[pre]]
                break
    return out


def msp_rows(deals: list[dict], value_field: str, nb_types: set, mk_sources: set, dup: set,
             outcome, true_new_only: bool) -> tuple[list[dict], list[dict]]:
    """-> (created rows, won new-logo rows). outcome(deal) -> 'won' / 'lost' / None."""
    first_won = {}
    for d in deals:
        if outcome(d) == "won":
            c = to_date_str(d.get("closedate"))
            a = str(d.get("accountId") or "")
            if c and a and (a not in first_won or c < first_won[a]):
                first_won[a] = c
    created, won = [], []
    for d in deals:
        if d.get("type") not in nb_types:
            continue
        a = str(d.get("accountId") or "")
        v = d.get(value_field)
        if v is None and value_field != "amount":
            v = d.get("amount")
        row = {"value": float(v or 0), "source": d.get("leadSource") or "", "mk": (d.get("leadSource") or "") in mk_sources,
               "name": d.get("dealname") or "", "account": d.get("accountName") or "", "stage": d.get("dealstage") or "",
               "dup": a in dup, "has_value_field": d.get(value_field) is not None}
        cr = to_date_str(d.get("dealCreatedAt") or d.get("createdDate"))
        if cr:
            created.append({**row, "date": cr, "month": cr[:7]})
        if outcome(d) == "won":
            c = to_date_str(d.get("closedate"))
            if c:
                repeat = bool(first_won.get(a)) and first_won[a] < c
                won.append({**row, "date": c, "month": c[:7], "repeat": repeat and true_new_only})
    return created, won


def msp_series(created: list[dict], won: list[dict], months: list[str], grain: str, view: str,
               exclude_dups: bool) -> list[dict]:
    """
    marketing-sourced %(W) = 100 x ARR of marketing-sourced deals created in W / ARR of all deals created in W
    new-logo ARR won %(W)  = same split of won new-logo deals with close date in the 12 months ending at W's end
    grain month | quarter (quarter-end months); view period | ttm (ratio of sums)
    """
    keep = lambda r: not (exclude_dups and r["dup"])
    c_by, w_by = defaultdict(list), defaultdict(list)
    for r in created:
        if keep(r):
            c_by[r["month"]].append(r)
    for r in won:
        if keep(r) and not r["repeat"]:
            w_by[r["month"]].append(r)
    out = []
    for m in months:
        if grain == "quarter" and int(m[5:7]) % 3:
            continue
        k = 12 if view == "ttm" else (3 if grain == "quarter" else 1)
        win = [add_months(m, -i) for i in range(k)][::-1]
        if any(w not in months for w in win):
            continue
        cd = [r for w in win for r in c_by[w]]
        mk = sum(r["value"] for r in cd if r["mk"])
        tot = sum(r["value"] for r in cd)
        ttm = [add_months(m, -i) for i in range(12)]
        wd = [r for w in ttm for r in w_by[w]]
        wmk = sum(r["value"] for r in wd if r["mk"])
        wtot = sum(r["value"] for r in wd)
        out.append({"month": m, "window": [win[0], win[-1]], "mk": mk, "total": tot, "n": len(cd),
                    "n_mk": sum(1 for r in cd if r["mk"]), "pct": 100 * mk / tot if tot else None,
                    "won_mk": wmk, "won_total": wtot, "won_n": len(wd), "won_pct": 100 * wmk / wtot if wtot else None,
                    "ttm_window": [ttm[-1], ttm[0]],
                    "label": f"Q{int(m[5:7]) // 3}-{m[:4]}" if grain == "quarter" else m})
    return out
