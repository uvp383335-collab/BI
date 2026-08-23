/**
 * Single source of truth for the synthetic "ABC Logistics" dataset seeded
 * across HubSpot, Salesforce, and QuickBooks — one fictional fleet-management
 * SaaS company (DriverInsights platform + GPS hardware kits) whose SMB motion
 * runs through HubSpot, enterprise motion through Salesforce, and all billing
 * through QuickBooks. Field choices are driven directly by
 * docs/sherpai-metrics-implementation-guide.md so the 21 MVP metrics have
 * real data to compute against.
 *
 * Money values are USD. Months are indexed 0..13, oldest (0) to newest (13),
 * mapped onto real calendar months ending at the current month.
 */

export const MONTH_COUNT = 14

/** Month index 13 = current month. Returns a JS Date for day `day` of that month. */
export function monthDate(monthIndex: number, day = 5): Date {
  const now = new Date()
  const offsetFromNow = monthIndex - (MONTH_COUNT - 1) // e.g. 13 -> 0 (this month)
  const d = new Date(now.getFullYear(), now.getMonth() + offsetFromNow, day)
  return d
}

export function isoDate(monthIndex: number, day = 5): string {
  return monthDate(monthIndex, day).toISOString().slice(0, 10)
}

export type Trajectory = 'steady' | 'expansion' | 'downgrade' | 'churn' | 'new_logo'
export type CrmSource = 'salesforce' | 'hubspot'

export interface CustomerDef {
  key: string
  name: string
  crmSource: CrmSource
  trajectory: Trajectory
  /** Month index the customer starts being invoiced. */
  startMonth: number
  /** Base monthly recurring revenue in USD before trajectory adjustments. */
  baseMrr: number
  /** For expansion/downgrade: month index the step change happens. */
  stepMonth?: number
  /** For expansion/downgrade: multiplier applied at stepMonth (e.g. 1.4 = +40%). */
  stepMultiplier?: number
  /** For churn: month index revenue drops to 0. */
  churnMonth?: number
  /** Parent customer key, for subsidiary grouping (CM-02 dedup). */
  parentKey?: string
  /** Whether this customer should carry an OpportunityCompetitor / competitor-flavored deal. */
  competitive?: boolean
}

const COMPETITORS = ['FleetPulse Systems', 'RouteIQ', 'CargoSight']

export const CUSTOMERS: CustomerDef[] = [
  // --- steady (enterprise / Salesforce) — includes the 3 "whale" parents ---
  { key: 'union_rail', name: 'Union Rail & Road', crmSource: 'salesforce', trajectory: 'steady', startMonth: 0, baseMrr: 18000, competitive: true },
  { key: 'redline', name: 'Redline Logistics', crmSource: 'salesforce', trajectory: 'steady', startMonth: 0, baseMrr: 15500, competitive: true },
  { key: 'apex', name: 'Apex Fleet Solutions', crmSource: 'salesforce', trajectory: 'expansion', startMonth: 0, baseMrr: 9000, stepMonth: 6, stepMultiplier: 1.35, competitive: true },
  { key: 'pioneer', name: 'Pioneer Trucking LLC', crmSource: 'salesforce', trajectory: 'steady', startMonth: 1, baseMrr: 4200 },
  { key: 'harbor_point', name: 'Harbor Point Carriers', crmSource: 'salesforce', trajectory: 'steady', startMonth: 1, baseMrr: 3800 },
  { key: 'cascade', name: 'Cascade Haulers', crmSource: 'salesforce', trajectory: 'steady', startMonth: 2, baseMrr: 3600 },

  // --- subsidiaries of the 3 whales (CM-02 grouping test) ---
  { key: 'union_rail_mw', name: 'Union Rail & Road - Midwest Division', crmSource: 'salesforce', trajectory: 'steady', startMonth: 2, baseMrr: 5200, parentKey: 'union_rail' },
  { key: 'redline_west', name: 'Redline Logistics - West Coast', crmSource: 'salesforce', trajectory: 'steady', startMonth: 3, baseMrr: 4100, parentKey: 'redline' },
  { key: 'apex_canada', name: 'Apex Fleet Solutions - Canada', crmSource: 'salesforce', trajectory: 'steady', startMonth: 4, baseMrr: 3300, parentKey: 'apex' },

  // --- downgrade (enterprise / Salesforce) ---
  { key: 'ironclad', name: 'Ironclad Shipping', crmSource: 'salesforce', trajectory: 'downgrade', startMonth: 0, baseMrr: 6500, stepMonth: 7, stepMultiplier: 0.65 },
  { key: 'trailhead', name: 'Trailhead Transport', crmSource: 'salesforce', trajectory: 'downgrade', startMonth: 1, baseMrr: 5200, stepMonth: 8, stepMultiplier: 0.7 },
  { key: 'meridian', name: 'Meridian Freight Partners', crmSource: 'salesforce', trajectory: 'downgrade', startMonth: 0, baseMrr: 4800, stepMonth: 9, stepMultiplier: 0.6 },
  { key: 'sunbelt', name: 'Sunbelt Carriers', crmSource: 'hubspot', trajectory: 'downgrade', startMonth: 2, baseMrr: 2900, stepMonth: 8, stepMultiplier: 0.75 },

  // --- churn (2 Salesforce, 2 HubSpot) ---
  { key: 'lonestar', name: 'Lonestar Hauling Co', crmSource: 'salesforce', trajectory: 'churn', startMonth: 0, baseMrr: 5400, churnMonth: 8, competitive: true },
  { key: 'timberline', name: 'Timberline Trucking', crmSource: 'salesforce', trajectory: 'churn', startMonth: 1, baseMrr: 3100, churnMonth: 10 },
  { key: 'delta_route', name: 'Delta Route Systems', crmSource: 'hubspot', trajectory: 'churn', startMonth: 0, baseMrr: 2200, churnMonth: 6 },
  { key: 'anchor_point', name: 'Anchor Point Freight', crmSource: 'hubspot', trajectory: 'churn', startMonth: 2, baseMrr: 1800, churnMonth: 9 },

  // --- remaining steady (SMB / HubSpot) ---
  { key: 'granite_state', name: 'Granite State Transport', crmSource: 'hubspot', trajectory: 'steady', startMonth: 1, baseMrr: 2100 },
  { key: 'bluegrass', name: 'Bluegrass Freightways', crmSource: 'hubspot', trajectory: 'steady', startMonth: 2, baseMrr: 1900 },
  { key: 'coastal_express', name: 'Coastal Express Lines', crmSource: 'hubspot', trajectory: 'steady', startMonth: 0, baseMrr: 2400 },

  // --- remaining expansion (SMB / HubSpot) ---
  { key: 'northgate', name: 'Northgate Distribution', crmSource: 'hubspot', trajectory: 'expansion', startMonth: 1, baseMrr: 1800, stepMonth: 5, stepMultiplier: 1.5 },
  { key: 'silver_arrow', name: 'Silver Arrow Transport', crmSource: 'hubspot', trajectory: 'expansion', startMonth: 2, baseMrr: 1600, stepMonth: 6, stepMultiplier: 1.4 },
  { key: 'vantage', name: 'Vantage Cargo Group', crmSource: 'hubspot', trajectory: 'expansion', startMonth: 0, baseMrr: 2000, stepMonth: 7, stepMultiplier: 1.3 },
  { key: 'prairie_wind', name: 'Prairie Wind Logistics', crmSource: 'hubspot', trajectory: 'expansion', startMonth: 3, baseMrr: 1500, stepMonth: 8, stepMultiplier: 1.45 },

  // --- new logos, staggered starts across the trailing 8 months (VC-03) ---
  { key: 'nimbus', name: 'Nimbus Fleet Tech', crmSource: 'hubspot', trajectory: 'new_logo', startMonth: 6, baseMrr: 1700 },
  { key: 'waypoint', name: 'Waypoint Carriers', crmSource: 'hubspot', trajectory: 'new_logo', startMonth: 7, baseMrr: 1500 },
  { key: 'terralink', name: 'TerraLink Transport', crmSource: 'salesforce', trajectory: 'new_logo', startMonth: 8, baseMrr: 4200 },
  { key: 'bluecrest', name: 'BlueCrest Logistics', crmSource: 'hubspot', trajectory: 'new_logo', startMonth: 9, baseMrr: 1900 },
  { key: 'foxtrot', name: 'Foxtrot Freight', crmSource: 'hubspot', trajectory: 'new_logo', startMonth: 10, baseMrr: 1600 },
  { key: 'ridgeline', name: 'Ridgeline Haulers', crmSource: 'salesforce', trajectory: 'new_logo', startMonth: 11, baseMrr: 3800 },
  { key: 'vertex', name: 'Vertex Cargo Co', crmSource: 'hubspot', trajectory: 'new_logo', startMonth: 12, baseMrr: 2100 },
  { key: 'northstar', name: 'Northstar Distribution', crmSource: 'hubspot', trajectory: 'new_logo', startMonth: 13, baseMrr: 1750 }
]

/** Deterministic small noise so revenue isn't perfectly flat, seeded off the customer key + month. */
function noise(key: string, monthIndex: number): number {
  let h = 0
  const s = `${key}:${monthIndex}`
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return 0.97 + (h % 601) / 10000 // ~0.97..1.03
}

/** Monthly revenue for a customer at a given month index, 0 if not active that month. Drives the QuickBooks invoice roll-forward. */
export function monthlyRevenue(customer: CustomerDef, monthIndex: number): number {
  if (monthIndex < customer.startMonth) return 0
  if (customer.trajectory === 'churn' && customer.churnMonth !== undefined && monthIndex >= customer.churnMonth) return 0

  let amount = customer.baseMrr
  if ((customer.trajectory === 'expansion' || customer.trajectory === 'downgrade') && customer.stepMonth !== undefined && customer.stepMultiplier !== undefined) {
    if (monthIndex >= customer.stepMonth) amount = customer.baseMrr * customer.stepMultiplier
  }
  return Math.round(amount * noise(customer.key, monthIndex))
}

export function customerByKey(key: string): CustomerDef {
  const c = CUSTOMERS.find((x) => x.key === key)
  if (!c) throw new Error(`Unknown customer key: ${key}`)
  return c
}

export function competitorFor(monthIndex: number): string {
  return COMPETITORS[monthIndex % COMPETITORS.length]
}

export { COMPETITORS }
