export function BarChartSkeleton({ barCount = 6, height = 200 }) {
  const widths = [70, 55, 85, 40, 60, 50]
  return (
    <div className="flex flex-col gap-3" style={{ height, justifyContent: 'center' }}>
      {Array.from({ length: barCount }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton" style={{ width: 60, height: 11, flexShrink: 0 }} />
          <div
            className="skeleton"
            style={{ width: `${widths[i % widths.length]}%`, height: 16, flex: 1, maxWidth: `${widths[i % widths.length]}%` }}
          />
        </div>
      ))}
    </div>
  )
}

export function AreaChartSkeleton({ height = 280 }) {
  return (
    <div className="flex flex-col gap-2" style={{ height }}>
      <div className="skeleton flex-1" style={{ width: '100%', minHeight: 0 }} />
      <div className="flex items-center gap-4 justify-center">
        {[60, 50, 40, 55, 45].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 10 }} />
        ))}
      </div>
    </div>
  )
}
