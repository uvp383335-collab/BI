import { quickbooksAuth, closeDb } from './auth'
import { makeQbClient } from './qbClient'
import { CUSTOMERS } from './data'

async function main() {
  const { accessToken, realmId } = await quickbooksAuth()
  const qb = makeQbClient(accessToken, realmId)

  const parents = CUSTOMERS.filter((c) => !c.parentKey)
  const children = CUSTOMERS.filter((c) => c.parentKey)

  console.log(`Creating ${parents.length} parent Customers...`)
  const parentResults = await qb.createMany(
    'Customer',
    parents.map((c) => ({ DisplayName: c.name, CompanyName: c.name }))
  )
  const idByKey = new Map<string, string>()
  parents.forEach((c, i) => {
    const r = parentResults[i]
    if (r.ok) idByKey.set(c.key, r.id!)
    else console.log(`  FAILED ${c.name}:`, JSON.stringify(r.error).slice(0, 300))
  })
  console.log(`  ${idByKey.size}/${parents.length} created`)

  console.log(`Creating ${children.length} subsidiary Customers...`)
  const childResults = await qb.createMany(
    'Customer',
    children.map((c) => ({
      DisplayName: c.name,
      CompanyName: c.name,
      ParentRef: { value: idByKey.get(c.parentKey!) },
      Job: true
    }))
  )
  let childOk = 0
  children.forEach((c, i) => {
    const r = childResults[i]
    if (r.ok) {
      idByKey.set(c.key, r.id!)
      childOk++
    } else console.log(`  FAILED ${c.name}:`, JSON.stringify(r.error).slice(0, 300))
  })
  console.log(`  ${childOk}/${children.length} created`)

  console.log(`QuickBooks customers phase complete: ${idByKey.size}/${CUSTOMERS.length} total customers created.`)
  await closeDb()
}

main().catch((e) => {
  console.error('QuickBooks customers seed failed:', e.response?.data ?? e.message)
  process.exit(1)
})
