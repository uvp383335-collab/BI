import React from 'react'
import { render, screen } from '@testing-library/react'
import { ProductRevenueGrowthChart } from './ProductRevenueGrowthChart'
import { ProductRevenueGrowthProduct } from '../api/productRevenueGrowthApi'

const PRODUCTS: ProductRevenueGrowthProduct[] = [
  {
    id: '1',
    name: 'Widget',
    months: [
      { month: 'Jan 2026', revenue: 1000, revenueGrowthPct: null },
      { month: 'Feb 2026', revenue: 1100, revenueGrowthPct: 10 }
    ]
  },
  {
    id: '2',
    name: 'Gadget',
    months: [
      { month: 'Jan 2026', revenue: 500, revenueGrowthPct: null },
      { month: 'Feb 2026', revenue: 400, revenueGrowthPct: -20 }
    ]
  }
]

describe('ProductRevenueGrowthChart', () => {
  it('shows the empty state when there are no products', () => {
    render(<ProductRevenueGrowthChart products={[]} selectedProductId="" viewMode="percentage" />)
    expect(screen.getByText('No data available for this range.')).toBeInTheDocument()
  })

  it('renders one series per product in "all products" mode without crashing', () => {
    const { container } = render(<ProductRevenueGrowthChart products={PRODUCTS} selectedProductId="" viewMode="percentage" />)
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })

  it('renders a single series when a product is selected, in absolute-revenue mode', () => {
    const { container } = render(<ProductRevenueGrowthChart products={PRODUCTS} selectedProductId="1" viewMode="absolute" />)
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })
})
