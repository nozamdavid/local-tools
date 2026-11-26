import type { Locale } from '../lib/i18n';

// Spanish, Italian, German, Portuguese, French.
const translations: Record<string, [string, string, string, string, string]> = {
  'Editing canvas': ['Lienzo de edición', 'Area di modifica', 'Bearbeitungsfläche', 'Tela de edição', 'Zone de retouche'],
  'Editing canvas. Arrow keys move the selected layer by one pixel. Hold Shift to move by ten. Delete removes the selected layer.': [
    'Lienzo de edición. Las flechas mueven la capa seleccionada un píxel. Mantén Mayús para moverla diez. Supr elimina la capa seleccionada.',
    'Area di modifica. I tasti freccia spostano il livello selezionato di un pixel. Tieni premuto Maiusc per spostarlo di dieci. Canc elimina il livello selezionato.',
    'Bearbeitungsfläche. Die Pfeiltasten verschieben die ausgewählte Ebene um ein Pixel. Halte die Umschalttaste gedrückt, um sie um zehn Pixel zu verschieben. Entf löscht die ausgewählte Ebene.',
    'Tela de edição. As setas movem a camada selecionada um píxel. Mantém Shift premido para mover dez. Delete elimina a camada selecionada.',
    'Zone de retouche. Les flèches déplacent le calque sélectionné d’un pixel. Maintenez Maj pour le déplacer de dix pixels. Suppr supprime le calque sélectionné.',
  ],
  'Select layer': ['Seleccionar capa', 'Seleziona livello', 'Ebene auswählen', 'Selecionar camada', 'Sélectionner un calque'],
  Highlighter: ['Resaltador', 'Evidenziatore', 'Textmarker', 'Marcador', 'Surligneur'],
  Redact: ['Ocultar', 'Oscura', 'Schwärzen', 'Ocultar', 'Masquer'],
  Redaction: ['Ocultación', 'Oscuramento', 'Schwärzung', 'Ocultação', 'Masquage'],
  '{tool} {number}': ['{tool} {number}', '{tool} {number}', '{tool} {number}', '{tool} {number}', '{tool} {number}'],
  'Export settings': [
    'Ajustes de exportación',
    'Impostazioni di esportazione',
    'Exporteinstellungen',
    'Definições de exportação',
    'Réglages d’exportation',
  ],
  'Exit editor': ['Salir del editor', 'Esci dall’editor', 'Editor verlassen', 'Sair do editor', 'Quitter l’éditeur'],
  'Canvas zoom': [
    'Zoom del lienzo',
    'Zoom dell’area di lavoro',
    'Zoom der Arbeitsfläche',
    'Zoom da área de trabalho',
    'Zoom de la zone de travail',
  ],
  'Fit to view': ['Ajustar a la vista', 'Adatta alla vista', 'An Ansicht anpassen', 'Ajustar à vista', 'Adapter à la vue'],
  'Opening image…': ['Abriendo imagen…', 'Apertura dell’immagine…', 'Bild wird geöffnet…', 'A abrir imagem…', 'Ouverture de l’image…'],
  'Saving edits…': [
    'Guardando cambios…',
    'Salvataggio delle modifiche…',
    'Änderungen werden gespeichert…',
    'A guardar alterações…',
    'Enregistrement des modifications…',
  ],
  'Your latest edits could not be saved for reopening.': [
    'No se han podido guardar los últimos cambios para volver a abrirlos.',
    'Non è stato possibile salvare le ultime modifiche per la riapertura.',
    'Die letzten Änderungen konnten nicht zum erneuten Öffnen gespeichert werden.',
    'Não foi possível guardar as últimas alterações para as reabrir.',
    'Impossible d’enregistrer les dernières modifications pour une réouverture.',
  ],
  'Keep editing': ['Seguir editando', 'Continua a modificare', 'Weiter bearbeiten', 'Continuar a editar', 'Continuer la modification'],
  'Retry save': [
    'Volver a intentar guardar',
    'Riprova a salvare',
    'Speichern erneut versuchen',
    'Tentar guardar novamente',
    'Réessayer l’enregistrement',
  ],
  'Exit without saving edits': [
    'Salir sin guardar los cambios',
    'Esci senza salvare le modifiche',
    'Ohne Speichern verlassen',
    'Sair sem guardar as alterações',
    'Quitter sans enregistrer',
  ],
  Shape: ['Forma', 'Forma', 'Form', 'Forma', 'Forme'],
  Arrow: ['Flecha', 'Freccia', 'Pfeil', 'Seta', 'Flèche'],
  'Drag on the canvas to place a shape.': [
    'Arrastra sobre el lienzo para colocar una forma.',
    'Trascina sull’area di lavoro per inserire una forma.',
    'Ziehe auf der Arbeitsfläche, um eine Form zu platzieren.',
    'Arraste na área de trabalho para colocar uma forma.',
    'Faites glisser sur la zone de travail pour placer une forme.',
  ],
  'Add shape at centre': [
    'Añadir forma en el centro',
    'Aggiungi forma al centro',
    'Form mittig hinzufügen',
    'Adicionar forma ao centro',
    'Ajouter une forme au centre',
  ],
  'Drag a black box over the area to hide. Copy and Download flatten the box into the image.': [
    'Arrastra un rectángulo negro sobre la zona que quieras ocultar. Al copiar o descargar, el rectángulo se integra en la imagen.',
    'Trascina un riquadro nero sull’area da nascondere. Quando copi o scarichi, il riquadro viene integrato nell’immagine.',
    'Ziehe ein schwarzes Rechteck über den zu verdeckenden Bereich. Beim Kopieren und Herunterladen wird es in das Bild eingebettet.',
    'Arraste um retângulo preto sobre a área a ocultar. Ao copiar ou descarregar, o retângulo é incorporado na imagem.',
    'Tracez un rectangle noir sur la zone à masquer. Lors de la copie ou du téléchargement, il est intégré à l’image.',
  ],
  'Add redaction at centre': [
    'Añadir recuadro negro en el centro',
    'Aggiungi riquadro nero al centro',
    'Schwärzung mittig hinzufügen',
    'Adicionar ocultação ao centro',
    'Ajouter un masque au centre',
  ],
  'Add text, draw, or place a shape to create a layer.': [
    'Añade texto, dibuja o coloca una forma para crear una capa.',
    'Aggiungi testo, disegna o inserisci una forma per creare un livello.',
    'Füge Text oder eine Form hinzu oder zeichne, um eine Ebene zu erstellen.',
    'Adicione texto, desenhe ou coloque uma forma para criar uma camada.',
    'Ajoutez du texte, dessinez ou placez une forme pour créer un calque.',
  ],
};

const locales = ['es', 'it', 'de', 'pt', 'fr'] as const;

export const messages = Object.fromEntries(
  locales.map((locale, index) => [
    locale,
    Object.fromEntries(Object.entries(translations).map(([source, values]) => [source, values[index]])),
  ]),
) as Partial<Record<Locale, Record<string, string>>>;
