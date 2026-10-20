import { Converter } from '../_convert/Converter';

export default function Tool() {
  return (
    <Converter
      preset={{
        toolId: 'img-image-to-webp',
        defaultFormat: 'webp',
        dropLabel: 'Choose images or drag them here',
        dropHint: 'Convert JPG, PNG, GIF, BMP or SVG to lightweight WEBP. 100% private.',
      }}
    />
  );
}
