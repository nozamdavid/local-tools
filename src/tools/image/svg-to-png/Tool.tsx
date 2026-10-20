import { Converter } from '../_convert/Converter';

export default function Tool() {
  return (
    <Converter
      preset={{
        toolId: 'img-svg-to-png',
        defaultFormat: 'png',
        expectedFormats: ['svg'],
        expectedLabel: 'SVG',
        hasScaleOption: true,
        dropLabel: 'Choose SVG files or drag them here',
        dropHint: 'Rasterise vector SVGs to crisp PNGs at any scale. 100% private.',
      }}
    />
  );
}
