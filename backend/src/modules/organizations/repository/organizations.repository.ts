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
  }
}
