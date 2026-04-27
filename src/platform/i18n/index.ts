import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enGB from './locales/en-GB.json';
import frFR from './locales/fr-FR.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'en-GB': { translation: enGB },
      'en-US': { translation: enGB },
      'fr-FR': { translation: frFR },
      'fr':    { translation: frFR },
    },
    lng: 'en-GB',
    fallbackLng: {
      'fr-FR':   ['fr', 'en-GB'],
      'fr':      ['en-GB'],
      'en-US':   ['en-GB'],
      'default': ['en-GB'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
