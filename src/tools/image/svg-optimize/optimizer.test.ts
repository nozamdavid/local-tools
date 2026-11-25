import { describe, expect, it } from 'vitest';
import { createSafeSvgPreview, getSvgSizeChange, hasExternalResourceReferences, optimizeSvgText } from './optimizer';

describe('SVG optimizer', () => {
  it('keeps the viewBox, referenced IDs, and appearance-critical paint attributes by default', async () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><defs><linearGradient id="brand-gradient"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><path id="mark" d="M0 0h100v50H0z" fill="url(#brand-gradient)" stroke="#123456" stroke-width="2"/></svg>';

    const output = await optimizeSvgText(input);

    expect(output).toContain('viewBox="0 0 100 50"');
    expect(output).toContain('id="brand-gradient"');
    expect(output).toContain('id="mark"');
    expect(output).toContain('fill="url(#brand-gradient)"');
    expect(output).toContain('stroke="#123456"');
    expect(output).toContain('stroke-width="2"');
  });

  it('reports malformed XML as a clear input error', async () => {
    await expect(optimizeSvgText('<svg><path></svg>')).rejects.toThrow(/malformed or unsupported/i);
  });

  it('preserves external stylesheet instructions in output and withholds the unsafe preview', async () => {
    const input =
      '<?xml-stylesheet type="text/css" href="https://example.invalid/style.css"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>@import url("https://example.invalid/theme.css");</style><rect width="1" height="1"/></svg>';

    const output = await optimizeSvgText(input);

    expect(output).toContain('xml-stylesheet');
    expect(output).toContain('@import');
    expect(output).toContain('https://example.invalid/theme.css');
    expect(hasExternalResourceReferences(input)).toBe(true);
    expect(createSafeSvgPreview(input)).toBeNull();
    expect(hasExternalResourceReferences('<svg><rect fill="url(#local-gradient)"/></svg>')).toBe(false);
    expect(hasExternalResourceReferences('<svg><image href="&#x68;ttps://example.invalid/image.png"/></svg>')).toBe(true);
  });

  it('does not call larger or equal results smaller', () => {
    expect(getSvgSizeChange(100, 80)).toEqual({ status: 'smaller', difference: 20 });
    expect(getSvgSizeChange(100, 100)).toEqual({ status: 'same', difference: 0 });
    expect(getSvgSizeChange(100, 120)).toEqual({ status: 'larger', difference: 20 });
  });
});
