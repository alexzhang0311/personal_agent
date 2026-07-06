import { useMemo } from 'react'

export function useSessionChartData(stats) {
  return useMemo(() => {
    if (!stats?.users?.length) return { sessionBarData: [], storageBarData: [] }

    const sessionBarData = [...stats.users]
      .sort((a, b) => b.session_count - a.session_count)
      .slice(0, 10)
      .map((u) => ({ username: u.username, sessions: u.session_count }))

    const storageBarData = [...stats.users]
      .sort((a, b) => b.storage_bytes - a.storage_bytes)
      .slice(0, 10)
      .map((u) => ({
        username: u.username,
        storage: u.storage_bytes,
        formatted: formatBytes(u.storage_bytes),
      }))

    return { sessionBarData, storageBarData }
  }, [stats])
}

export function useAuditChartData(entries) {
  return useMemo(() => {
    if (!entries || entries.length < 3) return { timelineData: [] }

    // Determine time span
    const timestamps = entries.map((e) => new Date(e.timestamp).getTime())
    const minT = Math.min(...timestamps)
    const maxT = Math.max(...timestamps)
    const spanMs = maxT - minT
    const useHourly = spanMs < 3 * 24 * 60 * 60 * 1000 // < 3 days

    const buckets = {}

    for (const entry of entries) {
      const d = new Date(entry.timestamp)
      const key = useHourly
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

      if (!buckets[key]) {
        buckets[key] = { date: key, login: 0, user: 0, session: 0, skill: 0, tool: 0 }
      }

      const category = entry.action?.split('.')[0]
      if (category && category in buckets[key]) {
        buckets[key][category]++
      }
    }

    const timelineData = Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date))
    return { timelineData }
  }, [entries])
}

export function useSkillUsageChartData(skillUsage) {
  return useMemo(() => {
    if (!skillUsage?.length) return []
    return [...skillUsage]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((item) => ({ skill: item.skill, count: item.count }))
  }, [skillUsage])
}

export function useSessionActivityChartData(sessionActivity) {
  return useMemo(() => {
    if (!sessionActivity?.length) return []
    return [...sessionActivity]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => ({ date: item.date, count: item.count }))
  }, [sessionActivity])
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}
