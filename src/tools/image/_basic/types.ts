import type { EncodableMime } from '../../../lib/image';

export interface ImageDimension {
  width: number;
  height: number;
}

export interface FormatOption {
  mime: EncodableMime;
  ext: string;
  label: string;
}

export const FORMAT_OPTIONS: FormatOption[] = [
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' },
  { mime: 'image/png', ext: 'png', label: 'PNG' },
  { mime: 'image/webp', ext: 'webp', label: 'WEBP' },
];
