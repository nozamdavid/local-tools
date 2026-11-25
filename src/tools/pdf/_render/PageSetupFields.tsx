import { useId } from 'react';
import { Field, Select } from '../../../components/Controls';
import type { ImageFormat, Orientation, PageSetup, PageSizeId } from './render';
import { useI18n } from '../../../lib/i18n';

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
  const { t } = useI18n();
  const sizeId = useId();
  const orientationId = useId();
  const marginId = useId();
  const formatId = useId();

  const sizeOptions = [
    ...(allowMatch ? [{ value: 'match', label: t('Match source') }] : []),
    { value: 'a4', label: t('A4 (210 × 297 mm)') },
    { value: 'letter', label: t('Letter (8.5 × 11 in)') },
  ];

  const margins = MARGINS.some((m) => m.value === String(value.marginMm))
    ? MARGINS.map((margin) => ({ ...margin, label: t(margin.label) }))
    : [
        ...MARGINS.map((margin) => ({ ...margin, label: t(margin.label) })),
        { value: String(value.marginMm), label: `${value.marginMm} mm` },
      ];

  return (
    <>
      <Field label={t('Page size')}>
        <Select
          id={sizeId}
          value={value.size}
          onChange={(e) => onChange({ ...value, size: e.target.value as PageSizeId })}
          options={sizeOptions}
        />
      </Field>

      {showOrientation && value.size !== 'match' && (
        <Field label={t('Orientation')}>
          <Select
            id={orientationId}
            value={value.orientation}
            onChange={(e) => onChange({ ...value, orientation: e.target.value as Orientation })}
            options={[
              { value: 'portrait', label: t('Portrait') },
              { value: 'landscape', label: t('Landscape') },
            ]}
          />
        </Field>
      )}

      {showMargin && value.size !== 'match' && (
        <Field label={t('Margins')}>
          <Select
            id={marginId}
            value={String(value.marginMm)}
            onChange={(e) => onChange({ ...value, marginMm: Number(e.target.value) })}
            options={margins}
          />
        </Field>
      )}

      <Field label={t('Image quality')} hint={t('Pages are rendered as images. PNG is sharper but larger.')}>
        <Select
          id={formatId}
          value={value.format}
          onChange={(e) => onChange({ ...value, format: e.target.value as ImageFormat })}
          options={[
            { value: 'jpeg', label: t('Compact (JPEG)') },
            { value: 'png', label: t('Sharp (PNG)') },
          ]}
        />
      </Field>
    </>
  );
}
