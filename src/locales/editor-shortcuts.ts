import type { Locale } from '../lib/i18n';

// Spanish, Italian, German, Portuguese, French.
const rows: Record<string, [string, string, string, string, string]> = {
  or: ['o', 'o', 'oder', 'ou', 'ou'],
  Ctrl: ['Ctrl', 'Ctrl', 'Strg', 'Ctrl', 'Ctrl'],
  Cmd: ['Cmd', 'Cmd', 'Cmd', 'Cmd', 'Cmd'],
  Alt: ['Alt', 'Alt', 'Alt', 'Alt', 'Alt'],
  Option: ['Opción', 'Opzione', 'Wahltaste', 'Opção', 'Option'],
  Enter: ['Intro', 'Invio', 'Eingabe', 'Enter', 'Entrée'],
  Del: ['Supr', 'Canc', 'Entf', 'Del', 'Suppr'],
  Backspace: ['Retroceso', 'Backspace', 'Rücktaste', 'Retrocesso', 'Retour arrière'],
  Tab: ['Tab', 'Tab', 'Tab', 'Tab', 'Tab'],
  'Home key': ['Inicio', 'Inizio', 'Pos1', 'Início', 'Début'],
  'End key': ['Fin', 'Fine', 'Ende', 'Fim', 'Fin'],
  'Left arrow': ['Flecha izquierda', 'Freccia sinistra', 'Pfeil links', 'Seta para a esquerda', 'Flèche gauche'],
  'Right arrow': ['Flecha derecha', 'Freccia destra', 'Pfeil rechts', 'Seta para a direita', 'Flèche droite'],
  'Up arrow': ['Flecha arriba', 'Freccia su', 'Pfeil nach oben', 'Seta para cima', 'Flèche haut'],
  'Down arrow': ['Flecha abajo', 'Freccia giù', 'Pfeil nach unten', 'Seta para baixo', 'Flèche bas'],
};

export const messages: Partial<Record<Locale, Record<string, string>>> = Object.fromEntries(
  (['es', 'it', 'de', 'pt', 'fr'] as const).map((locale, index) => [
    locale,
    Object.fromEntries(Object.entries(rows).map(([source, values]) => [source, values[index]])),
  ]),
);
