import { Box, FileText, Film, Files, Image, type LucideIcon } from 'lucide-react';
import type { Media } from '../tools/registry';
import { translate, type Locale } from '../lib/i18n';

export interface MediaInfo {
  media: Media;
  /** Short nav label */
  label: string;
  /** Section title */
  title: string;
  description: string;
  path: string;
  icon: LucideIcon;
}

/** Display order is the order of this list. */
export const MEDIA_LIST: MediaInfo[] = [
  {
    media: 'image',
    label: 'Image',
    title: 'Image tools',
    description: 'Resize, compress, convert, edit and generate images.',
    path: '/image',
    icon: Image,
  },
  {
    media: 'pdf',
    label: 'PDF',
    title: 'PDF tools',
    description: 'Merge, split, compress, convert, edit, sign and protect PDFs.',
    path: '/pdf',
    icon: FileText,
  },
  {
    media: 'video',
    label: 'Video',
    title: 'Video & audio tools',
    description: 'Trim, compress, convert, subtitle and transcribe videos.',
    path: '/video',
    icon: Film,
  },
  {
    media: 'file',
    label: 'File',
    title: 'File & data tools',
    description: 'Convert formats, view spreadsheets, inspect and rename files.',
    path: '/file',
    icon: Files,
  },
  {
    media: '3d',
    label: '3D',
    title: '3D tools',
    description: 'Convert, inspect, simplify, transform, split and merge 3D models.',
    path: '/3d',
    icon: Box,
  },
];

export const MEDIA_INFO = Object.fromEntries(MEDIA_LIST.map((m) => [m.media, m])) as Record<Media, MediaInfo>;

export function localizeMediaInfo(info: MediaInfo, locale?: Locale): MediaInfo {
  const source = MEDIA_INFO[info.media] ?? info;
  return {
    ...source,
    label: translate(source.label, undefined, locale),
    title: translate(source.title, undefined, locale),
    description: translate(source.description, undefined, locale),
  };
}

export function getMediaInfo(media: Media, locale?: Locale): MediaInfo {
  return localizeMediaInfo(MEDIA_INFO[media], locale);
}
