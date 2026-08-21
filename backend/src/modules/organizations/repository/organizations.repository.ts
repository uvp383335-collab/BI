import { OrganizationModel } from '../model/Organization.model'
import { Types } from 'mongoose'

export const organizationsRepository = {
  findBySlug(slug: string) {
    return OrganizationModel.findOne({ slug })
  },

  findById(id: string | Types.ObjectId) {
    return OrganizationModel.findById(id)
  },

  create(data: { name: string; slug: string }) {
    return OrganizationModel.create(data)
  },

  async slugExists(slug: string) {
    const count = await OrganizationModel.countDocuments({ slug })
    return count > 0
  }
}
