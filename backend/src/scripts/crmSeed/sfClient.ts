import axios from 'axios'

const V = 'v65.0'

export function makeSfClient(accessToken: string, instanceUrl: string) {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

  /** Creates up to 200 records of one sobject type per call via the Composite sObject Collections API. */
  async function createMany(
    sobject: string,
    records: Record<string, unknown>[]
  ): Promise<{ id?: string; success: boolean; errors: unknown[] }[]> {
    const out: { id?: string; success: boolean; errors: unknown[] }[] = []
    for (let i = 0; i < records.length; i += 200) {
      const chunk = records.slice(i, i + 200)
      const res = await axios.post(
        `${instanceUrl}/services/data/${V}/composite/sobjects`,
        { allOrNone: false, records: chunk.map((r) => ({ attributes: { type: sobject }, ...r })) },
        { headers }
      )
      out.push(...res.data)
    }
    return out
  }

  async function query<T>(soql: string): Promise<T[]> {
    const records: T[] = []
    let url: string | null = `${instanceUrl}/services/data/${V}/query`
    let params: Record<string, string> | undefined = { q: soql }
    while (url) {
      const res: { data: { records: T[]; nextRecordsUrl?: string } } = await axios.get(url, { headers, params })
      records.push(...res.data.records)
      url = res.data.nextRecordsUrl ? `${instanceUrl}${res.data.nextRecordsUrl}` : null
      params = undefined
    }
    return records
  }

  return { createMany, query }
}

export type SfClient = ReturnType<typeof makeSfClient>
