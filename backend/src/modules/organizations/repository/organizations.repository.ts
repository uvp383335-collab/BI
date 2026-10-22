import { OrganizationModel } from '../model/Organization.model'
import { Types } from 'mongoose'

export const organizationsRepository = {
  findBySlug(slug: string) {
    return OrganizationModel.findOne({ slug })
  },

  findById(id: string | Types.ObjectId) {
    return OrganizationModel.findById(id)
  },

  /**
   * Creates the organization with a pre-assigned _id so the tenant database
   * name (derived from that id) can be embedded on the very first write.
   */
  create(data: { name: string; slug: string }) {
    const _id = new Types.ObjectId()
    const dbName = `tenant_${_id.toHexString()}`
    return OrganizationModel.create({ _id, dbName, ...data })
  },

  async slugExists(slug: string) {
    const count = await OrganizationModel.countDocuments({ slug })
    return count > 0
  },

  /** `null` for either field clears that setting (e.g. un-configuring competitor tracking, or switching modes). */
  updateSalesforceCompetitorSettings(
    orgId: string | Types.ObjectId,
    settings: { salesforceCompetitorSource: 'field' | 'junction' | null; salesforceCompetitorField: string | null }
  ) {
    const set: Record<string, unknown> = {}
    const unset: Record<string, 1> = {}
    if (settings.salesforceCompetitorSource) set['settings.salesforceCompetitorSource'] = settings.salesforceCompetitorSource
    else unset['settings.salesforceCompetitorSource'] = 1
    // The field name is only meaningful in 'field' mode -- clear it whenever junction mode is
    // selected (or no source at all), so a stale field name never lingers after switching modes.
    if (settings.salesforceCompetitorField && settings.salesforceCompetitorSource === 'field') {
      set['settings.salesforceCompetitorField'] = settings.salesforceCompetitorField
    } else {
      unset['settings.salesforceCompetitorField'] = 1
    }
    const update: Record<string, unknown> = {}
    if (Object.keys(set).length > 0) update.$set = set
    if (Object.keys(unset).length > 0) update.$unset = unset
    return OrganizationModel.findByIdAndUpdate(orgId, update, { new: true })
  },

  /** Empty array clears the config (un-configured), same convention as updateSalesforceCompetitorSettings. */
  updateSalesforceOpportunityExtraFields(orgId: string | Types.ObjectId, fields: { apiName: string; label: string }[]) {
    const update =
      fields.length > 0 ? { $set: { 'settings.salesforceOpportunityExtraFields': fields } } : { $unset: { 'settings.salesforceOpportunityExtraFields': 1 } }
    return OrganizationModel.findByIdAndUpdate(orgId, update, { new: true })
  },

  /** `null` on a single-account field clears it; an empty `cb07ExpenditureAccountIds` array clears that too. */
  updateCashMetricsAccountSettings(
    orgId: string | Types.ObjectId,
    settings: {
      cb07ExpenditureAccountIds: string[]
      cb10AccountsReceivableAccountId: string | null
      cb10AccountsPayableAccountId: string | null
      cb10InventoryAccountId: string | null
    }
  ) {
    const set: Record<string, unknown> = {}
    const unset: Record<string, 1> = {}

    if (settings.cb07ExpenditureAccountIds.length > 0) set['settings.cb07ExpenditureAccountIds'] = settings.cb07ExpenditureAccountIds
    else unset['settings.cb07ExpenditureAccountIds'] = 1

    const singleAccountFields: ['cb10AccountsReceivableAccountId', 'cb10AccountsPayableAccountId', 'cb10InventoryAccountId'] = [
      'cb10AccountsReceivableAccountId',
      'cb10AccountsPayableAccountId',
      'cb10InventoryAccountId'
    ]
    for (const field of singleAccountFields) {
      if (settings[field]) set[`settings.${field}`] = settings[field]
      else unset[`settings.${field}`] = 1
    }

    const update: Record<string, unknown> = {}
    if (Object.keys(set).length > 0) update.$set = set
    if (Object.keys(unset).length > 0) update.$unset = unset
    return OrganizationModel.findByIdAndUpdate(orgId, update, { new: true })
  },

  /** Empty array clears the config (un-configured), same convention as the other account-id settings above. */
  updateGAndAAccountSettings(orgId: string | Types.ObjectId, gaExpenseAccountIds: string[]) {
    const update =
      gaExpenseAccountIds.length > 0 ? { $set: { 'settings.gaExpenseAccountIds': gaExpenseAccountIds } } : { $unset: { 'settings.gaExpenseAccountIds': 1 } }
    return OrganizationModel.findByIdAndUpdate(orgId, update, { new: true })
  },

  /** Empty account-id array clears both fields (un-configured) — a duration with no accounts picked is meaningless, same convention as `updateGAndAAccountSettings`. */
  updateCACSettings(orgId: string | Types.ObjectId, settings: { cacExpenseAccountIds: string[]; cacDurationMonths: number }) {
    const update =
      settings.cacExpenseAccountIds.length > 0
        ? { $set: { 'settings.cacExpenseAccountIds': settings.cacExpenseAccountIds, 'settings.cacDurationMonths': settings.cacDurationMonths } }
        : { $unset: { 'settings.cacExpenseAccountIds': 1, 'settings.cacDurationMonths': 1 } }
    return OrganizationModel.findByIdAndUpdate(orgId, update, { new: true })
  }
}
