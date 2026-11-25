import type { Locale } from '../lib/i18n';

// Spanish, Italian, German, Portuguese, French.
const rows: Record<string, [string, string, string, string, string]> = {
  'Profile / Product Card': [
    'Tarjeta de perfil o producto',
    'Scheda profilo o prodotto',
    'Profil- oder Produktkarte',
    'Cartão de perfil ou produto',
    'Fiche de profil ou de produit',
  ],
  'Buttons & Badges': ['Botones e insignias', 'Pulsanti e badge', 'Schaltflächen und Abzeichen', 'Botões e emblemas', 'Boutons et badges'],
  'Interactive Form': [
    'Formulario interactivo',
    'Modulo interattivo',
    'Interaktives Formular',
    'Formulário interativo',
    'Formulaire interactif',
  ],
  'Typography & Layout': [
    'Tipografía y diseño',
    'Tipografia e impaginazione',
    'Typografie und Layout',
    'Tipografia e disposição',
    'Typographie et mise en page',
  ],
  '{count} times ({count}x)': [
    '{count} veces ({count}x)',
    '{count} volte ({count}x)',
    '{count} Mal ({count}x)',
    '{count} vezes ({count}x)',
    '{count} fois ({count}x)',
  ],
  'Enter a whole number of pages, 1 or more.': [
    'Introduce un número entero de páginas, como mínimo 1.',
    'Inserisci un numero intero di pagine, almeno 1.',
    'Eine ganze Seitenzahl eingeben, mindestens 1.',
    'Introduza um número inteiro de páginas, no mínimo 1.',
    'Saisissez un nombre entier de pages, au moins 1.',
  ],
  'The file contents did not confirm this format; it was inferred from the filename extension.': [
    'El contenido no confirmó el formato; se dedujo de la extensión del archivo.',
    'Il contenuto non ha confermato il formato, dedotto dall’estensione del file.',
    'Der Dateiinhalt bestätigt dieses Format nicht; es wurde aus der Dateiendung abgeleitet.',
    'O conteúdo não confirmou o formato; foi deduzido da extensão do ficheiro.',
    'Le contenu ne confirme pas ce format ; il a été déduit de l’extension du fichier.',
  ],
  'Input appears to be KML, but GPX → KML mode is selected. Please switch to KML → GPX.': [
    'La entrada parece KML, pero está seleccionado GPX → KML. Cambia a KML → GPX.',
    'L’input sembra KML, ma è selezionato GPX → KML. Passa a KML → GPX.',
    'Die Eingabe scheint KML zu sein, aber GPX → KML ist ausgewählt. Bitte zu KML → GPX wechseln.',
    'A entrada parece ser KML, mas está selecionado GPX → KML. Mude para KML → GPX.',
    'L’entrée semble être du KML, mais GPX → KML est sélectionné. Passez à KML → GPX.',
  ],
  'Input appears to be GPX, but KML → GPX mode is selected. Please switch to GPX → KML.': [
    'La entrada parece GPX, pero está seleccionado KML → GPX. Cambia a GPX → KML.',
    'L’input sembra GPX, ma è selezionato KML → GPX. Passa a GPX → KML.',
    'Die Eingabe scheint GPX zu sein, aber KML → GPX ist ausgewählt. Bitte zu GPX → KML wechseln.',
    'A entrada parece ser GPX, mas está selecionado KML → GPX. Mude para GPX → KML.',
    'L’entrée semble être du GPX, mais KML → GPX est sélectionné. Passez à GPX → KML.',
  ],
  'Preserved: waypoints, routes, tracks, multi-segment boundaries, elevations, coordinates, timestamps, names, and descriptions. Unsupported/omitted: vendor-specific device extensions (<extensions>, <cadence>, <hr>, <temp>), custom map styling (<Style>, <LineStyle>), and extended schema attributes.':
    [
      'Se conservan: puntos de paso, rutas, trazas, límites entre segmentos, elevaciones, coordenadas, marcas de tiempo, nombres y descripciones. No se admiten y se omiten: extensiones del fabricante (<extensions>, <cadence>, <hr>, <temp>), estilos de mapa personalizados (<Style>, <LineStyle>) y atributos de esquema ampliados.',
      'Vengono conservati: punti di passaggio, percorsi, tracce, limiti dei segmenti, quote, coordinate, date e ore, nomi e descrizioni. Non supportati e omessi: estensioni del produttore (<extensions>, <cadence>, <hr>, <temp>), stili di mappa personalizzati (<Style>, <LineStyle>) e attributi di schema estesi.',
      'Erhalten bleiben: Wegpunkte, Routen, Tracks, Segmentgrenzen, Höhen, Koordinaten, Zeitstempel, Namen und Beschreibungen. Nicht unterstützt und ausgelassen: herstellerspezifische Erweiterungen (<extensions>, <cadence>, <hr>, <temp>), eigene Kartenstile (<Style>, <LineStyle>) und erweiterte Schemaattribute.',
      'São preservados: pontos de passagem, rotas, trajetos, limites entre segmentos, elevações, coordenadas, marcas temporais, nomes e descrições. Não suportados e omitidos: extensões do fabricante (<extensions>, <cadence>, <hr>, <temp>), estilos de mapa personalizados (<Style>, <LineStyle>) e atributos de esquema alargados.',
      'Conservés : points de passage, itinéraires, traces, limites des segments, altitudes, coordonnées, horodatages, noms et descriptions. Non pris en charge et omis : extensions du fabricant (<extensions>, <cadence>, <hr>, <temp>), styles de carte personnalisés (<Style>, <LineStyle>) et attributs de schéma étendus.',
    ],
};

export const messages: Partial<Record<Locale, Record<string, string>>> = Object.fromEntries(
  (['es', 'it', 'de', 'pt', 'fr'] as const).map((locale, index) => [
    locale,
    Object.fromEntries(Object.entries(rows).map(([source, values]) => [source, values[index]])),
  ]),
);
