# Oryon metrics: Python (mrr_app) vs Node parity report

Run 2026-11-25 on the local test tenant `tenant_oryon_parity` (org "Oryon Parity Test",
id 6b1a00000000000000000001): Ridgeline QuickBooks dataset (14,275 invoices, 748 customers,
48 monthly P&L and Balance Sheet snapshots, 2022-10 .. 2026-09) loaded through the backend's own
QuickBooks parsers, plus the HubSpot / Salesforce CRM data copied from the local ABC logistics tenant
(7,539 deals, 54,843 contacts, 2,573 Salesforce accounts). Synthetic "Primary Competitor" / "Loss Reason"
custom fields were added to the Salesforce deals in this test tenant only, so CM-03 is exercised.

A difference counts as a mismatch above 1e-6 absolute and 1e-9 relative. Below that it is
float summation order: Python iterates sets in hash order, which varies between its own runs.

## Summary

| Check | Values | Mismatches |
|---|---|---|
| 1. Every page / view of mrr_app vs Node `oryonPages` (default settings) | 44,994 (42,596 bit-identical, rest within 6.9e-12 relative) | **0** |
| 2. Same, with saved settings (product-mapping overrides, account picks, EBITDA plan, MQL plan, FX, windows, flags) | 41,675 (39,094 bit-identical, rest within 2.3e-11) | **0** |
| 3. oryon-web portfolio API (`/dashboard/metrics/:id` series) vs the Python page values | 385 series points, 21 metrics | **0** |

## 3. Dashboard (what oryon-web shows) vs Python

| Metric | Periods checked | Mismatches | Latest period | Python | Node API |
|---|---|---|---|---|---|
| VC-01 | 24 | 0 | 2026-Q3 | 83.3283 | 83.3283 |
| VC-02 | 24 | 0 | 2026-Q3 | 93.0981 | 93.0981 |
| VC-03 | 1 | 0 | 2026-08 | 21.0752 | 21.0752 |
| VC-04 | 16 | 0 | 2026-Q3 | 15.5188 | 15.5188 |
| VC-06 | 16 | 0 | 2026-Q3 | 20.7283 | 20.7283 |
| VC-07 | 16 | 0 | 2026-Q3 | 3.1984 | 3.1984 |
| VC-09 | 16 | 0 | 2026-Q3 | 11.2194 | 11.2194 |
| VC-10 | 16 | 0 | 2026-Q3 | 26.0134 | 26.0134 |
| VC-12 | 16 | 0 | 2026-Q3 | 89.3671 | 89.3671 |
| VC-13 | 16 | 0 | 2026-Q3 | 16.6949 | 16.6949 |
| VC-14 | 16 | 0 | 2026-Q3 | 3.7811 | 3.7811 |
| CB-05 | 24 | 0 | 2026-Q3 | 17,031,991.6700 | 17,031,991.6700 |
| CB-07 | 24 | 0 | 2026-Q3 | 59.6925 | 59.6925 |
| CB-10 | 16 | 0 | 2026-Q3 | 21.7254 | 21.7254 |
| CM-02 | 24 | 0 | 2026-Q3 | 14.0929 | 14.0929 |
| ER-05 | 24 | 0 | 2026-Q3 | 8.4909 | 8.4909 |
| CM-03 | 24 | 0 | 2026-Q3 | 35.8491 | 35.8491 |
| CM-05 | 16 | 0 | 2026-Q3 | 45.5126 | 45.5126 |
| CM-06 | 16 | 0 | 2026-Q3 | 18.2609 | 18.2609 |
| CM-07 | 16 | 0 | 2026-Q3 | 6.0650 | 6.0650 |
| CM-08 | 24 | 0 | 2026-Q3 | 165.0000 | 165.0000 |

385 dashboard series points checked, mismatches: 0

## 1. Every page and view (default settings)

| Metric | View | Rows | Values compared | Mismatches | Latest (Python = Node) |
|---|---|---|---|---|---|
| mrr | default | 36 | 259 | 0 | total_mrr=2626282.9800 |
| retention | grain=quarter,window=ttm,scope=all | 9 | 170 | 0 | grr=83.3283 |
| retention | grain=quarter,window=ttm,scope=subscription | 9 | 170 | 0 | grr=85.9470 |
| retention | grain=quarter,window=period,scope=all | 13 | 238 | 0 | grr=94.8579 |
| retention | grain=quarter,window=period,scope=subscription | 13 | 238 | 0 | grr=95.7703 |
| retention | grain=month,window=ttm,scope=all | 25 | 442 | 0 | grr=83.3283 |
| retention | grain=month,window=ttm,scope=subscription | 25 | 442 | 0 | grr=85.9470 |
| retention | grain=month,window=period,scope=all | 37 | 646 | 0 | grr=97.4969 |
| retention | grain=month,window=period,scope=subscription | 37 | 646 | 0 | grr=98.2261 |
| new_logos | grain=quarter | 12 | 222 | 0 | - |
| new_logos | grain=month | 37 | 622 | 0 | - |
| cac | default | 26 | 555 | 0 | payback=17.9509 |
| cogs | grain=month,window=period | 48 | 1250 | 0 | pct=15.8738 |
| cogs | grain=month,window=ttm | 37 | 1404 | 0 | pct=15.4576 |
| cogs | grain=quarter,window=period | 16 | 486 | 0 | pct=15.5188 |
| cogs | grain=quarter,window=ttm | 13 | 540 | 0 | pct=15.4576 |
| ga | grain=month,window=period | 48 | 1923 | 0 | pct=11.4434 |
| ga | grain=month,window=ttm | 37 | 1946 | 0 | pct=12.4218 |
| ga | grain=quarter,window=period | 16 | 723 | 0 | pct=11.2194 |
| ga | grain=quarter,window=ttm | 13 | 742 | 0 | pct=12.4218 |
| ebitda | grain=month,window=period | 48 | 750 | 0 | margin=23.8511 |
| ebitda | grain=month,window=ttm | 37 | 1014 | 0 | margin=24.1580 |
| ebitda | grain=quarter,window=period | 16 | 306 | 0 | margin=26.0134 |
| ebitda | grain=quarter,window=ttm | 13 | 390 | 0 | margin=24.1580 |
| ltv | grain=quarter | 9 | 341 | 0 | grr=85.8957 |
| ltv | grain=month | 26 | 868 | 0 | grr=84.8408 |
| recurring | grain=month,window=period | 48 | 750 | 0 | pct=93.5712 |
| recurring | grain=month,window=ttm | 37 | 1014 | 0 | pct=89.8078 |
| recurring | grain=quarter,window=period | 16 | 306 | 0 | pct=89.3671 |
| recurring | grain=quarter,window=ttm | 13 | 390 | 0 | pct=89.8078 |
| growth | grain=month,window=period | 36 | 740 | 0 | growth=9.2897 |
| growth | grain=month,window=ttm | 25 | 1092 | 0 | growth=21.4725 |
| growth | grain=quarter,window=period | 12 | 312 | 0 | growth=16.6949 |
| growth | grain=quarter,window=ttm | 9 | 420 | 0 | growth=21.4725 |
| cash | grain=month | 48 | 1600 | 0 | - |
| cash | grain=quarter | 16 | 576 | 0 | - |
| fcf | view=ttm | 36 | 2248 | 0 | fcf_pct=59.6925 |
| fcf | view=month | 47 | 2688 | 0 | fcf_pct=59.6925 |
| ccc | view=quarter | 16 | 396 | 0 | ccc=21.7254 |
| ccc | view=month | 46 | 1056 | 0 | ccc=21.7254 |
| concentration | default | 36 | 1161 | 0 | share=14.0929 |
| diversification | default | 36 | 2018 | 0 | share=8.4909 |
| win_rate | view=period,grain=month | 37 | 897 | 0 | logged=76.4151 |
| win_rate | view=period,grain=quarter | 12 | 322 | 0 | logged=77.2201 |
| win_rate | view=ttm,grain=month | 37 | 897 | 0 | logged=76.1224 |
| win_rate | view=ttm,grain=quarter | 12 | 322 | 0 | logged=75.2809 |
| funnel | grain=month,view=period | 36 | 874 | 0 | m2s_pct=13.9394 |
| funnel | grain=month,view=ttm | 36 | 874 | 0 | m2s_pct=15.4238 |
| funnel | grain=quarter,view=period | 12 | 322 | 0 | m2s_pct=18.2609 |
| funnel | grain=quarter,view=ttm | 12 | 322 | 0 | m2s_pct=15.4238 |
| mql | grain=month,view=period | 36 | 418 | 0 | pct=-10.9712 |
| mql | grain=month,view=ttm | 36 | 1672 | 0 | pct=-5.0154 |
| mql | grain=quarter,view=period | 12 | 238 | 0 | pct=-17.2662 |
| mql | grain=quarter,view=ttm | 12 | 616 | 0 | pct=-5.0154 |
| roi | grain=quarter,view=period | 12 | 210 | 0 | blended=6.0650 |
| roi | grain=quarter,view=ttm | 12 | 210 | 0 | blended=5.9223 |
| roi | grain=month,view=period | 36 | 570 | 0 | blended=6.2881 |
| roi | grain=month,view=ttm | 36 | 570 | 0 | blended=5.9223 |
| msp | grain=quarter,view=period | 12 | 210 | 0 | pct=45.5126 |
| msp | grain=quarter,view=ttm | 12 | 210 | 0 | pct=46.1668 |
| msp | grain=month,view=period | 36 | 570 | 0 | pct=45.1806 |
| msp | grain=month,view=ttm | 36 | 570 | 0 | pct=46.1668 |
44994 values compared, 42596 bit-identical, mismatches: 0; largest relative float difference among the rest: 6.93e-12
