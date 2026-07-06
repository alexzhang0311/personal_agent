import { getJSON, putJSON } from './client'

export function getUserEnv() {
  return getJSON('/auth/me/env')
}

export function updateUserEnv(env) {
  return putJSON('/auth/me/env', env)
}

export function getUserEnvStatus() {
  return getJSON('/auth/me/env/status')
}

export function fetchModels() {
  return getJSON('/resource/models')
}

export function getQuickActions() {
  return getJSON('/resource/quickactions')
}

export function updateQuickActions(quickactions) {
  return putJSON('/resource/quickactions', { quickactions })
}

export function getVisionModel() {
  return getJSON('/resource/vision-model')
}

export function updateVisionModel(visionModel) {
  return putJSON('/resource/vision-model', { vision_model: visionModel })
}
