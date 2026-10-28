# HubSpot sandbox load (Ridgeline dataset)

Repeatable loader for the Ridgeline synthetic dataset into the HubSpot developer
test account **247726307**, following `docs/Oryon_Sandbox_Data_Loading_Guide.pdf`.
Source files: `../../../ridgeline_dataset/hubspot/`.

## Quick start

Requirements: Python 3.10+, no extra packages. A private app token in
`~/.hubspot/token.txt` (never commit it).

```bash
cd sandbox-data-load/hubspot
cp config.example.json config.json            # edit paths / portal if needed

python -m loader load --config config.json              # all steps, then a full validation report
python -m loader load --config config.json --steps contacts,associations
python -m loader load --config config.json --limit 50   # smoke test: first 50 records per object
python -m loader validate --config config.json          # every record; add --sample 200 for a quick check
python -m loader reset --config config.json             # dry run: shows what would be deleted
python -m loader reset --config config.json --yes       # delete loaded records
python -m loader reset --config config.json --yes --include-users --include-schema   # full wipe
```

Every command first checks that the token belongs to the configured portal and
that it is a `DEVELOPER_TEST` account, and stops otherwise.

## Steps (in order)

| Step | What it does | Safe to re-run because |
| --- | --- | --- |
| `properties` | Custom properties from `property-definitions/` and the three custom objects | Creates only what is missing |
| `owners` | A user per row of `owners.csv` (no welcome email), then maps owner IDs by email | Skips existing emails |
| `pipeline` | The 7 deal stages; removes unused default stages | Matches by stage ID or label |
| `companies`, `contacts`, `deals` | Batch upsert, 100 per call, keyed on `ridgeline_id` | Upsert |
| `associations` | Contact→company (Primary), deal→company (Primary), deal→contact, child→parent company | Re-creating a link is a no-op |
| `lifecycle_changes` | Lifecycle history into the `rl_lifecycle_change` custom object, linked to contacts | Upsert on `rl_change_key` |
| `deal_stage_changes` | Deal stage history from `salesforce/OpportunityHistory.csv` into the `rl_deal_stage_change` custom object, linked to deals. Matched to deals via `salesforceopportunityid`, stages via `deal_pipeline_stages.csv` | Upsert on `rl_stage_change_key` |
| `form_submissions` | Form submissions into the `rl_form_submission` custom object, linked to contacts | Upsert on `rl_submission_key` |
| `goals` | The 3 quarterly MQL goals | Matched on name + start date |
| `campaigns` | Campaigns + budget/spend items. **Off by default** (`campaigns.enabled`), pending the name decision | Matched on `rl_source_campaign_id`; items only added to new campaigns |

Not loaded on purpose: line items/products (optional, pending decision), campaign-contact
touches (open question).

## Known HubSpot deviations (sandbox only)

- Contact and company `createdate` can't be backdated; the original is in `rl_source_createdate`. Deals keep native dates.
- Read-only fields (lifecycle dates, original source, conversions, score) are in `rl_*` properties. The production connector reads the native fields.
- Lifecycle stage is set once to the final stage (forward-only rule); history is in `rl_date_became_*` and the Lifecycle Change object.
- Native `dealstage` history can't be backdated either: deals carry only their final stage, and the dated stage path is in the Deal Stage Change object (`stage`, `dealstage_id`, `entered_at`).
- 4 contacts share an email with an earlier contact; they load without email, the address kept in `rl_duplicate_email`.
- `companies.csv` was re-saved without `hubspot_owner_id`; the original values are in `source-patches/`.
- Auto-association ("create and associate companies with contacts") must be **off** in the portal before loading contacts (UI only).
- HubSpot's deal lifecycle sync moves companies/contacts linked to a Closed Won deal to `customer`. The source keeps 3 such companies at `opportunity`, so the `associations` step puts lifecycle stages back to the source value afterwards (clear, then set).

## Folders

| Folder | Contents |
| --- | --- |
| `loader/` | The loader package (`client`, `config`, `transform`, `load`, `validate`, `reset`, `cli`) |
| `id-maps/` | Source ID → HubSpot ID per object, rewritten after each load. `manifest.json` has portal and type IDs |
| `property-definitions/` | Custom properties and custom object definitions |
| `source-patches/` | Source values missing from the current CSVs |
| `reports/` | Validation reports (`validation_<timestamp>.md/.json`) and the gaps report |
| `scripts/` | One-off scripts from the first load (reference only); `scripts/caax-attempt/` from the old standard account |
