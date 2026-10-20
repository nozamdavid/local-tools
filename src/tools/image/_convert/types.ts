export type OutputFormat = 'jpg' | 'png' | 'webp' | 'gif' | 'bmp' | 'avif' | 'jxl';

export type SvgScale = '1x' | '2x' | '4x' | 'custom';

export interface ConverterPreset {
  toolId: string;
  defaultFormat: OutputFormat;
  allowedFormats?: OutputFormat[];
  expectedFormats?: string[];
  expectedLabel?: string;
  hasScaleOption?: boolean;
  dropLabel?: string;
  dropHint?: string;
}

export interface ConvertOptions {
  file: File;
  format: OutputFormat;
  quality: number; // 1 - 100
  lossless?: boolean;
  bgColor: string;
  svgScale?: SvgScale;
  customWidth?: number;
}
