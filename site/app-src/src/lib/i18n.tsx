import { createContext, useContext, useState, type ReactNode } from 'react'
import { getLang, setLang as persistLang, type Lang } from './theme'

type I18n = { lang: Lang; setLang: (l: Lang) => void; t: (zh: string, en: string) => string }
const Ctx = createContext<I18n>({ lang: 'zh', setLang: () => {}, t: (zh) => zh })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLang())
  const setLang = (l: Lang) => { persistLang(l); setLangState(l) }
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en)
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export const useI18n = () => useContext(Ctx)
