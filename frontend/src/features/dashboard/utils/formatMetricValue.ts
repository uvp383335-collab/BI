import { MetricUnit } from '../api/metricsApi'

export function formatMetricValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'months':
      return `${value.toFixed(1)} mo`
    case 'multiple':
      return `${value.toFixed(2)}x`
    case 'usd':
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    case 'days':
      return `${value.toFixed(1)} days`
    case 'count':
      return value.toLocaleString()
    default:
      return value.toFixed(1)
  }
}
