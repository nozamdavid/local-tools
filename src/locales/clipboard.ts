import type { Locale } from '../lib/i18n';

// Translation order is Spanish, Italian, German, Portuguese, French.
const translations: Record<string, [string, string, string, string, string]> = {
  'Copying…': ['Copiando…', 'Copia in corso…', 'Wird kopiert…', 'A copiar…', 'Copie en cours…'],
  'Copy image': ['Copiar imagen', 'Copia immagine', 'Bild kopieren', 'Copiar imagem', 'Copier l’image'],
  'Could not copy the image.': [
    'No se pudo copiar la imagen.',
    'Impossibile copiare l’immagine.',
    'Das Bild konnte nicht kopiert werden.',
    'Não foi possível copiar a imagem.',
    'Impossible de copier l’image.',
  ],
  'Right-click or press and hold the image, then choose Copy Image.': [
    'Haz clic con el botón derecho en la imagen o mantenla pulsada y elige «Copiar imagen».',
    'Fai clic con il pulsante destro sull’immagine o tienila premuta, poi scegli «Copia immagine».',
    'Klicke mit der rechten Maustaste auf das Bild oder halte es gedrückt und wähle „Bild kopieren“.',
    'Clique na imagem com o botão direito ou mantenha-a premida e escolha «Copiar imagem».',
    'Faites un clic droit sur l’image ou appuyez dessus longuement, puis choisissez « Copier l’image ».',
  ],
  Close: ['Cerrar', 'Chiudi', 'Schließen', 'Fechar', 'Fermer'],
};

const locales: Locale[] = ['es', 'it', 'de', 'pt', 'fr'];
const messages: Partial<Record<Locale, Record<string, string>>> = { es: {}, it: {}, de: {}, pt: {}, fr: {} };

for (const [source, translated] of Object.entries(translations)) {
  locales.forEach((locale, index) => {
    messages[locale]![source] = translated[index];
  });
}

export { messages };
