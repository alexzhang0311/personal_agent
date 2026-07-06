import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import safeStorage from './utils/safeStorage'
import en from './locales/en.json'
import zh from './locales/zh.json'

const storedLang = safeStorage.getItem('language') || 'zh'

// Sync <html lang> with stored language on init
document.documentElement.lang = storedLang === 'zh' ? 'zh-CN' : 'en'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: storedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
