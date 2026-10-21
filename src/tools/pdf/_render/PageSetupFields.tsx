import { useId } from 'react';
import { Field, Select } from '../../../components/Controls';
import type { ImageFormat, Orientation, PageSetup, PageSizeId } from './render';

export interface PageSetupFieldsProps {
  value: PageSetup;
  onChange: (next: PageSetup) => void;
  /** Adds a "match the source" page size choice. */
  allowMatch?: boolean;
  showOrientation?: boolean;
  showMargin?: boolean;
}

const MARGINS = [
  { value: '0', label: 'None' },
  { value: '10', label: 'Narrow (10 mm)' },
  { value: '15', label: 'Normal (15 mm)' },
  { value: '25', label: 'Wide (25 mm)' },
];

export function PageSetupFields({ value, onChange, allowMatch = false, showOrientation = true, showMargin = true }: PageSetupFieldsProps) {
  const sizeId = useId();
  const orientationId = useId();
  const marginId = useId();
  const formatId = useId();

  const sizeOptions = [
    ...(allowMatch ? [{ value: 'match', label: 'Match source' }] : []),
    { value: 'a4', label: 'A4 (210 × 297 mm)' },
    { value: 'letter', label: 'Letter (8.5 × 11 in)' },
  ];

  const margins = MARGINS.some((m) => m.value === String(value.marginMm))
    ? MARGINS
    : [...MARGINS, { value: String(value.marginMm), label: `${value.marginMm} mm` }];

  return (
    <>
      <Field label="Page size">
        <Select
          id={sizeId}
          value={value.size}
          onChange={(e) => onChange({ ...value, size: e.target.value as PageSizeId })}
          options={sizeOptions}
        />
      </Field>

      {showOrientation && value.size !== 'match' && (
        <Field label="Orientation">
          <Select
            id={orientationId}
            value={value.orientation}
            onChange={(e) => onChange({ ...value, orientation: e.target.value as Orientation })}
            options={[
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
          />
        </Field>
      )}

      {showMargin && value.size !== 'match' && (
        <Field label="Margins">
          <Select
            id={marginId}
            value={String(value.marginMm)}
            onChange={(e) => onChange({ ...value, marginMm: Number(e.target.value) })}
            options={margins}
          />
        </Field>
      )}

      <Field label="Image quality" hint="Pages are rendered as images. PNG is sharper but larger.">
        <Select
          id={formatId}
          value={value.format}
          onChange={(e) => onChange({ ...value, format: e.target.value as ImageFormat })}
          options={[
            { value: 'jpeg', label: 'Compact (JPEG)' },
            { value: 'png', label: 'Sharp (PNG)' },
          ]}
        />
      </Field>
    </>
  );
}
