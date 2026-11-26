import type { Locale } from '../lib/i18n';

// Spanish, Italian, German, Portuguese, French.
const translations: Record<string, [string, string, string, string, string]> = {
  Editors: ['Editores', 'Editor', 'Editoren', 'Editores', 'Éditeurs'],
  'Recent files': ['Archivos recientes', 'File recenti', 'Zuletzt verwendete Dateien', 'Ficheiros recentes', 'Fichiers récents'],
  'Clear recent files': [
    'Borrar archivos recientes',
    'Cancella i file recenti',
    'Zuletzt verwendete Dateien löschen',
    'Limpar ficheiros recentes',
    'Effacer les fichiers récents',
  ],
  'Clear all recent files and their saved editor drafts?': [
    '¿Borrar todos los archivos recientes y sus borradores guardados?',
    'Cancellare tutti i file recenti e le relative bozze salvate?',
    'Alle zuletzt verwendeten Dateien und ihre gespeicherten Entwürfe löschen?',
    'Limpar todos os ficheiros recentes e os respetivos rascunhos guardados?',
    'Effacer tous les fichiers récents et leurs brouillons enregistrés ?',
  ],
  'Reopen {name}': ['Volver a abrir {name}', 'Riapri {name}', '{name} erneut öffnen', 'Reabrir {name}', 'Rouvrir {name}'],
  'Remove {name} from recent files': [
    'Quitar {name} de los archivos recientes',
    'Rimuovi {name} dai file recenti',
    '{name} aus den zuletzt verwendeten Dateien entfernen',
    'Remover {name} dos ficheiros recentes',
    'Retirer {name} des fichiers récents',
  ],
  'Originals and editor drafts stay in this browser. Remove or clear entries to delete their stored copies and drafts.': [
    'Los originales y los borradores se quedan en este navegador. Quita una entrada o borra la lista para eliminar las copias y los borradores guardados.',
    'Gli originali e le bozze rimangono in questo browser. Rimuovi una voce o cancella l’elenco per eliminare le copie e le bozze salvate.',
    'Originale und Entwürfe bleiben in diesem Browser. Entferne einen Eintrag oder lösche die Liste, um gespeicherte Kopien und Entwürfe zu löschen.',
    'Os originais e os rascunhos ficam neste navegador. Remove uma entrada ou limpa a lista para eliminar as cópias e os rascunhos guardados.',
    'Les originaux et les brouillons restent dans ce navigateur. Retirez une entrée ou effacez la liste pour supprimer les copies et les brouillons enregistrés.',
  ],
  'Could not update recent files. Try again.': [
    'No se pudieron actualizar los archivos recientes. Inténtalo de nuevo.',
    'Impossibile aggiornare i file recenti. Riprova.',
    'Die zuletzt verwendeten Dateien konnten nicht aktualisiert werden. Versuche es erneut.',
    'Não foi possível atualizar os ficheiros recentes. Tenta novamente.',
    'Impossible de mettre à jour les fichiers récents. Réessayez.',
  ],
};

const locales = ['es', 'it', 'de', 'pt', 'fr'] as const;
export const messages = Object.fromEntries(
  locales.map((locale, index) => [locale, Object.fromEntries(Object.entries(translations).map(([key, values]) => [key, values[index]]))]),
) as Partial<Record<Locale, Record<string, string>>>;
