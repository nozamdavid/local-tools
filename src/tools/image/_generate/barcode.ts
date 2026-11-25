import { translate } from '../../../lib/i18n';

export type BarcodeFormat = 'CODE128' | 'EAN13' | 'EAN8' | 'UPC' | 'CODE39' | 'ITF14' | 'MSI' | 'pharmacode';

export interface BarcodeFormatDef {
  id: BarcodeFormat;
  label: string;
  placeholder: string;
  example: string;
  description: string;
}
export const BARCODE_FORMATS: BarcodeFormatDef[] = [
  {
    id: 'CODE128',
    label: 'Code 128 (Standard)',
    placeholder: 'Enter any text or numbers...',
    example: 'LOCONVERT-2026',
    description: 'High-density alphanumeric barcode supporting full ASCII.',
  },
  {
    id: 'EAN13',
    label: 'EAN-13 (Retail Product)',
    placeholder: '12 or 13 digits...',
    example: '4006381333931',
    description: '13-digit standard international retail barcode. 13th check digit is auto-calculated or verified.',
  },
  {
    id: 'EAN8',
    label: 'EAN-8 (Small Package)',
    placeholder: '7 or 8 digits...',
    example: '73513537',
    description: '8-digit compact retail barcode. 8th check digit is auto-calculated or verified.',
  },
  {
    id: 'UPC',
    label: 'UPC-A (North American Retail)',
    placeholder: '11 or 12 digits...',
    example: '036000291452',
    description: '12-digit standard US/Canada retail barcode. 12th check digit is auto-calculated or verified.',
  },
  {
    id: 'CODE39',
    label: 'Code 39',
    placeholder: 'A-Z, 0-9, and - . $ / + % [space]',
    example: 'CODE 39-TEST',
    description: 'Widely used in inventory and government. Alphanumeric uppercase.',
  },
  {
    id: 'ITF14',
    label: 'ITF-14 (Shipping Container)',
    placeholder: '13 or 14 digits...',
    example: '10012345678902',
    description: '14-digit shipping carton barcode with bearer bars. 14th check digit is auto-calculated.',
  },
  {
    id: 'MSI',
    label: 'MSI (Plessey)',
    placeholder: 'Digits only...',
    example: '1234567',
    description: 'Numeric barcode frequently used for warehouse shelves and inventory.',
  },
  {
    id: 'pharmacode',
    label: 'Pharmacode',
    placeholder: 'Number between 3 and 131070...',
    example: '1234',
    description: 'Pharmaceutical packaging control code (single-track binary).',
  },
];

/** Standard Modulo 10 check digit for EAN/UPC/ITF from data digits */
export function computeMod10CheckDigit(digits: string): number {
  const nums = digits.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < nums.length; i++) {
    const posFromRight = nums.length - 1 - i;
    const weight = posFromRight % 2 === 0 ? 3 : 1;
    sum += nums[i] * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export interface BarcodeValidationResult {
  valid: boolean;
  code: string; // The sanitized / normalized / completed code to feed into JsBarcode
  displayCode: string;
  error?: string;
  warning?: string;
  autoFixAvailable?: boolean;
  expectedCheckDigit?: number;
}

export function validateBarcode(format: BarcodeFormat, input: string): BarcodeValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      valid: false,
      code: '',
      displayCode: '',
      error: translate('Please enter a barcode value.'),
    };
  }

  switch (format) {
    case 'EAN13': {
      const clean = trimmed.replace(/\s+/g, '');
      if (!/^\d+$/.test(clean)) {
        return {
          valid: false,
          code: clean,
          displayCode: clean,
          error: translate('EAN-13 must contain only numeric digits (0-9).'),
        };
      }
      if (clean.length === 12) {
        const check = computeMod10CheckDigit(clean);
        return {
          valid: true,
          code: clean + check,
          displayCode: clean + check,
          warning: translate('12 digits entered. Auto-calculated check digit: {digit}', { digit: check }),
        };
      }
      if (clean.length === 13) {
        const body = clean.slice(0, 12);
        const expected = computeMod10CheckDigit(body);
        const actual = Number(clean[12]);
        if (actual !== expected) {
          return {
            valid: false,
            code: clean,
            displayCode: clean,
            error: translate('Invalid EAN-13 check digit "{actual}". Expected check digit is "{expected}".', { actual, expected }),
            autoFixAvailable: true,
            expectedCheckDigit: expected,
          };
        }
        return { valid: true, code: clean, displayCode: clean };
      }
      return {
        valid: false,
        code: clean,
        displayCode: clean,
        error: translate('EAN-13 requires exactly 12 or 13 digits (received {count}).', { count: clean.length }),
      };
    }

    case 'EAN8': {
      const clean = trimmed.replace(/\s+/g, '');
      if (!/^\d+$/.test(clean)) {
        return {
          valid: false,
          code: clean,
          displayCode: clean,
          error: translate('EAN-8 must contain only numeric digits (0-9).'),
        };
      }
      if (clean.length === 7) {
        const check = computeMod10CheckDigit(clean);
        return {
          valid: true,
          code: clean + check,
          displayCode: clean + check,
          warning: translate('7 digits entered. Auto-calculated check digit: {digit}', { digit: check }),
        };
      }
      if (clean.length === 8) {
        const body = clean.slice(0, 7);
        const expected = computeMod10CheckDigit(body);
        const actual = Number(clean[7]);
        if (actual !== expected) {
          return {
            valid: false,
            code: clean,
            displayCode: clean,
            error: translate('Invalid EAN-8 check digit "{actual}". Expected check digit is "{expected}".', { actual, expected }),
            autoFixAvailable: true,
            expectedCheckDigit: expected,
          };
        }
        return { valid: true, code: clean, displayCode: clean };
      }
      return {
        valid: false,
        code: clean,
        displayCode: clean,
        error: translate('EAN-8 requires exactly 7 or 8 digits (received {count}).', { count: clean.length }),
      };
    }

    case 'UPC': {
      const clean = trimmed.replace(/\s+/g, '');
      if (!/^\d+$/.test(clean)) {
        return {
          valid: false,
          code: clean,
          displayCode: clean,
          error: translate('UPC-A must contain only numeric digits (0-9).'),
        };
      }
      if (clean.length === 11) {
        const check = computeMod10CheckDigit(clean);
        return {
          valid: true,
          code: clean + check,
          displayCode: clean + check,
          warning: translate('11 digits entered. Auto-calculated check digit: {digit}', { digit: check }),
        };
      }
      if (clean.length === 12) {
        const body = clean.slice(0, 11);
        const expected = computeMod10CheckDigit(body);
        const actual = Number(clean[11]);
        if (actual !== expected) {
          return {
            valid: false,
            code: clean,
            displayCode: clean,
            error: translate('Invalid UPC-A check digit "{actual}". Expected check digit is "{expected}".', { actual, expected }),
            autoFixAvailable: true,
            expectedCheckDigit: expected,
          };
        }
        return { valid: true, code: clean, displayCode: clean };
      }
      return {
        valid: false,
        code: clean,
        displayCode: clean,
        error: translate('UPC-A requires exactly 11 or 12 digits (received {count}).', { count: clean.length }),
      };
    }

    case 'ITF14': {
      const clean = trimmed.replace(/\s+/g, '');
      if (!/^\d+$/.test(clean)) {
        return {
          valid: false,
          code: clean,
          displayCode: clean,
          error: translate('ITF-14 must contain only numeric digits (0-9).'),
        };
      }
      if (clean.length === 13) {
        const check = computeMod10CheckDigit(clean);
        return {
          valid: true,
          code: clean + check,
          displayCode: clean + check,
          warning: translate('13 digits entered. Auto-calculated check digit: {digit}', { digit: check }),
        };
      }
      if (clean.length === 14) {
        const body = clean.slice(0, 13);
        const expected = computeMod10CheckDigit(body);
        const actual = Number(clean[13]);
        if (actual !== expected) {
          return {
            valid: false,
            code: clean,
            displayCode: clean,
            error: translate('Invalid ITF-14 check digit "{actual}". Expected check digit is "{expected}".', { actual, expected }),
            autoFixAvailable: true,
            expectedCheckDigit: expected,
          };
        }
        return { valid: true, code: clean, displayCode: clean };
      }
      return {
        valid: false,
        code: clean,
        displayCode: clean,
        error: translate('ITF-14 requires exactly 13 or 14 digits (received {count}).', { count: clean.length }),
      };
    }

    case 'CODE39': {
      const upper = trimmed.toUpperCase();
      if (!/^[0-9A-Z\-. $/+%]+$/.test(upper)) {
        return {
          valid: false,
          code: upper,
          displayCode: upper,
          error: translate('Code 39 only allows uppercase letters A-Z, numbers 0-9, and characters: - . $ / + % [space]'),
        };
      }
      return { valid: true, code: upper, displayCode: upper };
    }

    case 'pharmacode': {
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 3 || num > 131070 || String(num) !== trimmed) {
        return {
          valid: false,
          code: trimmed,
          displayCode: trimmed,
          error: translate('Pharmacode must be an integer between 3 and 131070.'),
        };
      }
      return { valid: true, code: String(num), displayCode: String(num) };
    }

    case 'MSI': {
      const clean = trimmed.replace(/\s+/g, '');
      if (!/^\d+$/.test(clean)) {
        return {
          valid: false,
          code: clean,
          displayCode: clean,
          error: translate('MSI Plessey must contain only numeric digits.'),
        };
      }
      return { valid: true, code: clean, displayCode: clean };
    }

    case 'CODE128':
    default: {
      // Full ASCII allowed
      return { valid: true, code: trimmed, displayCode: trimmed };
    }
  }
}
