import { Converter } from '../_convert/Converter';

export default function Tool() {
  return (
    <Converter
      preset={{
        toolId: 'img-convert',
        defaultFormat: 'jpg',
        dropLabel: 'Choose images or drag them here',
        dropHint: 'Convert images to JPG, PNG, WEBP, GIF, BMP or AVIF. 100% private.',
      }}
    />
  );
}
