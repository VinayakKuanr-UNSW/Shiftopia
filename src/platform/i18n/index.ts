import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enGB from './locales/en-GB.json';
import frFR from './locales/fr-FR.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'en-GB': { translation: enGB },
      'en-US': { translation: enGB }, // Reuse en-GB for now or create separate if needed
      'fr-FR': { translation: frFR }
    },
    fallbackLng: 'en-GB',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    }
  });

export default i18n;
