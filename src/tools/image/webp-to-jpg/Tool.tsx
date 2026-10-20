import { Converter } from '../_convert/Converter';

export default function Tool() {
  return (
    <Converter
      preset={{
        toolId: 'img-webp-to-jpg',
        defaultFormat: 'jpg',
        expectedFormats: ['webp'],
        expectedLabel: 'WEBP',
        dropLabel: 'Choose WEBP images or drag them here',
        dropHint: 'Convert WebP images to universal JPG format. 100% private.',
      }}
    />
  );
}
