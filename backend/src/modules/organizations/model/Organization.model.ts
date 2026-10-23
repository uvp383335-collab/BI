import { Schema, model, Document, Types } from 'mongoose'

export type OrganizationStatus = 'active' | 'suspended'

export interface OrganizationSettings {
  /**
   * Salesforce competitor-tracking mode (metrics guide gap G-11 / G-24) —
   * Salesforce has no single standard way to record "which competitor was
   * in this deal," so this is a genuine per-org choice between two real
   * setups:
   * - `'field'` — a custom Opportunity field (commonly `Competitor__c`,
   *   named in `salesforceCompetitorField`), one competitor per deal.
   * - `'junction'` — the standard `OpportunityCompetitor` object, which
   *   allows *multiple* competitors per deal.
   * `undefined` means competitor tracking isn't configured for this org;
   * CM-03 reports `computable: false` rather than guessing.
   */
  salesforceCompetitorSource?: 'field' | 'junction'
  /** Only meaningful when `salesforceCompetitorSource === 'field'`. */
  salesforceCompetitorField?: string
  /**
   * Per-org custom Opportunity fields to sync and show in the Opportunity
   * detail view (e.g. Order Number, Current Generator(s), Tracking Number,
   * Delivery/Installation Status) — Salesforce has no standard fields for
   * these, same category of per-org gap as the competitor field above.
   * `apiName` is appended to the Opportunity SOQL SELECT (validated the same
   * way as `salesforceCompetitorField`); `label` is the display name shown
   * in the detail panel.
   */
  salesforceOpportunityExtraFields?: { apiName: string; label: string }[]
  /**
   * CB-07 (Free Cash Flow Conversion) does not infer capital expenditure
   * automatically from the Cash Flow report's InvestingActivities section —
   * different companies book CapEx too inconsistently for a heuristic to be
   * trustworthy (see docs/sherpai-metrics-progress.md gaps G-18/G-19). An
   * org must explicitly pick which QuickBooks accounts (from the Cash Flow
   * or Balance Sheet reports already pulled during sync — see
   * `metrics/service/reportParser.ts`'s `extractLeafAccounts`) represent
   * capital expenditure. Empty/unset means CB-07's CapEx leg — and so the
   * whole metric — reports `computable: false` rather than guessing.
   */
  cb07ExpenditureAccountIds?: string[]
  /**
   * CB-10 (Cash Conversion Cycle) similarly does not assume which Balance
   * Sheet account is "the" A/R, A/P, or Inventory figure — a company may
   * have more than one account under each heading. Each is a single
   * org-picked QuickBooks account id; unset means that leg can't compute
   * (except Inventory, which defaults to a hidden $0 leg when unset, same
   * "legitimately has none" convention already applied when QuickBooks has
   * no inventory data at all).
   */
  cb10AccountsReceivableAccountId?: string
  cb10AccountsPayableAccountId?: string
  cb10InventoryAccountId?: string
  /**
   * G&A % of Revenue does not infer which Expense/Other-Expense accounts
   * count as general & administrative from a keyword guess (back-office
   * spend is booked too inconsistently across companies for that to be
   * trustworthy) — an org must explicitly pick which QuickBooks P&L expense
   * accounts represent G&A, same "never guess" convention as CB-07's
   * CapEx accounts above. Empty/unset means the metric reports
   * `computable: false` rather than guessing.
   */
  gaExpenseAccountIds?: string[]
  /**
   * Customer Acquisition Cost does not infer which P&L expense accounts
   * count as acquisition spend either — same "never guess" convention as
   * `gaExpenseAccountIds` above (and reads from the identical account
   * universe — P&L Expense/Other-Expense leaf accounts). `cacDurationMonths`
   * is the non-overlapping window size (1-12) CAC is computed over — e.g. 2
   * sums spend and new customers over Jan+Feb as one bucket, then Mar+Apr as
   * the next, never a sliding month-over-month average. Both unset/empty
   * means the metric reports `computable: false` rather than guessing a
   * default window.
   */
  cacExpenseAccountIds?: string[]
  cacDurationMonths?: number
  /**
   * CM-07 (Marketing ROI)'s marketing spend — the QuickBooks P&L expense
   * accounts that are marketing (programs, software, media; the guide's
   * "accounts classified as marketing"). Same "never guess" convention and
   * same account universe as `gaExpenseAccountIds`: account names can't tell
   * marketing from sales spend reliably. Empty/unset means CM-07 reports
   * `computable: false`.
   */
  marketingSpendAccountIds?: string[]
  /**
   * Where HubSpot stage history comes from. Off (the default, and how
   * unset reads) uses HubSpot's native fields — `propertiesWithHistory`
   * on `lifecyclestage`/`dealstage` and native `createdate`. On reads the
   * `rl_*` custom objects/properties instead (`rl_lifecycle_change`,
   * `rl_deal_stage_change`, `rl_source_createdate`, ...), for portals whose
   * history was imported from CSV: HubSpot stamps every native history
   * entry with the import date and won't accept a backdated one, so the
   * real dates can only live in those `rl_*` fields.
   */
  hubspotUseImportedHistory?: boolean
  /**
   * CM-04 (Pipeline Coverage) new-business targets — operating-plan data no
   * CRM holds (gap G-14), so an org enters it by hand. Each row is one
   * target for an inclusive month range (`YYYY-MM`); the amount is the
   * total for the whole range and is spread evenly across its months, so
   * one row per quarter, per half or per year all work. Rows never overlap
   * (enforced by the validator). Months with no row leave any quarter
   * containing them `computable: false` rather than guessing a target.
   */
  cm04Targets?: Cm04Target[]
  /**
   * CM-08 (Lead Volume vs. Plan) MQL targets — the operating plan's MQL
   * line, entered the same way as `cm04Targets`: one total MQL count per
   * inclusive month range, spread evenly across its months, ranges never
   * overlapping. A month with no row has no plan, so CM-08's plan
   * comparison and plan-based flags stay off for it.
   */
  cm08MqlTargets?: Cm08MqlTarget[]
}

export interface Cm08MqlTarget {
  fromMonth: string
  toMonth: string
  targetCount: number
}

export interface Cm04Target {
  fromMonth: string
  toMonth: string
  targetAmount: number
}

export interface OrganizationDocument extends Document {
  _id: Types.ObjectId
  name: string
  slug: string
  status: OrganizationStatus
  /** Name of this org's dedicated tenant database (same cluster, isolated database per org). */
  dbName: string
  settings: OrganizationSettings
  createdAt: Date
  updatedAt: Date
}

const organizationSchema = new Schema<OrganizationDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    // Unique per org; assigned once at creation and never changed, so cached
    // tenant connections (keyed by orgId) always resolve to the same database.
    dbName: { type: String, required: true, unique: true },
    settings: {
      salesforceCompetitorSource: { type: String, enum: ['field', 'junction'] },
      salesforceCompetitorField: { type: String },
      salesforceOpportunityExtraFields: {
        type: [new Schema({ apiName: { type: String, required: true }, label: { type: String, required: true } }, { _id: false })],
        default: undefined
      },
      cb07ExpenditureAccountIds: { type: [String], default: undefined },
      cb10AccountsReceivableAccountId: { type: String },
      cb10AccountsPayableAccountId: { type: String },
      cb10InventoryAccountId: { type: String },
      gaExpenseAccountIds: { type: [String], default: undefined },
      cacExpenseAccountIds: { type: [String], default: undefined },
      cacDurationMonths: { type: Number, min: 1, max: 12 },
      marketingSpendAccountIds: { type: [String], default: undefined },
      hubspotUseImportedHistory: { type: Boolean },
      cm04Targets: {
        type: [
          new Schema(
            {
              fromMonth: { type: String, required: true },
              toMonth: { type: String, required: true },
              targetAmount: { type: Number, required: true, min: 0 }
            },
            { _id: false }
          )
        ],
        default: undefined
      },
      cm08MqlTargets: {
        type: [
          new Schema(
            {
              fromMonth: { type: String, required: true },
              toMonth: { type: String, required: true },
              targetCount: { type: Number, required: true, min: 0 }
            },
            { _id: false }
          )
        ],
        default: undefined
      }
    }
  },
  { timestamps: true }
)

export const OrganizationModel = model<OrganizationDocument>('Organization', organizationSchema)
