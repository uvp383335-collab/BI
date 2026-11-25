# Oryon parity check (Python mrr_app vs Node)

The Node Oryon metrics (`src/modules/metrics/oryon`) are a line-by-line port of `mrr_app/`.
These scripts prove both give the same numbers on the same tenant database.

From `backend/`:

```bash
npx tsx src/scripts/oryonParity/seedParityTenant.ts            # (re)build tenant_oryon_parity
MONGO_DB=tenant_oryon_parity python src/scripts/oryonParity/python_dump.py py.json
npx tsx src/scripts/oryonParity/nodeDump.ts node.json
python src/scripts/oryonParity/compare.py py.json node.json report.md          # every page / view
npx tsx src/scripts/oryonParity/dashboardDump.ts dash.json
python src/scripts/oryonParity/dashboardCheck.py py.json dash.json             # the oryon-web dashboard API
```

Point both dumps at another tenant with `MONGO_DB=<tenant db>` (Python) and the org id as the
third argument of `nodeDump.ts` / `dashboardDump.ts`. Requires `pip install flask pymongo`.
Latest results: `PARITY_REPORT.md`.
