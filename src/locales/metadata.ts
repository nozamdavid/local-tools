import type { Locale } from '../lib/i18n';

const description = 'Free image, PDF, video and file tools that run entirely in your browser. Nothing is uploaded.';

export const messages: Partial<Record<Locale, Record<string, string>>> = {
  es: {
    [description]:
      'Herramientas gratuitas para imágenes, PDF, vídeos y archivos que funcionan íntegramente en tu navegador. No se sube ningún archivo.',
  },
  it: {
    [description]:
      'Strumenti gratuiti per immagini, PDF, video e file che funzionano interamente nel browser. Nessun file viene caricato online.',
  },
  de: {
    [description]:
      'Kostenlose Werkzeuge für Bilder, PDF, Videos und Dateien, die vollständig in deinem Browser laufen. Es wird nichts hochgeladen.',
  },
  pt: {
    [description]: 'Ferramentas gratuitas para imagens, PDF, vídeos e ficheiros que funcionam inteiramente no navegador. Nada é enviado.',
  },
  fr: {
    [description]:
      'Des outils gratuits pour les images, PDF, vidéos et fichiers, entièrement dans votre navigateur. Aucun fichier n’est envoyé.',
  },
};
