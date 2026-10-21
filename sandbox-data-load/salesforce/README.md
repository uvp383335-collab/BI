# Salesforce sandbox load (Ridgeline dataset)

Repeatable loader for the Ridgeline synthetic dataset into a Salesforce trial org,
following section 1 of `docs/Oryon_Sandbox_Data_Loading_Guide.pdf`.
Source files: `../../../ridgeline_dataset/salesforce/`.

## Org

Enterprise Edition trial `00DkO0000003fMoUAI` (energy-ruby-1747.my.salesforce.com), 10 GB data
storage, expires 2026-11-20. A Developer Edition org (5 MB) holds only about 2,500 of the ~56,000
records, so it can't be used for the full load. When the trial expires, create a new one and reload:
the loader does the whole setup.

One-time setup by hand in a new org:
1. Setup > User Interface > tick **Enable "Set Audit Fields upon Record Creation" and "Update Records
   with Inactive Owners" User Permissions**. The `schema` step stops if this is off.
2. Log in the CLI: `sf org login web --alias ridgeline-full`, then put the org ID in `config.json`.

## Quick start

Requirements: Python 3.10+ (no extra packages), Node and the sf CLI (`npm install -g @salesforce/cli`).
The access token is read from the CLI's auth store at run time and is never written to disk.

```bash
cd sandbox-data-load/salesforce
cp config.example.json config.json                       # set org_alias / org_id

python -m loader load --config config.json               # all steps, then a full validation report
python -m loader load --config config.json --steps accounts,contacts
python -m loader load --config config.json --limit 50    # smoke test: first 50 records per object
python -m loader validate --config config.json           # every record; --sample 200 for a quick check
python -m loader reset --config config.json              # dry run: shows what would be deleted
python -m loader reset --config config.json --yes        # delete loaded records (schema stays)
```

Every command first checks that the CLI alias points at the configured org and that the org is a
trial, sandbox or Developer Edition, and stops otherwise.

## Steps (in order)

| Step | What it does |
| --- | --- |
| `schema` | Deploys custom fields (`Ridgeline_Id__c` external ID on every loaded object, the dataset's custom fields), the `Ridgeline_User__c` object, picklist values (stages with source probability and forecast category, lead statuses with `Qualified` as converted, sources, types) and the `Ridgeline_Loader` permission set (field access + Set Audit Fields). Assigns it, makes the user a Marketing User, activates the Standard Price Book |
| `users` | `User.csv` (with role names) into `Ridgeline_User__c` |
| `accounts` | Parents before children, so `ParentId` is set on insert |
| `contacts`, `leads` | `CreatedDate` kept. Converted leads go in open and are converted in the last step |
| `campaigns` | Parents first, then the member statuses each campaign uses (Attended, Downloaded, ...) |
| `products` | `Product2`, then standard `PricebookEntry` prices |
| `opportunities` | Stage, Amount, CloseDate, CreatedDate, LastModifiedDate and the custom fields |
| `campaign_members` | Loaded on the lead, before conversion |
| `convert_leads` | `convertLead` into the loaded account, contact and opportunity (Salesforce then adds the contact to the campaign members), then puts the account/contact/opportunity fields back to the source values |

Each step matches on `Ridgeline_Id__c`: new records are inserted with their historical dates,
existing ones updated, so a re-run doesn't duplicate. ID maps go to `id-maps/`, validation reports
to `reports/`.

Not loaded on purpose: `OpportunityLineItem` (Salesforce would overwrite `Amount` with the line-item
sum on 1,714 opportunities; pending decision), and `OpportunityContactRole`, `OpportunityCompetitor`,
`OpportunityHistory`, `OpportunitySplit`, `ForecastingQuota` (not in the guide's list; skipped by
decision). `UserRole` is used only for the role name on `Ridgeline_User__c`.

## Known deviations (sandbox only)

- **Owners:** the trial has 5 licences for 45 source owners, so every record is owned by the loading
  user (as the guide says). The source owner ID is in `Ridgeline_Owner_Id__c`, and `SDR__c` holds a
  source user ID; join both to `Ridgeline_User__c.Ridgeline_Id__c` for names and roles.
- **Campaign and Product2 created date:** Salesforce doesn't allow setting it on these objects; the
  original is in `Ridgeline_Created_Date__c`.
- **Lead conversion date:** `ConvertedDate` is the load date; the original is in
  `Ridgeline_Converted_Date__c`.
- **LastModifiedDate:** kept on insert, but Salesforce stamps it again on any later write (the
  conversion and the restore after it), so converted accounts, contacts and opportunities show the
  load date.
- **Campaign member first responded date:** set by Salesforce from the status; the original is in
  `Ridgeline_First_Responded_Date__c`.
- **Campaign roll-ups** (`NumberOfLeads`, `AmountWonOpportunities`, ...) are calculated by Salesforce
  from the loaded records, not copied from the file.
