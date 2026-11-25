import type { Locale } from '../lib/i18n';

// Translation order is Spanish, Italian, German, Portuguese, French.
const translations: Record<string, [string, string, string, string, string]> = {
  Left: ['Izquierda', 'Sinistra', 'Links', 'Esquerda', 'Gauche'],
  Right: ['Derecha', 'Destra', 'Rechts', 'Direita', 'Droite'],
  'Page numbers do not fit on this page. Reduce the font size.': [
    'Los números de página no caben en esta página. Reduce el tamaño de letra.',
    'I numeri di pagina non entrano in questa pagina. Riduci la dimensione del carattere.',
    'Die Seitenzahlen passen nicht auf diese Seite. Schriftgröße verkleinern.',
    'Os números de página não cabem nesta página. Reduza o tamanho da letra.',
    'Les numéros de page ne tiennent pas sur cette page. Réduisez la taille du texte.',
  ],
  'Live watermark preview': [
    'Vista previa de la marca de agua en directo',
    'Anteprima in tempo reale della filigrana',
    'Live-Vorschau des Wasserzeichens',
    'Pré-visualização da marca de água em tempo real',
    'Aperçu du filigrane en direct',
  ],
  'Could not render this watermark preview. Check the image and try again.': [
    'No se pudo generar esta vista previa de la marca de agua. Comprueba la imagen e inténtalo de nuevo.',
    'Impossibile generare l’anteprima della filigrana. Controlla l’immagine e riprova.',
    'Die Wasserzeichen-Vorschau konnte nicht erstellt werden. Prüfe das Bild und versuche es erneut.',
    'Não foi possível gerar esta pré-visualização da marca de água. Verifique a imagem e tente novamente.',
    'Impossible de générer cet aperçu du filigrane. Vérifiez l’image et réessayez.',
  ],
  'Could not render the page preview. Try another page or PDF.': [
    'No se pudo generar la vista previa de la página. Prueba con otra página o con otro PDF.',
    'Impossibile generare l’anteprima della pagina. Prova con un’altra pagina o un altro PDF.',
    'Die Seitenvorschau konnte nicht erstellt werden. Versuche es mit einer anderen Seite oder PDF-Datei.',
    'Não foi possível gerar a pré-visualização da página. Tente outra página ou outro PDF.',
    'Impossible de générer l’aperçu de la page. Essayez une autre page ou un autre PDF.',
  ],
  'Move watermark to horizontal {x}%, vertical {y}%': [
    'Mover la marca de agua a {x} % en horizontal y {y} % en vertical',
    'Sposta la filigrana al {x}% in orizzontale e al {y}% in verticale',
    'Wasserzeichen horizontal auf {x} % und vertikal auf {y} % verschieben',
    'Mover a marca de água para {x}% na horizontal e {y}% na vertical',
    'Déplacer le filigrane à {x} % horizontalement et {y} % verticalement',
  ],
  'Drag anywhere on the page to move the watermark. Focus the position marker and use arrow keys to move it precisely.': [
    'Arrastra cualquier punto de la página para mover la marca de agua. Enfoca el marcador y usa las flechas para ajustar su posición.',
    'Trascina un punto qualsiasi della pagina per spostare la filigrana. Porta il focus sul marcatore e usa le frecce per regolarne la posizione.',
    'Ziehe an einer beliebigen Stelle der Seite, um das Wasserzeichen zu verschieben. Fokussiere die Positionsmarkierung und passe sie mit den Pfeiltasten an.',
    'Arraste em qualquer ponto da página para mover a marca de água. Foque o marcador de posição e use as setas para a ajustar.',
    'Faites glisser n’importe où sur la page pour déplacer le filigrane. Placez le focus sur le repère et utilisez les flèches pour ajuster sa position.',
  ],
  'No watermark will be added to this page.': [
    'No se añadirá ninguna marca de agua a esta página.',
    'Questa pagina non avrà una filigrana.',
    'Auf dieser Seite wird kein Wasserzeichen hinzugefügt.',
    'Esta página não terá uma marca de água.',
    'Aucun filigrane ne sera ajouté à cette page.',
  ],
  'Choose an image to preview the watermark.': [
    'Elige una imagen para ver la marca de agua.',
    'Scegli un’immagine per vedere la filigrana.',
    'Wähle ein Bild aus, um das Wasserzeichen in der Vorschau zu sehen.',
    'Escolha uma imagem para pré-visualizar a marca de água.',
    'Choisissez une image pour afficher le filigrane en aperçu.',
  ],
  'Enter watermark text to preview the watermark.': [
    'Escribe el texto para ver la marca de agua.',
    'Inserisci il testo per vedere la filigrana.',
    'Gib den Wasserzeichen-Text ein, um die Vorschau zu sehen.',
    'Introduza o texto para pré-visualizar a marca de água.',
    'Saisissez le texte pour afficher le filigrane en aperçu.',
  ],
  'Preparing page preview…': [
    'Preparando la vista previa de la página…',
    'Preparazione dell’anteprima della pagina…',
    'Seitenvorschau wird vorbereitet …',
    'A preparar a pré-visualização da página…',
    'Préparation de l’aperçu de la page…',
  ],
  'Live page number preview': [
    'Vista previa del número de página',
    'Anteprima del numero di pagina',
    'Live-Vorschau der Seitenzahl',
    'Pré-visualização do número da página',
    'Aperçu du numéro de page',
  ],
  'The preview uses the selected number format, position, font size, color, and start number.': [
    'La vista previa muestra el formato, la posición, el tamaño, el color y el número inicial seleccionados.',
    'L’anteprima usa il formato, la posizione, la dimensione, il colore e il numero iniziale selezionati.',
    'Die Vorschau zeigt das gewählte Zahlenformat, die Position, Schriftgröße, Farbe und Startnummer.',
    'A pré-visualização usa o formato, a posição, o tamanho, a cor e o número inicial selecionados.',
    'L’aperçu reprend le format, la position, la taille, la couleur et le numéro de départ sélectionnés.',
  ],
  'This page is excluded from page numbering.': [
    'Esta página está excluida de la numeración.',
    'Questa pagina è esclusa dalla numerazione.',
    'Diese Seite ist von der Nummerierung ausgenommen.',
    'Esta página está excluída da numeração.',
    'Cette page est exclue de la numérotation.',
  ],
  'Could not render this page number preview. Check the settings and try again.': [
    'No se pudo generar esta vista previa del número de página. Comprueba los ajustes e inténtalo de nuevo.',
    'Impossibile generare l’anteprima del numero di pagina. Controlla le impostazioni e riprova.',
    'Die Seitenzahl-Vorschau konnte nicht erstellt werden. Prüfe die Einstellungen und versuche es erneut.',
    'Não foi possível gerar esta pré-visualização do número da página. Verifique as definições e tente novamente.',
    'Impossible de générer cet aperçu du numéro de page. Vérifiez les réglages et réessayez.',
  ],
  'Crop selection': ['Selección de recorte', 'Area di ritaglio', 'Zuschneidebereich', 'Área de recorte', 'Zone de recadrage'],
  'Move crop area': [
    'Mover el área de recorte',
    'Sposta l’area di ritaglio',
    'Zuschneidebereich verschieben',
    'Mover a área de recorte',
    'Déplacer la zone de recadrage',
  ],
  'Resize crop from {side}': [
    'Cambiar el tamaño desde {side}',
    'Ridimensiona dal lato {side}',
    'Zuschnitt an {side} anpassen',
    'Redimensionar pelo lado {side}',
    'Redimensionner depuis {side}',
  ],
  'top-left': ['superior izquierdo', 'in alto a sinistra', 'oben links', 'superior esquerdo', 'en haut à gauche'],
  'top-right': ['superior derecho', 'in alto a destra', 'oben rechts', 'superior direito', 'en haut à droite'],
  'bottom-left': ['inferior izquierdo', 'in basso a sinistra', 'unten links', 'inferior esquerdo', 'en bas à gauche'],
  'bottom-right': ['inferior derecho', 'in basso a destra', 'unten rechts', 'inferior direito', 'en bas à droite'],
  'Use a pointer or touch to draw and drag. Focus a handle and use arrow keys to adjust; hold Shift for 5% steps.': [
    'Usa un puntero o el tacto para dibujar y arrastrar. Enfoca un control y usa las flechas para ajustar; mantén Mayús para mover un 5 %.',
    'Usa il puntatore o il tocco per disegnare e trascinare. Seleziona una maniglia e usa le frecce; tieni premuto Maiusc per passi del 5%.',
    'Zeichne und ziehe mit Maus oder Touch. Fokussiere einen Griff und passe ihn mit den Pfeiltasten an; halte Umschalt für 5-%-Schritte.',
    'Use um ponteiro ou toque para desenhar e arrastar. Foque uma pega e use as setas; mantenha Shift premido para passos de 5%.',
    'Dessinez et faites glisser avec le pointeur ou le toucher. Placez le focus sur une poignée et utilisez les flèches ; maintenez Maj pour avancer de 5 %.',
  ],
};

const locales: Locale[] = ['es', 'it', 'de', 'pt', 'fr'];
const messages: Partial<Record<Locale, Record<string, string>>> = { es: {}, it: {}, de: {}, pt: {}, fr: {} };

for (const [source, translated] of Object.entries(translations)) {
  locales.forEach((locale, index) => {
    messages[locale]![source] = translated[index];
  });
}

export { messages };
