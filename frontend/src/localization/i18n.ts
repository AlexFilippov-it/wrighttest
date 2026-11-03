import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import englishMessages from '../../../shared/locales/en.json';
import russianMessages from '../../../shared/locales/ru-RU.json';
import { BACKEND_URL } from '../utils/runtimeConfig';

export type PublicLocale = {
  activeLocale: string;
  messages: Record<string, string>;
};

let activeLocaleRequest: Promise<PublicLocale> | null = null;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: englishMessages },
    'ru-RU': { translation: russianMessages }
  },
  lng: 'en',
  fallbackLng: 'en',
  load: 'currentOnly',
  keySeparator: false,
  react: { useSuspense: false },
  interpolation: { escapeValue: false },
  returnNull: false
});

i18n.on('languageChanged', (locale) => {
  document.documentElement.lang = locale;
});

export function loadInstanceLocale() {
  if (activeLocaleRequest) return activeLocaleRequest;

  const request = (async () => {
    const response = await fetch(`${BACKEND_URL}/localization/public`);
    if (!response.ok) throw new Error('Could not load the active interface language');
    const locale = await response.json() as PublicLocale;

    // Rebuild the active bundle so deleted overrides do not linger in this tab.
    i18n.removeResourceBundle(locale.activeLocale, 'translation');
    if (locale.activeLocale === 'ru-RU') {
      i18n.addResourceBundle(locale.activeLocale, 'translation', russianMessages, true, true);
    } else if (locale.activeLocale === 'en') {
      i18n.addResourceBundle(locale.activeLocale, 'translation', englishMessages, true, true);
    }
    if (Object.keys(locale.messages).length > 0) {
      i18n.addResourceBundle(locale.activeLocale, 'translation', locale.messages, true, true);
    }
    await i18n.changeLanguage(locale.activeLocale);
    return locale;
  })();

  activeLocaleRequest = request;
  void request.then(
    () => { if (activeLocaleRequest === request) activeLocaleRequest = null; },
    () => { if (activeLocaleRequest === request) activeLocaleRequest = null; }
  );
  return request;
}

export default i18n;
