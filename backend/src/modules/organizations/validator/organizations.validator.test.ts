import { updateCm04TargetsSchema } from './organizations.validator'

describe('updateCm04TargetsSchema', () => {
  const row = (fromMonth: string, toMonth: string, targetAmount = 1000) => ({ fromMonth, toMonth, targetAmount })

  it('accepts non-overlapping ranges in any order', () => {
    const result = updateCm04TargetsSchema.safeParse({ targets: [row('2024-01', '2024-03'), row('2023-10', '2023-12')] })
    expect(result.success).toBe(true)
  })

  it('accepts an empty list (clears the targets)', () => {
    expect(updateCm04TargetsSchema.safeParse({ targets: [] }).success).toBe(true)
  })

  it('rejects overlapping ranges', () => {
    const result = updateCm04TargetsSchema.safeParse({ targets: [row('2023-10', '2023-12'), row('2023-12', '2024-02')] })
    expect(result.success).toBe(false)
  })

  it('rejects a range that ends before it starts', () => {
    expect(updateCm04TargetsSchema.safeParse({ targets: [row('2024-03', '2024-01')] }).success).toBe(false)
  })

  it('rejects a non-positive target and a malformed month', () => {
    expect(updateCm04TargetsSchema.safeParse({ targets: [row('2024-01', '2024-03', 0)] }).success).toBe(false)
    expect(updateCm04TargetsSchema.safeParse({ targets: [row('2024-13', '2024-12')] }).success).toBe(false)
  })
})
