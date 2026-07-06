export default function Chip({ children, color = 'var(--text-secondary)' }) {
  return (
    <span
      className="chip"
      style={{ color }}
    >
      {children}
    </span>
  )
}
