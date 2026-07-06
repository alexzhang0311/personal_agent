import { getJSON, postJSON, putJSON, deleteJSON } from './client'

export const listJobs = () => getJSON('/scheduler/jobs')
export const createJob = (data) => postJSON('/scheduler/jobs', data)
export const getJob = (jobId) => getJSON(`/scheduler/jobs/${jobId}`)
export const updateJob = (jobId, data) => putJSON(`/scheduler/jobs/${jobId}`, data)
export const deleteJob = (jobId) => deleteJSON(`/scheduler/jobs/${jobId}`)
export const pauseJob = (jobId) => postJSON(`/scheduler/jobs/${jobId}/pause`)
export const resumeJob = (jobId) => postJSON(`/scheduler/jobs/${jobId}/resume`)
export const triggerJob = (jobId) => postJSON(`/scheduler/jobs/${jobId}/trigger`)

const buildHistoryQuery = ({ limit = 50, before = null, after = null, status = null } = {}) => {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (before) params.set('before', before)
  if (after) params.set('after', after)
  if (status) params.set('status', status)
  return params.toString()
}

export const getJobHistory = (jobId, opts = {}) =>
  getJSON(`/scheduler/jobs/${jobId}/history?${buildHistoryQuery(opts)}`)

export const getAllHistory = (opts = {}) =>
  getJSON(`/scheduler/history?${buildHistoryQuery(opts)}`)

export const getRunning = () => getJSON('/scheduler/running')

export const getRunOutput = (runId, offset = 0) =>
  getJSON(`/scheduler/running/${runId}/output?offset=${offset}`)

export const cancelRun = (runId) => postJSON(`/scheduler/running/${runId}/cancel`)

export const getHealth = () => getJSON('/scheduler/health')

export const reloadJobs = () => postJSON('/scheduler/reload')
