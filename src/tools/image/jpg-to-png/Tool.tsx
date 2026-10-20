import { Converter } from '../_convert/Converter';

export default function Tool() {
  return (
    <Converter
      preset={{
        toolId: 'img-jpg-to-png',
        defaultFormat: 'png',
        expectedFormats: ['jpg', 'jpeg'],
        expectedLabel: 'JPG',
        dropLabel: 'Choose JPG images or drag them here',
        dropHint: 'Convert JPG images to lossless PNG format.',
      }}
    />
  );
}
