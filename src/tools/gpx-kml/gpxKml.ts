import { translate } from '../../lib/i18n';

export interface GeoPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}
export interface Waypoint extends GeoPoint {
  name?: string;
  desc?: string;
}

export interface Route {
  name?: string;
  desc?: string;
  points: GeoPoint[];
}

export interface TrackSegment {
  points: GeoPoint[];
}

export interface Track {
  name?: string;
  desc?: string;
  segments: TrackSegment[];
}

export interface GeoData {
  name?: string;
  desc?: string;
  time?: string;
  waypoints: Waypoint[];
  routes: Route[];
  tracks: Track[];
}

export interface GeoSummary {
  waypointsCount: number;
  routesCount: number;
  tracksCount: number;
  segmentsCount: number;
  totalPointsCount: number;
  hasElevations: boolean;
  hasTimestamps: boolean;
  disclosure: string;
}

export function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * Validates latitude and longitude values.
 * Throws explicit error on invalid or out-of-bounds coordinates.
 */
export function validateCoordinates(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(translate('Invalid coordinate: non-numeric value received (lat={lat}, lon={lon}).', { lat, lon }));
  }
  if (lat < -90 || lat > 90) {
    throw new Error(translate('Invalid latitude: {latitude}. Latitude must be between -90 and 90 degrees.', { latitude: lat }));
  }
  if (lon < -180 || lon > 180) {
    throw new Error(translate('Invalid longitude: {longitude}. Longitude must be between -180 and 180 degrees.', { longitude: lon }));
  }
}

/**
 * Lightweight XML element interface compatible with DOM Element.
 */
interface SimpleElement {
  tagName: string;
  attributes: Record<string, string>;
  textContent: string;
  children: SimpleElement[];
  getElementsByTagName(name: string): SimpleElement[];
  getAttribute(name: string): string | null;
}

function childText(element: SimpleElement, name: string): string | undefined {
  return element.children.find((child) => child.tagName.split(':').pop()?.toLowerCase() === name)?.textContent.trim() || undefined;
}

/**
 * Parses XML text into a SimpleElement tree.
 * Works seamlessly in both Browser and Node.js without external dependencies,
 * detecting parser errors and mismatched or unclosed tags.
 */
export function parseXmlDocument(xmlText: string): SimpleElement {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const parserErrors = doc.getElementsByTagName('parsererror');
    if (parserErrors.length > 0) {
      throw new Error(translate('Invalid XML: {detail}', { detail: parserErrors[0].textContent || 'Syntax error' }));
    }

    const wrap = (node: Element): SimpleElement => ({
      tagName: node.localName || node.tagName,
      attributes: Array.from(node.attributes).reduce<Record<string, string>>((acc, attr) => {
        acc[attr.name.toLowerCase()] = attr.value;
        return acc;
      }, {}),
      textContent: node.textContent || '',
      children: Array.from(node.children).map(wrap),
      getElementsByTagName(name: string): SimpleElement[] {
        const lower = name.toLowerCase();
        const results: SimpleElement[] = [];
        const search = (el: SimpleElement) => {
          for (const ch of el.children) {
            const chLocal = ch.tagName.includes(':') ? ch.tagName.split(':')[1] : ch.tagName;
            if (ch.tagName.toLowerCase() === lower || chLocal.toLowerCase() === lower) {
              results.push(ch);
            }
            search(ch);
          }
        };
        search(this);
        return results;
      },
      getAttribute(name: string): string | null {
        return this.attributes[name.toLowerCase()] ?? null;
      },
    });

    return wrap(doc.documentElement);
  }

  // Node.js pure parser implementation
  const trimmed = xmlText.trim();
  if (!trimmed) {
    throw new Error(translate('Invalid XML: empty document.'));
  }

  let pos = 0;
  const len = trimmed.length;

  const stack: SimpleElement[] = [];
  let root: SimpleElement | null = null;

  while (pos < len) {
    const nextLt = trimmed.indexOf('<', pos);
    if (nextLt === -1) break;

    // Check text between tags
    if (nextLt > pos && stack.length > 0) {
      const text = unescapeXml(trimmed.slice(pos, nextLt));
      stack[stack.length - 1].textContent += text;
    }

    pos = nextLt + 1;

    // Comments <!---->
    if (trimmed.startsWith('!--', pos)) {
      const commentEnd = trimmed.indexOf('-->', pos + 3);
      if (commentEnd === -1) throw new Error(translate('Invalid XML: unclosed comment'));
      pos = commentEnd + 3;
      continue;
    }

    // Processing instructions <?...?>
    if (trimmed[pos] === '?') {
      const piEnd = trimmed.indexOf('?>', pos + 1);
      if (piEnd === -1) throw new Error(translate('Invalid XML: unclosed processing instruction'));
      pos = piEnd + 2;
      continue;
    }

    // CDATA <![CDATA[...]]>
    if (trimmed.startsWith('![CDATA[', pos)) {
      const cdataEnd = trimmed.indexOf(']]>', pos + 8);
      if (cdataEnd === -1) throw new Error(translate('Invalid XML: unclosed CDATA section'));
      const cdataText = trimmed.slice(pos + 8, cdataEnd);
      if (stack.length > 0) {
        stack[stack.length - 1].textContent += cdataText;
      }
      pos = cdataEnd + 3;
      continue;
    }

    // Closing tag </tag>
    if (trimmed[pos] === '/') {
      const closeEnd = trimmed.indexOf('>', pos + 1);
      if (closeEnd === -1) throw new Error(translate('Invalid XML: unclosed closing tag'));
      const closeName = trimmed.slice(pos + 1, closeEnd).trim();
      const expected = stack.pop();
      if (!expected) {
        throw new Error(translate('Invalid XML: unexpected closing tag </{tag}>.', { tag: closeName }));
      }
      const expLocal = expected.tagName.includes(':') ? expected.tagName.split(':')[1] : expected.tagName;
      const actLocal = closeName.includes(':') ? closeName.split(':')[1] : closeName;
      if (expLocal.toLowerCase() !== actLocal.toLowerCase()) {
        throw new Error(
          translate('Invalid XML: mismatched closing tag </{actual}>, expected </{expected}>.', {
            actual: closeName,
            expected: expected.tagName,
          }),
        );
      }
      pos = closeEnd + 1;
      continue;
    }

    // Opening or self-closing tag <tag ...>
    const tagEnd = trimmed.indexOf('>', pos);
    if (tagEnd === -1) throw new Error(translate('Invalid XML: unclosed opening tag'));

    const isSelfClosing = trimmed[tagEnd - 1] === '/';
    const tagContent = isSelfClosing ? trimmed.slice(pos, tagEnd - 1).trim() : trimmed.slice(pos, tagEnd).trim();

    pos = tagEnd + 1;

    // Parse tag name and attributes
    const nameMatch = tagContent.match(/^([^\s/>]+)/);
    if (!nameMatch) throw new Error(translate('Invalid XML: invalid tag name'));
    const rawTagName = nameMatch[1];
    const attrString = tagContent.slice(rawTagName.length);

    const attributes: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(attrString)) !== null) {
      attributes[match[1].toLowerCase()] = unescapeXml(match[2] !== undefined ? match[2] : match[3]);
    }

    const elem: SimpleElement = {
      tagName: rawTagName,
      attributes,
      textContent: '',
      children: [],
      getElementsByTagName(name: string): SimpleElement[] {
        const lower = name.toLowerCase();
        const results: SimpleElement[] = [];
        const search = (el: SimpleElement) => {
          for (const ch of el.children) {
            const chLocal = ch.tagName.includes(':') ? ch.tagName.split(':')[1] : ch.tagName;
            if (ch.tagName.toLowerCase() === lower || chLocal.toLowerCase() === lower) {
              results.push(ch);
            }
            search(ch);
          }
        };
        search(this);
        return results;
      },
      getAttribute(name: string): string | null {
        return this.attributes[name.toLowerCase()] ?? null;
      },
    };

    if (!root) root = elem;

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(elem);
    }

    if (!isSelfClosing) {
      stack.push(elem);
    }
  }

  if (stack.length > 0) {
    throw new Error(translate('Invalid XML: unclosed tag <{tag}>.', { tag: stack[stack.length - 1].tagName }));
  }

  if (!root) {
    throw new Error(translate('Invalid XML: no root element found.'));
  }

  return root;
}

/**
 * Parses GPX XML text into normalized GeoData.
 */
export function gpxToGeoData(gpxText: string): GeoData {
  const root = parseXmlDocument(gpxText);
  const rootLocal = root.tagName.includes(':') ? root.tagName.split(':')[1] : root.tagName;
  if (rootLocal.toLowerCase() !== 'gpx') {
    throw new Error(translate('Invalid GPX: root element is <{actual}>, expected <gpx>.', { actual: root.tagName }));
  }

  // Metadata
  let name: string | undefined;
  let desc: string | undefined;
  let time: string | undefined;

  const metadata = root.getElementsByTagName('metadata')[0];
  if (metadata) {
    name = metadata.getElementsByTagName('name')[0]?.textContent.trim();
    desc = metadata.getElementsByTagName('desc')[0]?.textContent.trim();
    time = metadata.getElementsByTagName('time')[0]?.textContent.trim();
  }

  // Waypoints <wpt lat="..." lon="...">
  const waypoints: Waypoint[] = [];
  const wptElements = root.getElementsByTagName('wpt');
  for (const wpt of wptElements) {
    const latStr = wpt.getAttribute('lat');
    const lonStr = wpt.getAttribute('lon');
    if (!latStr || !lonStr) {
      throw new Error(translate('Invalid GPX: <wpt> is missing lat or lon attribute.'));
    }
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    validateCoordinates(lat, lon);

    const wptName = wpt.getElementsByTagName('name')[0]?.textContent.trim();
    const wptDesc = wpt.getElementsByTagName('desc')[0]?.textContent.trim();
    const eleStr = wpt.getElementsByTagName('ele')[0]?.textContent.trim();
    const ele = eleStr ? parseFloat(eleStr) : undefined;
    const wptTime = wpt.getElementsByTagName('time')[0]?.textContent.trim();

    waypoints.push({
      lat,
      lon,
      ele: ele !== undefined && Number.isFinite(ele) ? ele : undefined,
      time: wptTime || undefined,
      name: wptName || undefined,
      desc: wptDesc || undefined,
    });
  }

  // Routes <rte>
  const routes: Route[] = [];
  const rteElements = root.getElementsByTagName('rte');
  for (const rte of rteElements) {
    const rteName = childText(rte, 'name');
    const rteDesc = childText(rte, 'desc');
    const points: GeoPoint[] = [];

    const rteptElements = rte.getElementsByTagName('rtept');
    for (const pt of rteptElements) {
      const latStr = pt.getAttribute('lat');
      const lonStr = pt.getAttribute('lon');
      if (!latStr || !lonStr) continue;
      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);
      validateCoordinates(lat, lon);

      const eleStr = pt.getElementsByTagName('ele')[0]?.textContent.trim();
      const ele = eleStr ? parseFloat(eleStr) : undefined;
      const ptTime = pt.getElementsByTagName('time')[0]?.textContent.trim();

      points.push({
        lat,
        lon,
        ele: ele !== undefined && Number.isFinite(ele) ? ele : undefined,
        time: ptTime || undefined,
      });
    }

    routes.push({
      name: rteName || undefined,
      desc: rteDesc || undefined,
      points,
    });
  }

  // Tracks <trk>
  const tracks: Track[] = [];
  const trkElements = root.getElementsByTagName('trk');
  for (const trk of trkElements) {
    const trkName = childText(trk, 'name');
    const trkDesc = childText(trk, 'desc');
    const segments: TrackSegment[] = [];

    const segElements = trk.getElementsByTagName('trkseg');
    for (const seg of segElements) {
      const points: GeoPoint[] = [];
      const trkptElements = seg.getElementsByTagName('trkpt');
      for (const pt of trkptElements) {
        const latStr = pt.getAttribute('lat');
        const lonStr = pt.getAttribute('lon');
        if (!latStr || !lonStr) continue;
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        validateCoordinates(lat, lon);

        const eleStr = pt.getElementsByTagName('ele')[0]?.textContent.trim();
        const ele = eleStr ? parseFloat(eleStr) : undefined;
        const ptTime = pt.getElementsByTagName('time')[0]?.textContent.trim();

        points.push({
          lat,
          lon,
          ele: ele !== undefined && Number.isFinite(ele) ? ele : undefined,
          time: ptTime || undefined,
        });
      }
      segments.push({ points });
    }

    tracks.push({
      name: trkName || undefined,
      desc: trkDesc || undefined,
      segments,
    });
  }

  return {
    name,
    desc,
    time,
    waypoints,
    routes,
    tracks,
  };
}

/**
 * Parses coordinate tuples from KML <coordinates> string:
 * "lon,lat[,ele] lon,lat[,ele] ..."
 */
export function parseKmlCoordinates(coordString: string): GeoPoint[] {
  const points: GeoPoint[] = [];
  const tokens = coordString.trim().split(/\s+/);

  for (const token of tokens) {
    if (!token) continue;
    const parts = token.split(',');
    if (parts.length < 2) continue;

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    validateCoordinates(lat, lon);

    let ele: number | undefined;
    if (parts.length >= 3) {
      const parsedEle = parseFloat(parts[2]);
      if (Number.isFinite(parsedEle)) {
        ele = parsedEle;
      }
    }

    points.push({
      lat,
      lon,
      ele,
    });
  }

  return points;
}

/**
 * Parses KML XML text into normalized GeoData.
 */
export function kmlToGeoData(kmlText: string): GeoData {
  const root = parseXmlDocument(kmlText);
  const rootLocal = root.tagName.includes(':') ? root.tagName.split(':')[1] : root.tagName;
  if (rootLocal.toLowerCase() !== 'kml') {
    throw new Error(translate('Invalid KML: root element is <{actual}>, expected <kml>.', { actual: root.tagName }));
  }

  const docNode = root.getElementsByTagName('Document')[0] || root;
  const name = childText(docNode, 'name');
  const desc = childText(docNode, 'description');

  const waypoints: Waypoint[] = [];
  const tracks: Track[] = [];
  const routes: Route[] = [];

  const placemarks = root.getElementsByTagName('Placemark');

  for (const pm of placemarks) {
    const pmName = childText(pm, 'name');
    const pmDesc = childText(pm, 'description');
    const pmTime = pm.getElementsByTagName('when')[0]?.textContent.trim();

    for (const pointNode of pm.getElementsByTagName('Point')) {
      const coordText = pointNode.getElementsByTagName('coordinates')[0]?.textContent.trim() || '';
      const pts = parseKmlCoordinates(coordText);
      if (pts.length > 0) {
        waypoints.push({
          ...pts[0],
          name: pmName || undefined,
          desc: pmDesc || undefined,
          time: pmTime || undefined,
        });
      }
    }

    const segments: TrackSegment[] = [];
    for (const lineNode of pm.getElementsByTagName('LineString')) {
      const coordText = lineNode.getElementsByTagName('coordinates')[0]?.textContent.trim() || '';
      const points = parseKmlCoordinates(coordText);
      if (points.length > 0) segments.push({ points });
    }
    if (segments.length > 0) tracks.push({ name: pmName, desc: pmDesc, segments });
  }

  return {
    name,
    desc,
    waypoints,
    routes,
    tracks,
  };
}

/**
 * Serializes normalized GeoData to standard GPX 1.1 format.
 */
export function geoDataToGpx(data: GeoData): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="loconvert" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
  );

  // Metadata
  if (data.name || data.desc || data.time) {
    lines.push('  <metadata>');
    if (data.name) lines.push(`    <name>${escapeXml(data.name)}</name>`);
    if (data.desc) lines.push(`    <desc>${escapeXml(data.desc)}</desc>`);
    if (data.time) lines.push(`    <time>${escapeXml(data.time)}</time>`);
    lines.push('  </metadata>');
  }

  // Waypoints
  for (const wpt of data.waypoints) {
    validateCoordinates(wpt.lat, wpt.lon);
    lines.push(`  <wpt lat="${wpt.lat}" lon="${wpt.lon}">`);
    if (wpt.ele !== undefined) lines.push(`    <ele>${wpt.ele}</ele>`);
    if (wpt.time) lines.push(`    <time>${escapeXml(wpt.time)}</time>`);
    if (wpt.name) lines.push(`    <name>${escapeXml(wpt.name)}</name>`);
    if (wpt.desc) lines.push(`    <desc>${escapeXml(wpt.desc)}</desc>`);
    lines.push('  </wpt>');
  }

  // Routes
  for (const rte of data.routes) {
    lines.push('  <rte>');
    if (rte.name) lines.push(`    <name>${escapeXml(rte.name)}</name>`);
    if (rte.desc) lines.push(`    <desc>${escapeXml(rte.desc)}</desc>`);
    for (const pt of rte.points) {
      validateCoordinates(pt.lat, pt.lon);
      lines.push(`    <rtept lat="${pt.lat}" lon="${pt.lon}">`);
      if (pt.ele !== undefined) lines.push(`      <ele>${pt.ele}</ele>`);
      if (pt.time) lines.push(`      <time>${escapeXml(pt.time)}</time>`);
      lines.push('    </rtept>');
    }
    lines.push('  </rte>');
  }

  // Tracks
  for (const trk of data.tracks) {
    lines.push('  <trk>');
    if (trk.name) lines.push(`    <name>${escapeXml(trk.name)}</name>`);
    if (trk.desc) lines.push(`    <desc>${escapeXml(trk.desc)}</desc>`);
    for (const seg of trk.segments) {
      lines.push('    <trkseg>');
      for (const pt of seg.points) {
        validateCoordinates(pt.lat, pt.lon);
        lines.push(`      <trkpt lat="${pt.lat}" lon="${pt.lon}">`);
        if (pt.ele !== undefined) lines.push(`        <ele>${pt.ele}</ele>`);
        if (pt.time) lines.push(`        <time>${escapeXml(pt.time)}</time>`);
        lines.push('      </trkpt>');
      }
      lines.push('    </trkseg>');
    }
    lines.push('  </trk>');
  }

  lines.push('</gpx>');
  return lines.join('\n');
}

/**
 * Serializes normalized GeoData to standard KML 2.2 format.
 * Multi-segment tracks are represented using <MultiGeometry> with multiple <LineString> elements.
 */
export function geoDataToKml(data: GeoData): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  lines.push('  <Document>');

  if (data.name) lines.push(`    <name>${escapeXml(data.name)}</name>`);
  if (data.desc) lines.push(`    <description>${escapeXml(data.desc)}</description>`);

  // Waypoints -> Placemarks with <Point>
  for (const wpt of data.waypoints) {
    validateCoordinates(wpt.lat, wpt.lon);
    lines.push('    <Placemark>');
    if (wpt.name) lines.push(`      <name>${escapeXml(wpt.name)}</name>`);
    if (wpt.desc) lines.push(`      <description>${escapeXml(wpt.desc)}</description>`);
    if (wpt.time) {
      lines.push(`      <TimeStamp><when>${escapeXml(wpt.time)}</when></TimeStamp>`);
    }
    const coordStr = wpt.ele !== undefined ? `${wpt.lon},${wpt.lat},${wpt.ele}` : `${wpt.lon},${wpt.lat}`;
    lines.push(`      <Point><coordinates>${coordStr}</coordinates></Point>`);
    lines.push('    </Placemark>');
  }

  // Routes -> Placemarks with <LineString>
  for (const rte of data.routes) {
    lines.push('    <Placemark>');
    if (rte.name) lines.push(`      <name>${escapeXml(rte.name)}</name>`);
    if (rte.desc) lines.push(`      <description>${escapeXml(rte.desc)}</description>`);
    const coords = rte.points
      .map((pt) => {
        validateCoordinates(pt.lat, pt.lon);
        return pt.ele !== undefined ? `${pt.lon},${pt.lat},${pt.ele}` : `${pt.lon},${pt.lat}`;
      })
      .join(' ');
    lines.push(`      <LineString><coordinates>${coords}</coordinates></LineString>`);
    lines.push('    </Placemark>');
  }

  // Tracks -> Placemarks with <LineString> or <MultiGeometry>
  for (const trk of data.tracks) {
    lines.push('    <Placemark>');
    if (trk.name) lines.push(`      <name>${escapeXml(trk.name)}</name>`);
    if (trk.desc) lines.push(`      <description>${escapeXml(trk.desc)}</description>`);

    if (trk.segments.length === 1) {
      const coords = trk.segments[0].points
        .map((pt) => {
          validateCoordinates(pt.lat, pt.lon);
          return pt.ele !== undefined ? `${pt.lon},${pt.lat},${pt.ele}` : `${pt.lon},${pt.lat}`;
        })
        .join(' ');
      lines.push(`      <LineString><coordinates>${coords}</coordinates></LineString>`);
    } else if (trk.segments.length > 1) {
      // Preserves multi-segment boundaries cleanly in KML using MultiGeometry
      lines.push('      <MultiGeometry>');
      for (const seg of trk.segments) {
        const coords = seg.points
          .map((pt) => {
            validateCoordinates(pt.lat, pt.lon);
            return pt.ele !== undefined ? `${pt.lon},${pt.lat},${pt.ele}` : `${pt.lon},${pt.lat}`;
          })
          .join(' ');
        lines.push(`        <LineString><coordinates>${coords}</coordinates></LineString>`);
      }
      lines.push('      </MultiGeometry>');
    }

    lines.push('    </Placemark>');
  }

  lines.push('  </Document>');
  lines.push('</kml>');
  return lines.join('\n');
}

/**
 * Computes summary and disclosure metadata for GeoData.
 */
export function getGeoSummary(data: GeoData): GeoSummary {
  let totalPoints = data.waypoints.length;
  let segCount = 0;
  let hasEle = data.waypoints.some((w) => w.ele !== undefined);
  let hasTime = data.waypoints.some((w) => w.time !== undefined);

  for (const rte of data.routes) {
    totalPoints += rte.points.length;
    if (rte.points.some((p) => p.ele !== undefined)) hasEle = true;
    if (rte.points.some((p) => p.time !== undefined)) hasTime = true;
  }

  for (const trk of data.tracks) {
    segCount += trk.segments.length;
    for (const seg of trk.segments) {
      totalPoints += seg.points.length;
      if (seg.points.some((p) => p.ele !== undefined)) hasEle = true;
      if (seg.points.some((p) => p.time !== undefined)) hasTime = true;
    }
  }

  return {
    waypointsCount: data.waypoints.length,
    routesCount: data.routes.length,
    tracksCount: data.tracks.length,
    segmentsCount: segCount,
    totalPointsCount: totalPoints,
    hasElevations: hasEle,
    hasTimestamps: hasTime,
    disclosure:
      'Preserved: waypoints, routes, tracks, multi-segment boundaries, elevations, coordinates, timestamps, names, and descriptions. Unsupported/omitted: vendor-specific device extensions (<extensions>, <cadence>, <hr>, <temp>), custom map styling (<Style>, <LineStyle>), and extended schema attributes.',
  };
}
