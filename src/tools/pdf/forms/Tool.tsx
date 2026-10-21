import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Controls';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ToolPage } from '../../../components/ToolPage';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { getToolMeta } from '../../registry';
import { applyFormValues, extractFormFields } from '../_edit/forms';
import type { FormFieldInfo } from '../_edit/types';
import { usePdfSource } from '../_thumbs/usePdfSource';
import styles from './Tool.module.css';

export default function FormsTool() {
  const meta = getToolMeta('pdf-forms');
  const source = usePdfSource();
  const job = useJob();
  const navigate = useNavigate();

  const [loadingFields, setLoadingFields] = useState(false);
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string | boolean | string[]>>({});
  const [flatten, setFlatten] = useState(true);

  // When a document is loaded, extract its form fields
  useEffect(() => {
    let active = true;

    if (source.doc && source.file) {
      setLoadingFields(true);
      source
        .loadForEditing()
        .then((pdfDoc) => {
          if (!active) return;
          const extracted = extractFormFields(pdfDoc);
          setFields(extracted);

          const initialValues: Record<string, string | boolean | string[]> = {};
          for (const f of extracted) {
            initialValues[f.name] = f.value;
          }
          setFormValues(initialValues);
        })
        .catch(() => {
          if (active) setFields([]);
        })
        .finally(() => {
          if (active) setLoadingFields(false);
        });
    } else {
      setFields(null);
      setFormValues({});
    }

    return () => {
      active = false;
    };
  }, [source.doc, source.file, source.loadForEditing]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setFields(null);
    setFormValues({});
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    job.reset();
    setFields(null);
    setFormValues({});
  };

  const handleTextChange = (name: string, val: string) => {
    setFormValues((prev) => ({ ...prev, [name]: val }));
  };

  const handleCheckChange = (name: string, checked: boolean) => {
    setFormValues((prev) => ({ ...prev, [name]: checked }));
  };

  const handleRadioChange = (name: string, val: string) => {
    setFormValues((prev) => ({ ...prev, [name]: val }));
  };

  const handleDropdownChange = (name: string, val: string) => {
    setFormValues((prev) => ({ ...prev, [name]: val }));
  };

  const handleListChange = (name: string, selectedOptions: HTMLCollectionOf<HTMLOptionElement>) => {
    const selected: string[] = [];
    for (let i = 0; i < selectedOptions.length; i++) {
      if (selectedOptions[i].selected) {
        selected.push(selectedOptions[i].value);
      }
    }
    setFormValues((prev) => ({ ...prev, [name]: selected }));
  };

  const handleSave = () => {
    job.run(async (setProgress) => {
      setProgress(0.15);
      const pdf = await source.loadForEditing();
      setProgress(0.4);

      await applyFormValues(pdf, formValues, flatten);
      setProgress(0.8);

      const bytes = await pdf.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-filled.pdf` : 'filled.pdf';
  const total = source.pages.length;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Enumerate and fill text fields, checkboxes, radio buttons, and dropdowns. 100% in-browser."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{source.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.result ? (
            <PdfPreview blob={job.result} filename={outName} pageCount={total} onReset={handleReset} />
          ) : (
            <div>
              <div className={styles.topRow}>
                <div className="meta-chips">
                  <span className="meta-chip">
                    File: <strong>{file.name}</strong>
                  </span>
                  <span className="meta-chip">
                    Size: <strong>{formatBytes(file.size)}</strong>
                  </span>
                  {source.doc && (
                    <span className="meta-chip">
                      Pages: <strong>{total}</strong>
                    </span>
                  )}
                </div>
                <Button variant="secondary" onClick={handleReset}>
                  Change PDF
                </Button>
              </div>

              <div className={styles.noticeBanner}>
                <strong>AcroForm field editor:</strong> Edit fillable PDF form fields directly in your browser. Choose whether to keep
                fields editable or flatten them permanently.
              </div>

              {(source.loading || loadingFields) && <p className={styles.status}>Scanning PDF for interactive form fields…</p>}

              {/* No Form Fields Found Screen */}
              {!loadingFields && fields && fields.length === 0 && (
                <div className={styles.noFieldsBox}>
                  <div className={styles.noFieldsIcon}>🧾</div>
                  <h3 className={styles.noFieldsTitle}>No Interactive Form Fields Found</h3>
                  <p className={styles.noFieldsDesc}>
                    This document does not contain fillable AcroForm fields. It may be a scanned document, a flat static form, or an
                    XML-based XFA form.
                  </p>
                  <p className={styles.noFieldsDesc}>
                    If you need to fill out this document, you can use the <strong>Edit PDF</strong> tool to place text and checkmark
                    annotations directly onto the pages.
                  </p>
                  <Button onClick={() => navigate('/pdf/edit')}>Go to Edit PDF Tool</Button>
                </div>
              )}

              {/* Form Fields Present */}
              {!loadingFields && fields && fields.length > 0 && (
                <div className={styles.formsContainer}>
                  <div className={styles.fieldsCard}>
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Form Fields ({fields.length})</h3>

                    {fields.map((field) => {
                      const val = formValues[field.name];

                      return (
                        <div key={field.name} className={styles.fieldItem}>
                          <label className={styles.fieldLabel}>
                            {field.name}
                            {field.isReadOnly && <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}> (read-only)</span>}
                          </label>

                          {field.type === 'text' &&
                            (field.isMultiline ? (
                              <textarea
                                className={styles.textarea}
                                value={typeof val === 'string' ? val : ''}
                                onChange={(e) => handleTextChange(field.name, e.target.value)}
                                disabled={field.isReadOnly}
                              />
                            ) : (
                              <input
                                type={field.isPassword ? 'password' : 'text'}
                                className={styles.textInput}
                                value={typeof val === 'string' ? val : ''}
                                onChange={(e) => handleTextChange(field.name, e.target.value)}
                                disabled={field.isReadOnly}
                              />
                            ))}

                          {field.type === 'checkbox' && (
                            <label className={styles.checkboxRow}>
                              <input
                                type="checkbox"
                                checked={Boolean(val)}
                                onChange={(e) => handleCheckChange(field.name, e.target.checked)}
                                disabled={field.isReadOnly}
                              />
                              <span>Check / Select</span>
                            </label>
                          )}

                          {field.type === 'radio' && (
                            <div className={styles.radioGroup}>
                              {(field.options ?? []).map((opt) => (
                                <label key={opt} className={styles.radioRow}>
                                  <input
                                    type="radio"
                                    name={field.name}
                                    value={opt}
                                    checked={val === opt}
                                    onChange={() => handleRadioChange(field.name, opt)}
                                    disabled={field.isReadOnly}
                                  />
                                  <span>{opt}</span>
                                </label>
                              ))}
                            </div>
                          )}

                          {field.type === 'dropdown' && (
                            <select
                              className={styles.selectInput}
                              value={typeof val === 'string' ? val : ''}
                              onChange={(e) => handleDropdownChange(field.name, e.target.value)}
                              disabled={field.isReadOnly}
                            >
                              {(field.options ?? []).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          )}

                          {field.type === 'list' && (
                            <select
                              multiple
                              className={styles.multiSelect}
                              value={Array.isArray(val) ? val : []}
                              onChange={(e) => handleListChange(field.name, e.target.options)}
                              disabled={field.isReadOnly}
                            >
                              {(field.options ?? []).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className={styles.optionsCard}>
                    <label className={styles.flattenRow}>
                      <input
                        type="checkbox"
                        checked={flatten}
                        onChange={(e) => setFlatten(e.target.checked)}
                        style={{ marginTop: '0.2rem' }}
                      />
                      <div className={styles.flattenText}>
                        <span className={styles.flattenTitle}>Flatten form fields</span>
                        <span className={styles.flattenDesc}>
                          Recommended for finalized forms. Bakes the entered values directly into the page content and prevents further
                          editing or tampering.
                        </span>
                      </div>
                    </label>
                  </div>

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label="Filling form fields..." />
                  ) : (
                    <Button variant="primary" onClick={handleSave}>
                      Fill and Save PDF
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
