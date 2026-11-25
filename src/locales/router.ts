import type { Locale } from '../lib/i18n';

export const messages: Partial<Record<Locale, Record<string, string>>> = {
  es: { 'Loading tool…': 'Cargando herramienta…' },
  it: { 'Loading tool…': 'Caricamento dello strumento…' },
  de: { 'Loading tool…': 'Werkzeug wird geladen…' },
  pt: { 'Loading tool…': 'Carregando ferramenta…' },
  fr: { 'Loading tool…': 'Chargement de l’outil…' },
};
