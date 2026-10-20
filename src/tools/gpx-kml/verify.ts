import {
  gpxToGeoData,
  kmlToGeoData,
  geoDataToGpx,
  geoDataToKml,
  validateCoordinates,
  parseXmlDocument,
} from './gpxKml';

export async function runVerification(): Promise<void> {
  console.log('--- Starting GPX ↔ KML Verification ---');

  // 1. Names with XML characters (&, <, >, ", ')
  const specialName = 'Summit & Ridge <North> "Apex" & \'Peak\'';
  const specialDesc = 'A description with 1 < 2 & 4 > 3 "quotes"';

  const gpxWithSpecialChars = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="37.7749" lon="-122.4194">
    <ele>150.5</ele>
    <name>Summit &amp; Ridge &lt;North&gt; &quot;Apex&quot; &amp; &apos;Peak&apos;</name>
    <desc>A description with 1 &lt; 2 &amp; 4 &gt; 3 &quot;quotes&quot;</desc>
  </wpt>
</gpx>`;

  const geoData1 = gpxToGeoData(gpxWithSpecialChars);
  if (geoData1.waypoints.length !== 1) {
    throw new Error(`Expected 1 waypoint, got ${geoData1.waypoints.length}`);
  }
  const wpt1 = geoData1.waypoints[0];
  if (wpt1.name !== specialName) {
    throw new Error(`Special name mismatch in GPX parse:\nExpected: ${specialName}\nGot:      ${wpt1.name}`);
  }
  if (wpt1.desc !== specialDesc) {
    throw new Error(`Special desc mismatch in GPX parse:\nExpected: ${specialDesc}\nGot:      ${wpt1.desc}`);
  }

  // Convert to KML and verify XML escaping is retained and parsed cleanly
  const kmlOutput = geoDataToKml(geoData1);
  const geoDataFromKml = kmlToGeoData(kmlOutput);
  if (geoDataFromKml.waypoints.length !== 1) {
    throw new Error(`Expected 1 waypoint from KML, got ${geoDataFromKml.waypoints.length}`);
  }
  const kmlWpt = geoDataFromKml.waypoints[0];
  if (kmlWpt.name !== specialName) {
    throw new Error(`Special name mismatch in KML parse:\nExpected: ${specialName}\nGot:      ${kmlWpt.name}`);
  }
  if (kmlWpt.desc !== specialDesc) {
    throw new Error(`Special desc mismatch in KML parse:\nExpected: ${specialDesc}\nGot:      ${kmlWpt.desc}`);
  }
  console.log('✓ Names and descriptions with XML characters round-trip verified.');

  // 2. Multi-segment coordinates and elevation preservation
  const multiSegmentGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Multi-Day Traverse</name>
    <trkseg>
      <trkpt lat="46.8523" lon="-121.7603">
        <ele>14411.0</ele>
        <time>2026-06-01T08:00:00Z</time>
      </trkpt>
      <trkpt lat="46.8550" lon="-121.7580">
        <ele>13200.5</ele>
        <time>2026-06-01T09:00:00Z</time>
      </trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="46.8600" lon="-121.7500">
        <ele>11000.2</ele>
        <time>2026-06-02T08:00:00Z</time>
      </trkpt>
      <trkpt lat="46.8650" lon="-121.7450">
        <ele>9500.0</ele>
        <time>2026-06-02T10:00:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

  const geoTrack = gpxToGeoData(multiSegmentGpx);
  if (geoTrack.tracks.length !== 1) {
    throw new Error(`Expected 1 track, got ${geoTrack.tracks.length}`);
  }
  const trk = geoTrack.tracks[0];
  if (trk.segments.length !== 2) {
    throw new Error(`Expected 2 segments in track, got ${trk.segments.length}`);
  }
  if (trk.segments[0].points[0].ele !== 14411.0) {
    throw new Error(`Segment 1 ele mismatch: got ${trk.segments[0].points[0].ele}`);
  }
  if (trk.segments[1].points[1].ele !== 9500.0) {
    throw new Error(`Segment 2 ele mismatch: got ${trk.segments[1].points[1].ele}`);
  }

  // Convert to KML: multi-segment track should serialize as MultiGeometry with 2 LineStrings
  const kmlMulti = geoDataToKml(geoTrack);
  if (!kmlMulti.includes('<MultiGeometry>')) {
    throw new Error('KML output does not contain <MultiGeometry> for multi-segment track');
  }

  // Convert back to GeoData from KML
  const backFromKml = kmlToGeoData(kmlMulti);
  if (backFromKml.tracks.length !== 1) {
    throw new Error(`Expected 1 track back from KML, got ${backFromKml.tracks.length}`);
  }
  const roundtripTrk = backFromKml.tracks[0];
  if (roundtripTrk.segments.length !== 2) {
    throw new Error(`Expected 2 segments back from KML MultiGeometry, got ${roundtripTrk.segments.length}`);
  }

  // Check coordinates and elevations match
  const seg1Pt0 = roundtripTrk.segments[0].points[0];
  if (seg1Pt0.lat !== 46.8523 || seg1Pt0.lon !== -121.7603 || seg1Pt0.ele !== 14411.0) {
    throw new Error(`Roundtrip coordinate/ele mismatch: ${JSON.stringify(seg1Pt0)}`);
  }
  const seg2Pt1 = roundtripTrk.segments[1].points[1];
  if (seg2Pt1.lat !== 46.8650 || seg2Pt1.lon !== -121.7450 || seg2Pt1.ele !== 9500.0) {
    throw new Error(`Roundtrip segment 2 coordinate/ele mismatch: ${JSON.stringify(seg2Pt1)}`);
  }

  // Serialize back to GPX and verify multi-segment trkseg tags
  const gpxRoundtrip = geoDataToGpx(backFromKml);
  if (!gpxRoundtrip.includes('<trkseg>')) {
    throw new Error('GPX roundtrip output does not contain <trkseg>');
  }
  console.log('✓ Multi-segment boundaries, coordinates and elevations verified.');

  // 3. Invalid Coordinates Rejection
  let invalidCoordsCaught = false;
  try {
    validateCoordinates(95.0, 10.0); // Latitude > 90
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid latitude: 95')) {
      invalidCoordsCaught = true;
    }
  }
  if (!invalidCoordsCaught) {
    throw new Error('Invalid latitude was not rejected!');
  }

  let invalidLonCaught = false;
  try {
    validateCoordinates(45.0, -200.0); // Longitude < -180
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid longitude: -200')) {
      invalidLonCaught = true;
    }
  }
  if (!invalidLonCaught) {
    throw new Error('Invalid longitude was not rejected!');
  }

  let nanCoordCaught = false;
  try {
    validateCoordinates(NaN, 10.0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('non-numeric value received')) {
      nanCoordCaught = true;
    }
  }
  if (!nanCoordCaught) {
    throw new Error('NaN coordinate was not rejected!');
  }
  console.log('✓ Invalid coordinates (out-of-bounds & non-numeric) rejection verified.');

  // 4. Invalid XML Rejection
  const malformedXml = '<gpx version="1.1"><trk><name>Unclosed tag</gpx>';
  let xmlErrorCaught = false;
  try {
    parseXmlDocument(malformedXml);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid XML') || msg.includes('mismatched closing tag') || msg.includes('unclosed tag')) {
      xmlErrorCaught = true;
    }
  }
  if (!xmlErrorCaught) {
    throw new Error('Malformed XML was not rejected!');
  }
  console.log('✓ Malformed XML rejection verified.');

  console.log('--- ALL GPX ↔ KML VERIFICATIONS PASSED SUCCESSFULLY ---');
}

// Self-run when executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify')) {
  runVerification().catch((err) => {
    console.error('GPX-KML verification failed:', err);
    process.exit(1);
  });
}
