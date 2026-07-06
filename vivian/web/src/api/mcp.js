import { getJSON, postJSON, putJSON, deleteJSON } from './client'

export const listMcpServers = () => getJSON('/resource/mcp/')

export const getMcpServerDetail = (level, name) =>
  getJSON(`/resource/mcp/${encodeURIComponent(level)}/${encodeURIComponent(name)}`)

export const getMcpServerCapabilities = (level, name) =>
  getJSON(`/resource/mcp/${encodeURIComponent(level)}/${encodeURIComponent(name)}/capabilities`)

export const createMcpServer = (data) => postJSON('/resource/mcp/', data)

export const updateMcpServer = (level, name, data) =>
  putJSON(`/resource/mcp/${encodeURIComponent(level)}/${encodeURIComponent(name)}`, data)

export const deleteMcpServer = (level, name) =>
  deleteJSON(`/resource/mcp/${encodeURIComponent(level)}/${encodeURIComponent(name)}`)

export const validateMcpServer = (data) => postJSON('/resource/mcp/validate', data)

export const validateMcpTool = (data) => postJSON('/resource/mcp/validate/tool', data)
