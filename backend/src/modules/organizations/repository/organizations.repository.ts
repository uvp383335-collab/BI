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
  }
}
