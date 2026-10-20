import { Converter } from '../_convert/Converter';

export default function Tool() {
  return (
    <Converter
      preset={{
        toolId: 'img-bulk-convert',
        defaultFormat: 'jpg',
        dropLabel: 'Choose multiple images or drag them here',
        dropHint: 'Batch convert dozens or hundreds of images at once and download as a ZIP. 100% private.',
      }}
    />
  );
}
