import axios, { AxiosInstance } from 'axios'

const SANDBOX_HOST = 'https://sandbox-quickbooks.api.intuit.com'

export interface QbEntityRef {
  Id: string
  SyncToken: string
}

export function makeQbClient(accessToken: string, realmId: string) {
  const http: AxiosInstance = axios.create({
    baseURL: `${SANDBOX_HOST}/v3/company/${realmId}`,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }
  })

  /** Runs a QuickBooks SQL-like query, paginating via STARTPOSITION/MAXRESULTS (max 1000/page). */
  async function query<T>(entity: string, whereClause = ''): Promise<T[]> {
    const results: T[] = []
    let startPosition = 1
    const pageSize = 1000
    for (;;) {
      const q = `SELECT * FROM ${entity}${whereClause ? ` WHERE ${whereClause}` : ''} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
      const res = await http.get('/query', { params: { query: q } })
      const page: T[] = res.data.QueryResponse?.[entity] ?? []
      results.push(...page)
      if (page.length < pageSize) break
      startPosition += pageSize
    }
    return results
  }

  /** Batches up to 30 create/update/delete operations in one call (QuickBooks batch API limit). */
  async function batch(
    ops: { bId: string; operation: 'create' | 'update' | 'delete'; entityType: string; entity: Record<string, unknown> }[]
  ): Promise<{ bId: string; entityType: string; ok: boolean; error?: unknown; entity?: Record<string, unknown> }[]> {
    const out: { bId: string; entityType: string; ok: boolean; error?: unknown; entity?: Record<string, unknown> }[] = []
    for (let i = 0; i < ops.length; i += 30) {
      const chunk = ops.slice(i, i + 30)
      const body = {
        BatchItemRequest: chunk.map((op) => ({
          bId: op.bId,
          operation: op.operation === 'create' ? undefined : op.operation.toUpperCase(),
          [op.entityType]: op.entity
        }))
      }
      const res = await http.post('/batch', body)
      const items: {
        bId: string
        Fault?: unknown
        [key: string]: unknown
      }[] = res.data.BatchItemResponse ?? []
      for (const item of items) {
        const op = chunk.find((o) => o.bId === item.bId)!
        if (item.Fault) {
          out.push({ bId: item.bId, entityType: op.entityType, ok: false, error: item.Fault })
        } else {
          out.push({ bId: item.bId, entityType: op.entityType, ok: true, entity: item[op.entityType] as Record<string, unknown> })
        }
      }
    }
    return out
  }

  /** Creates many records of one entity type via `batch`, returning results aligned to input order. */
  async function createMany(
    entityType: string,
    records: Record<string, unknown>[]
  ): Promise<{ ok: boolean; id?: string; error?: unknown; entity?: Record<string, unknown> }[]> {
    const ops = records.map((r, i) => ({ bId: `${entityType}${i}`, operation: 'create' as const, entityType, entity: r }))
    const results = await batch(ops)
    // batch() results aren't guaranteed to preserve input order across chunks in a Map-free way,
    // so line them back up by bId index.
    const byBId = new Map(results.map((r) => [r.bId, r]))
    return ops.map((op) => {
      const r = byBId.get(op.bId)
      if (!r) return { ok: false, error: 'no response' }
      return { ok: r.ok, id: r.entity?.Id as string | undefined, error: r.error, entity: r.entity }
    })
  }

  return { http, query, batch, createMany }
}

export type QbClient = ReturnType<typeof makeQbClient>
