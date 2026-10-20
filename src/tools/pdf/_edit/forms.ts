import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
} from 'pdf-lib';
import type { FormFieldInfo } from './types';

/**
 * Extracts all form fields from a PDF document.
 * Returns an empty array if the document does not contain an AcroForm.
 */
export function extractFormFields(doc: PDFDocument): FormFieldInfo[] {
  try {
    const form = doc.getForm();
    const fields = form.getFields();
    const results: FormFieldInfo[] = [];

    for (const field of fields) {
      const name = field.getName();

      if (field instanceof PDFTextField) {
        results.push({
          name,
          type: 'text',
          isMultiline: field.isMultiline(),
          isPassword: field.isPassword(),
          isReadOnly: field.isReadOnly(),
          value: field.getText() ?? '',
        });
      } else if (field instanceof PDFCheckBox) {
        results.push({
          name,
          type: 'checkbox',
          isReadOnly: field.isReadOnly(),
          value: field.isChecked(),
        });
      } else if (field instanceof PDFRadioGroup) {
        results.push({
          name,
          type: 'radio',
          isReadOnly: field.isReadOnly(),
          value: field.getSelected() ?? '',
          options: field.getOptions(),
        });
      } else if (field instanceof PDFDropdown) {
        results.push({
          name,
          type: 'dropdown',
          isReadOnly: field.isReadOnly(),
          value: field.getSelected()[0] ?? '',
          options: field.getOptions(),
        });
      } else if (field instanceof PDFOptionList) {
        results.push({
          name,
          type: 'list',
          isReadOnly: field.isReadOnly(),
          value: field.getSelected(),
          options: field.getOptions(),
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Applies values to form fields in a PDF document and optionally flattens them.
 */
export async function applyFormValues(
  doc: PDFDocument,
  values: Record<string, string | boolean | string[]>,
  flatten = false
): Promise<void> {
  const form = doc.getForm();

  for (const [name, val] of Object.entries(values)) {
    try {
      const field = form.getField(name);

      if (field instanceof PDFTextField && typeof val === 'string') {
        field.setText(val);
      } else if (field instanceof PDFCheckBox && typeof val === 'boolean') {
        if (val) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup && typeof val === 'string') {
        if (val) field.select(val);
      } else if (field instanceof PDFDropdown && typeof val === 'string') {
        if (val) field.select(val);
      } else if (field instanceof PDFOptionList) {
        const listVal = Array.isArray(val) ? val : [String(val)];
        field.select(listVal);
      }
    } catch {
      // Ignore errors for individual fields that may be missing or locked
    }
  }

  try {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
  } catch {
    // Continue if font embedding or appearance update is not needed or fails
  }

  if (flatten) {
    try {
      form.flatten();
    } catch {
      // Ignore if flattening unsupported
    }
  }
}
