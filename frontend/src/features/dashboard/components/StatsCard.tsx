import React from 'react'

interface StatsCardProps {
  title: string
  value: number
  description: string
  icon: React.ReactNode
}

export const StatsCard: React.FC<StatsCardProps> = ({ title, value, description, icon }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <div className="text-blue-600">{icon}</div>
    </div>
    <p className="mt-2 text-3xl font-semibold text-gray-900">{value.toLocaleString()}</p>
    <p className="mt-1 text-xs text-gray-500">{description}</p>
  </div>
)
