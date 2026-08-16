export const RTL_LOCALES = new Set(['fa-IR'])

export function localeDirection(locale: string): 'rtl' | 'ltr' {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'
}

export function applyDocumentLocale(locale: string) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const dir = localeDirection(locale)
  const lang = locale === 'fa-IR' ? 'fa' : locale.split('-')[0] || 'en'
  root.setAttribute('dir', dir)
  root.setAttribute('lang', lang)
}
