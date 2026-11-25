import { describe, expect, it } from 'vitest';
import { Crop, LockKeyhole, Move3d, Scissors, Table2 } from 'lucide-react';
import { TOOL_METAS } from '../tools/registry';
import { getMediaInfo } from './media';
import { getToolIcon, TOOL_ICONS } from './tool-icons';

describe('tool icons', () => {
  it('maps every registered tool ID exactly once', () => {
    expect(Object.keys(TOOL_ICONS).sort()).toEqual(TOOL_METAS.map(({ id }) => id).sort());
  });

  it('uses action icons across all five media families', () => {
    expect(TOOL_ICONS['img-crop']).toBe(Crop);
    expect(TOOL_ICONS.trim).toBe(Scissors);
    expect(TOOL_ICONS['pdf-protect']).toBe(LockKeyhole);
    expect(TOOL_ICONS['csv-viewer']).toBe(Table2);
    expect(TOOL_ICONS['three-transform']).toBe(Move3d);
  });

  it('falls back to the media icon for an unknown tool ID', () => {
    expect(getToolIcon({ id: 'unknown-tool', media: 'image' })).toBe(getMediaInfo('image').icon);
  });
});
