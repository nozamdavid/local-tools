import { useState, useEffect, useRef, useId, useCallback } from 'react';
import QRCode from 'qrcode';
import { ToolPage } from '../../../components/ToolPage';
import { Field, Slider, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { downloadBlob } from '../../../lib/download';
import { type QrContentType, type WifiData, type EmailData, type SmsData, type VCardData, buildQrString } from '../_generate/qr';
import styles from './Tool.module.css';
import { useI18n } from '../../../lib/i18n';

type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

const CONTENT_TYPES: { id: QrContentType; label: string }[] = [
  { id: 'url', label: 'Website URL' },
  { id: 'text', label: 'Plain Text' },
  { id: 'wifi', label: 'WiFi Network' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'sms', label: 'SMS' },
  { id: 'vcard', label: 'Contact Card (vCard)' },
];

export default function QrCodeGeneratorTool() {
  const meta = getToolMeta('img-qr-code-generator');
  const { t } = useI18n();

  const [contentType, setContentType] = useState<QrContentType>('url');
  const [urlVal, setUrlVal] = useState<string>('https://loconvert.com');
  const [textVal, setTextVal] = useState<string>('Hello from Loconvert!');
  const [wifiVal, setWifiVal] = useState<WifiData>({
    ssid: 'HomeWiFi',
    password: '',
    auth: 'WPA',
    hidden: false,
  });
  const [emailVal, setEmailVal] = useState<EmailData>({
    to: 'hello@example.com',
    subject: 'Inquiry',
    body: '',
  });
  const [phoneVal, setPhoneVal] = useState<string>('+1234567890');
  const [smsVal, setSmsVal] = useState<SmsData>({
    phone: '+1234567890',
    message: 'Hello!',
  });
  const [vcardVal, setVcardVal] = useState<VCardData>({
    firstName: 'Jane',
    lastName: 'Doe',
    org: 'Loconvert',
    title: 'Developer',
    phone: '+1234567890',
    email: 'jane@example.com',
    url: 'https://example.com',
    street: '123 Market St',
    city: 'San Francisco',
    state: 'CA',
    zip: '94105',
    country: 'USA',
  });

  // Options
  const [ecLevel, setEcLevel] = useState<ErrorCorrection>('M');
  const [size, setSize] = useState<number>(360);
  const [margin, setMargin] = useState<number>(3);
  const [darkColor, setDarkColor] = useState<string>('#000000');
  const [lightColor, setLightColor] = useState<string>('#ffffff');
  const [transparentBg, setTransparentBg] = useState<boolean>(false);

  // Logo
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const ecId = useId();

  // Active error correction level: forced to 'H' when a center logo is uploaded
  const effectiveEcLevel: ErrorCorrection = logoImg ? 'H' : ecLevel;

  // Compute final payload string
  const qrString = buildQrString(contentType, {
    url: urlVal,
    text: textVal,
    wifi: wifiVal,
    email: emailVal,
    phone: phoneVal,
    sms: smsVal,
    vcard: vcardVal,
  });

  // Handle Logo Upload
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setLogoDataUrl(result);
        setLogoImg(img);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removeLogo = () => {
    setLogoImg(null);
    setLogoDataUrl(null);
  };

  // Render QR Code onto canvas
  const renderQr = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const textToEncode = qrString.trim() || ' ';
    const actualBg = transparentBg ? '#00000000' : lightColor;

    try {
      await QRCode.toCanvas(canvas, textToEncode, {
        width: size,
        margin: margin,
        errorCorrectionLevel: effectiveEcLevel,
        color: {
          dark: darkColor,
          light: actualBg,
        },
      });

      // Overlay center logo if present (limited to 22% of total width)
      if (logoImg) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const logoSize = Math.floor(canvas.width * 0.22);
          const x = Math.round((canvas.width - logoSize) / 2);
          const y = Math.round((canvas.height - logoSize) / 2);
          const pad = Math.max(3, Math.round(logoSize * 0.08));

          // Draw clean rounded background plate behind logo so modules don't bleed into it
          ctx.save();
          ctx.fillStyle = transparentBg ? '#ffffff' : lightColor;
          ctx.beginPath();
          const plateRadius = 6;
          const px = x - pad;
          const py = y - pad;
          const pw = logoSize + pad * 2;
          const ph = logoSize + pad * 2;
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(px, py, pw, ph, plateRadius);
          } else {
            ctx.rect(px, py, pw, ph);
          }
          ctx.fill();

          // Draw the logo centered
          ctx.drawImage(logoImg, x, y, logoSize, logoSize);
          ctx.restore();
        }
      }
    } catch (err) {
      console.error('Failed to generate QR code canvas:', err);
    }
  }, [qrString, size, margin, effectiveEcLevel, darkColor, lightColor, transparentBg, logoImg]);

  useEffect(() => {
    renderQr();
  }, [renderQr]);

  // Download PNG
  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `qrcode-${contentType}.png`);
      }
    }, 'image/png');
  };

  // Download SVG
  const handleDownloadSvg = async () => {
    const textToEncode = qrString.trim() || ' ';
    const actualBg = transparentBg ? '#00000000' : lightColor;

    try {
      let svg = await QRCode.toString(textToEncode, {
        type: 'svg',
        width: size,
        margin: margin,
        errorCorrectionLevel: effectiveEcLevel,
        color: {
          dark: darkColor,
          light: actualBg,
        },
      });

      // Embed logo inside SVG if present
      if (logoDataUrl) {
        const logoSize = Math.floor(size * 0.22);
        const x = Math.round((size - logoSize) / 2);
        const y = Math.round((size - logoSize) / 2);
        const pad = Math.max(3, Math.round(logoSize * 0.08));
        const plateBg = transparentBg ? '#ffffff' : lightColor;

        const logoElement = `
          <rect x="${x - pad}" y="${y - pad}" width="${logoSize + pad * 2}" height="${logoSize + pad * 2}" rx="6" fill="${plateBg}" />
          <image href="${logoDataUrl}" x="${x}" y="${y}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" />
        `;
        svg = svg.replace('</svg>', `${logoElement}</svg>`);
      }

      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      downloadBlob(blob, `qrcode-${contentType}.svg`);
    } catch (err) {
      console.error('Failed to generate SVG:', err);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-qr-code-generator">
      <div className={styles.container}>
        <div className={styles.typeTabs}>
          {CONTENT_TYPES.map((content) => (
            <button
              key={content.id}
              type="button"
              className={`${styles.typeTab} ${contentType === content.id ? styles.typeTabActive : ''}`}
              aria-pressed={contentType === content.id}
              onClick={() => setContentType(content.id)}
            >
              {t(content.label)}
            </button>
          ))}
        </div>

        <div className={styles.layout}>
          {/* Controls Column */}
          <div className={styles.panel}>
            {contentType === 'url' && (
              <Field label={t('Website URL')} hint={t('Enter the complete address, for example https://example.com')}>
                <input
                  type="url"
                  className="input"
                  value={urlVal}
                  placeholder="https://example.com"
                  onChange={(e) => setUrlVal(e.target.value)}
                />
              </Field>
            )}

            {contentType === 'text' && (
              <Field label={t('Text content')} hint={t('Any plain text up to several hundred characters.')}>
                <textarea
                  className="input"
                  rows={4}
                  value={textVal}
                  placeholder={t('Type anything…')}
                  onChange={(e) => setTextVal(e.target.value)}
                />
              </Field>
            )}

            {contentType === 'wifi' && (
              <div className={styles.formGrid}>
                <Field label={t('Network SSID (name)')}>
                  <input
                    type="text"
                    className="input"
                    value={wifiVal.ssid}
                    placeholder={t('WiFi network name')}
                    onChange={(e) => setWifiVal({ ...wifiVal, ssid: e.target.value })}
                  />
                </Field>
                <Field label={t('Password')}>
                  <input
                    type="text"
                    className="input"
                    value={wifiVal.password}
                    placeholder={t('Network password (leave blank if open)')}
                    disabled={wifiVal.auth === 'nopass'}
                    onChange={(e) => setWifiVal({ ...wifiVal, password: e.target.value })}
                  />
                </Field>
                <div className={styles.twoCols}>
                  <Field label={t('Encryption')}>
                    <Select
                      value={wifiVal.auth}
                      onChange={(e) => setWifiVal({ ...wifiVal, auth: e.target.value as 'WPA' | 'WEP' | 'nopass' })}
                      options={[
                        { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
                        { value: 'WEP', label: 'WEP' },
                        { value: 'nopass', label: t('Open (no password)') },
                      ]}
                    />
                  </Field>
                  <Field label={t('Hidden network')}>
                    <label className={styles.checkboxLabel} style={{ marginTop: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={wifiVal.hidden}
                        onChange={(e) => setWifiVal({ ...wifiVal, hidden: e.target.checked })}
                      />
                      {t('Hidden SSID')}
                    </label>
                  </Field>
                </div>
              </div>
            )}

            {contentType === 'email' && (
              <div className={styles.formGrid}>
                <Field label={t('Send to (email)')}>
                  <input
                    type="email"
                    className="input"
                    value={emailVal.to}
                    placeholder="user@example.com"
                    onChange={(e) => setEmailVal({ ...emailVal, to: e.target.value })}
                  />
                </Field>
                <Field label={t('Subject line')}>
                  <input
                    type="text"
                    className="input"
                    value={emailVal.subject}
                    placeholder={t('Subject')}
                    onChange={(e) => setEmailVal({ ...emailVal, subject: e.target.value })}
                  />
                </Field>
                <Field label={t('Message body')}>
                  <textarea
                    className="input"
                    rows={3}
                    value={emailVal.body}
                    placeholder={t('Pre-filled email message…')}
                    onChange={(e) => setEmailVal({ ...emailVal, body: e.target.value })}
                  />
                </Field>
              </div>
            )}

            {contentType === 'phone' && (
              <Field label={t('Phone number')} hint={t('Include the country code, for example +14155552671')}>
                <input
                  type="tel"
                  className="input"
                  value={phoneVal}
                  placeholder="+14155552671"
                  onChange={(e) => setPhoneVal(e.target.value)}
                />
              </Field>
            )}

            {contentType === 'sms' && (
              <div className={styles.formGrid}>
                <Field label={t('Recipient phone number')}>
                  <input
                    type="tel"
                    className="input"
                    value={smsVal.phone}
                    placeholder="+14155552671"
                    onChange={(e) => setSmsVal({ ...smsVal, phone: e.target.value })}
                  />
                </Field>
                <Field label={t('SMS message')}>
                  <textarea
                    className="input"
                    rows={3}
                    value={smsVal.message}
                    placeholder={t('Text message…')}
                    onChange={(e) => setSmsVal({ ...smsVal, message: e.target.value })}
                  />
                </Field>
              </div>
            )}

            {contentType === 'vcard' && (
              <div className={styles.formGrid}>
                <div className={styles.twoCols}>
                  <Field label={t('First name')}>
                    <input
                      type="text"
                      className="input"
                      value={vcardVal.firstName}
                      onChange={(e) => setVcardVal({ ...vcardVal, firstName: e.target.value })}
                    />
                  </Field>
                  <Field label={t('Last name')}>
                    <input
                      type="text"
                      className="input"
                      value={vcardVal.lastName}
                      onChange={(e) => setVcardVal({ ...vcardVal, lastName: e.target.value })}
                    />
                  </Field>
                </div>
                <div className={styles.twoCols}>
                  <Field label={t('Organization / company')}>
                    <input
                      type="text"
                      className="input"
                      value={vcardVal.org}
                      onChange={(e) => setVcardVal({ ...vcardVal, org: e.target.value })}
                    />
                  </Field>
                  <Field label={t('Job title')}>
                    <input
                      type="text"
                      className="input"
                      value={vcardVal.title}
                      onChange={(e) => setVcardVal({ ...vcardVal, title: e.target.value })}
                    />
                  </Field>
                </div>
                <div className={styles.twoCols}>
                  <Field label={t('Phone')}>
                    <input
                      type="tel"
                      className="input"
                      value={vcardVal.phone}
                      onChange={(e) => setVcardVal({ ...vcardVal, phone: e.target.value })}
                    />
                  </Field>
                  <Field label={t('Email')}>
                    <input
                      type="email"
                      className="input"
                      value={vcardVal.email}
                      onChange={(e) => setVcardVal({ ...vcardVal, email: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t('Website / URL')}>
                  <input
                    type="url"
                    className="input"
                    value={vcardVal.url}
                    onChange={(e) => setVcardVal({ ...vcardVal, url: e.target.value })}
                  />
                </Field>
                <Field label={t('Street address')}>
                  <input
                    type="text"
                    className="input"
                    value={vcardVal.street}
                    onChange={(e) => setVcardVal({ ...vcardVal, street: e.target.value })}
                  />
                </Field>
                <div className={styles.twoCols}>
                  <Field label={t('City')}>
                    <input
                      type="text"
                      className="input"
                      value={vcardVal.city}
                      onChange={(e) => setVcardVal({ ...vcardVal, city: e.target.value })}
                    />
                  </Field>
                  <Field label={t('State / province')}>
                    <input
                      type="text"
                      className="input"
                      value={vcardVal.state}
                      onChange={(e) => setVcardVal({ ...vcardVal, state: e.target.value })}
                    />
                  </Field>
                </div>
                <div className={styles.twoCols}>
                  <Field label={t('Postal / ZIP code')}>
                    <input
                      type="text"
                      className="input"
                      value={vcardVal.zip}
                      onChange={(e) => setVcardVal({ ...vcardVal, zip: e.target.value })}
                    />
                  </Field>
                  <Field label={t('Country')}>
                    <input
                      type="text"
                      className="input"
                      value={vcardVal.country}
                      onChange={(e) => setVcardVal({ ...vcardVal, country: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            )}

            <details className="tool-options">
              <summary>{t('Appearance')}</summary>
              <div className="tool-options-body">
                <div className={styles.twoCols}>
                  <Field
                    label={t('Error correction')}
                    hint={logoImg ? t('Locked to high (30%) because a center logo is active.') : undefined}
                  >
                    <Select
                      id={ecId}
                      value={effectiveEcLevel}
                      disabled={!!logoImg}
                      onChange={(e) => setEcLevel(e.target.value as ErrorCorrection)}
                      options={[
                        { value: 'L', label: t('Low (~7%)') },
                        { value: 'M', label: t('Medium (~15%)') },
                        { value: 'Q', label: t('Quartile (~25%)') },
                        { value: 'H', label: t('High (~30%)') },
                      ]}
                    />
                  </Field>

                  <Field label={t('Margin (quiet zone)')}>
                    <Slider min={0} max={8} step={1} value={margin} onChange={setMargin} />
                  </Field>
                </div>

                <Field label={t('Output size')}>
                  <Slider min={160} max={800} step={20} unit="px" value={size} onChange={setSize} />
                </Field>

                <div className={styles.twoCols}>
                  <Field label={t('Foreground colour')}>
                    <div className={styles.colorPickerRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={darkColor}
                        aria-label={t('Foreground colour')}
                        onChange={(e) => setDarkColor(e.target.value)}
                      />
                      <span>{darkColor}</span>
                    </div>
                  </Field>

                  <Field label={t('Background colour')}>
                    <div className={styles.colorPickerRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={lightColor}
                        disabled={transparentBg}
                        aria-label={t('Background colour')}
                        onChange={(e) => setLightColor(e.target.value)}
                      />
                      <label className={styles.checkboxLabel}>
                        <input type="checkbox" checked={transparentBg} onChange={(e) => setTransparentBg(e.target.checked)} />
                        {t('Transparent')}
                      </label>
                    </div>
                  </Field>
                </div>

                <Field label={t('Center logo image')} hint={t('Optional icon in the center. Automatically enables high error correction.')}>
                  <div className={styles.logoUploadArea}>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      style={{ display: 'none' }}
                      onChange={handleLogoUpload}
                    />
                    {logoDataUrl ? (
                      <>
                        <img src={logoDataUrl} alt={t('Logo preview')} className={styles.logoPreview} />
                        <Button variant="secondary" onClick={() => logoInputRef.current?.click()}>
                          {t('Change')}
                        </Button>
                        <Button variant="secondary" onClick={removeLogo}>
                          {t('Remove')}
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" onClick={() => logoInputRef.current?.click()}>
                        {t('Upload logo image')}
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
            </details>
          </div>

          {/* Preview & Download Column */}
          <div className={styles.previewCard}>
            <div className={styles.previewWrapper}>
              <canvas ref={canvasRef} className={styles.previewCanvas} role="img" aria-label={t('QR code preview')} />
            </div>

            <div className={styles.actions}>
              <Button className={styles.actionBtn} onClick={handleDownloadPng}>
                {t('Download PNG')}
              </Button>
              <Button variant="secondary" className={styles.actionBtn} onClick={handleDownloadSvg}>
                {t('Download SVG')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ToolPage>
  );
}
