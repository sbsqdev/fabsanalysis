import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import ruData from '../locales/ru';
import enData from '../locales/en';

export type Lang = 'ru' | 'en';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  ru: ruData,
  en: enData,
};

function getStoredLang(): Lang {
  try {
    const stored = localStorage.getItem('fabs-lang');
    if (stored === 'en' || stored === 'ru') return stored;
  } catch { /* SSR or privacy mode */ }
  return 'ru';
}

function storeLang(lang: Lang) {
  try {
    localStorage.setItem('fabs-lang', lang);
  } catch { /* ignore */ }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getStoredLang);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    storeLang(newLang);
  }, []);

  const t = useCallback((key: string): string => {
    return TRANSLATIONS[lang][key] ?? TRANSLATIONS.ru[key] ?? key;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

/** Shorthand: just the t function */
export function useT() {
  return useLanguage().t;
}

/** Get current lang without React (for non-component code like i18n.ts) */
export function getCurrentLang(): Lang {
  return getStoredLang();
}
