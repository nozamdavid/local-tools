import { Converter } from '../_convert/Converter';

export default function Tool() {
  return (
    <Converter
      preset={{
        toolId: 'img-heic-to-jpg',
        defaultFormat: 'jpg',
        allowedFormats: ['jpg', 'png', 'webp'],
        expectedFormats: ['heic', 'heif'],
        expectedLabel: 'HEIC/HEIF',
        dropLabel: 'Choose HEIC photos or drag them here',
        dropHint: 'Convert Apple iPhone HEIC and HEIF photos to JPG.',
      }}
    />
  );
}
