export type QrContentType = 'url' | 'text' | 'wifi' | 'email' | 'phone' | 'sms' | 'vcard';

export interface WifiData {
  ssid: string;
  password: string;
  auth: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
}

export interface EmailData {
  to: string;
  subject: string;
  body: string;
}

export interface SmsData {
  phone: string;
  message: string;
}

export interface VCardData {
  firstName: string;
  lastName: string;
  org: string;
  title: string;
  phone: string;
  email: string;
  url: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

/** Escapes special characters for standard WiFi QR code strings */
export function escapeWifiString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/:/g, '\\:')
    .replace(/"/g, '\\"');
}

/** Escapes special characters for vCard field values */
export function escapeVCardString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function buildQrString(
  type: QrContentType,
  data: {
    url?: string;
    text?: string;
    wifi?: WifiData;
    email?: EmailData;
    phone?: string;
    sms?: SmsData;
    vcard?: VCardData;
  },
): string {
  switch (type) {
    case 'url': {
      const u = (data.url || '').trim();
      if (!u) return '';
      return /^https?:\/\//i.test(u) ? u : `https://${u}`;
    }

    case 'text':
      return data.text || '';

    case 'wifi': {
      const wifi = data.wifi;
      if (!wifi || !wifi.ssid.trim()) return '';
      const auth = wifi.auth;
      const s = escapeWifiString(wifi.ssid.trim());
      const p = auth !== 'nopass' && wifi.password ? escapeWifiString(wifi.password) : '';
      const h = wifi.hidden ? 'true' : 'false';
      return `WIFI:T:${auth};S:${s};P:${p};H:${h};;`;
    }

    case 'email': {
      const em = data.email;
      if (!em || !em.to.trim()) return '';
      const params = new URLSearchParams();
      if (em.subject) params.set('subject', em.subject);
      if (em.body) params.set('body', em.body);
      const query = params.toString();
      return `mailto:${em.to.trim()}${query ? `?${query}` : ''}`;
    }

    case 'phone': {
      const p = (data.phone || '').trim();
      return p ? `tel:${p}` : '';
    }

    case 'sms': {
      const sms = data.sms;
      if (!sms || !sms.phone.trim()) return '';
      return `smsto:${sms.phone.trim()}:${sms.message || ''}`;
    }

    case 'vcard': {
      const vc = data.vcard;
      if (!vc) return '';
      const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

      const fn = `${vc.firstName} ${vc.lastName}`.trim();
      if (vc.lastName || vc.firstName) {
        lines.push(`N:${escapeVCardString(vc.lastName)};${escapeVCardString(vc.firstName)};;;`);
        lines.push(`FN:${escapeVCardString(fn || 'Contact')}`);
      } else if (fn) {
        lines.push(`FN:${escapeVCardString(fn)}`);
      }

      if (vc.org) lines.push(`ORG:${escapeVCardString(vc.org)}`);
      if (vc.title) lines.push(`TITLE:${escapeVCardString(vc.title)}`);
      if (vc.phone) lines.push(`TEL:${escapeVCardString(vc.phone)}`);
      if (vc.email) lines.push(`EMAIL:${escapeVCardString(vc.email)}`);
      if (vc.url) lines.push(`URL:${escapeVCardString(vc.url)}`);

      if (vc.street || vc.city || vc.state || vc.zip || vc.country) {
        lines.push(
          `ADR:;;${escapeVCardString(vc.street)};${escapeVCardString(vc.city)};${escapeVCardString(vc.state)};${escapeVCardString(vc.zip)};${escapeVCardString(vc.country)}`,
        );
      }

      lines.push('END:VCARD');
      return lines.join('\n');
    }

    default:
      return '';
  }
}
