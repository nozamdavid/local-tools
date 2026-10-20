import { Converter } from '../_convert/Converter';

export default function Tool() {
  return (
    <Converter
      preset={{
        toolId: 'img-png-to-jpg',
        defaultFormat: 'jpg',
        expectedFormats: ['png'],
        expectedLabel: 'PNG',
        dropLabel: 'Choose PNG images or drag them here',
        dropHint: 'Convert PNG images to standard JPG format. 100% private.',
      }}
    />
  );
}
