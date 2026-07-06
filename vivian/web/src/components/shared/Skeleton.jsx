export function MessageSkeleton() {
  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="skeleton" style={{ width: 12, height: 12, borderRadius: '50%' }} />
        <div className="skeleton" style={{ width: 80, height: 11 }} />
        <div className="skeleton" style={{ width: 40, height: 11 }} />
      </div>
      <div className="skeleton" style={{ width: '92%', height: 13 }} />
      <div className="skeleton" style={{ width: '78%', height: 13 }} />
      <div className="skeleton" style={{ width: '55%', height: 13 }} />
    </div>
  )
}

export function TaskNodeSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px' }}>
      {[1, 0.7, 0.85, 0.6].map((w, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, paddingLeft: i > 0 ? 20 : 0 }}>
          <div className="skeleton" style={{ width: 12, height: 12, flexShrink: 0 }} />
          <div className="skeleton" style={{ width: `${w * 100}%`, height: 12 }} />
        </div>
      ))}
    </div>
  )
}
