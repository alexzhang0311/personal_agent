import { getJSON, putJSON, postJSON } from './client'

export const getWeComConfig = () => getJSON('/channels/wecom/config')
export const updateWeComConfig = (data) => putJSON('/channels/wecom/config', data)
export const connectWeCom = () => postJSON('/channels/wecom/connect')
export const disconnectWeCom = () => postJSON('/channels/wecom/disconnect')
export const reconnectWeCom = () => postJSON('/channels/wecom/reconnect')
export const getWeComStatus = () => getJSON('/channels/wecom/status')
export const getChannelsHealth = () => getJSON('/channels/health')

// OpenClaw
export const getOpenClawConfig = () => getJSON('/channels/openclaw/config')
export const updateOpenClawConfig = (data) => putJSON('/channels/openclaw/config', data)
export const connectOpenClaw = () => postJSON('/channels/openclaw/connect')
export const disconnectOpenClaw = () => postJSON('/channels/openclaw/disconnect')
export const reconnectOpenClaw = () => postJSON('/channels/openclaw/reconnect')
export const getOpenClawStatus = () => getJSON('/channels/openclaw/status')
