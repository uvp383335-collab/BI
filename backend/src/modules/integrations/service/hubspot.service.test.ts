import axios from 'axios'
import { HubSpotService, IMPORTED_HISTORY_OBJECTS } from './hubspot.service'

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }))

const mockedPost = axios.post as jest.Mock

const DEAL_HISTORY = { ...IMPORTED_HISTORY_OBJECTS.dealStage, objectTypeId: '2-100' }
const LIFECYCLE_HISTORY = { ...IMPORTED_HISTORY_OBJECTS.lifecycle, objectTypeId: '2-200' }

function associationsResponse(links: Record<string, string[]>) {
  return {
    data: { results: Object.entries(links).map(([from, to]) => ({ from: { id: from }, to: to.map((id) => ({ toObjectId: Number(id) })) })) }
  }
}

function changesResponse(changes: { id: string; properties: Record<string, string> }[]) {
  return { data: { results: changes } }
}

describe('HubSpotService.getImportedStageHistory', () => {
  beforeEach(() => mockedPost.mockReset())

  it('groups change records under their deal, oldest first', async () => {
    mockedPost
      .mockResolvedValueOnce(associationsResponse({ d1: ['11', '12'], d2: ['21'] }))
      .mockResolvedValueOnce(
        changesResponse([
          { id: '12', properties: { dealstage_id: 'closedwon', entered_at: '2024-07-27T00:00:00Z' } },
          { id: '11', properties: { dealstage_id: 'qualify', entered_at: '2024-05-02T00:00:00Z' } },
          { id: '21', properties: { dealstage_id: 'qualify', entered_at: '2024-03-23T00:00:00Z' } }
        ])
      )

    const history = await HubSpotService.getImportedStageHistory('token', 'deals', DEAL_HISTORY, ['d1', 'd2', 'd3'])

    expect(history).toEqual({
      d1: [
        { value: 'qualify', timestamp: '2024-05-02T00:00:00Z' },
        { value: 'closedwon', timestamp: '2024-07-27T00:00:00Z' }
      ],
      d2: [{ value: 'qualify', timestamp: '2024-03-23T00:00:00Z' }]
    })
    expect(mockedPost.mock.calls[0][0]).toBe('https://api.hubapi.com/crm/v4/associations/deals/2-100/batch/read')
    expect(mockedPost.mock.calls[1][1].properties).toEqual(['dealstage_id', 'entered_at'])
  })

  it('drops changes that cleared the stage or have no date', async () => {
    mockedPost.mockResolvedValueOnce(associationsResponse({ c1: ['1', '2', '3'] })).mockResolvedValueOnce(
      changesResponse([
        { id: '1', properties: { stage: 'lead', changed_at: '2022-11-10T00:00:00Z' } },
        { id: '2', properties: { stage: 'cleared', changed_at: '2022-12-01T00:00:00Z' } },
        { id: '3', properties: { stage: 'marketingqualifiedlead' } }
      ])
    )

    const history = await HubSpotService.getImportedStageHistory('token', 'contacts', LIFECYCLE_HISTORY, ['c1'])

    expect(history).toEqual({ c1: [{ value: 'lead', timestamp: '2022-11-10T00:00:00Z' }] })
  })

  it('reads change records in batches of 100', async () => {
    const changeIds = Array.from({ length: 150 }, (_, i) => String(i + 1))
    mockedPost
      .mockResolvedValueOnce(associationsResponse({ d1: changeIds }))
      .mockResolvedValueOnce(changesResponse([]))
      .mockResolvedValueOnce(changesResponse([]))

    await HubSpotService.getImportedStageHistory('token', 'deals', DEAL_HISTORY, ['d1'])

    expect(mockedPost).toHaveBeenCalledTimes(3)
    expect(mockedPost.mock.calls[1][1].inputs).toHaveLength(100)
    expect(mockedPost.mock.calls[2][1].inputs).toHaveLength(50)
  })

  it('makes no calls for an empty page', async () => {
    expect(await HubSpotService.getImportedStageHistory('token', 'deals', DEAL_HISTORY, [])).toEqual({})
    expect(mockedPost).not.toHaveBeenCalled()
  })
})
