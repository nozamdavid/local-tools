import { expect, it } from 'vitest';
import { geoDataToGpx, kmlToGeoData } from './gpxKml';

it('converts every point and line in a placemark without copying its name into document metadata', () => {
  const input = `<kml><Document><Placemark><name>Trail &amp; stops</name><MultiGeometry>
  <Point><coordinates>1,2,3</coordinates></Point>
  <LineString><coordinates>1,2,3 4,5,6</coordinates></LineString>
  <Point><coordinates>4,5</coordinates></Point>
  <LineString><coordinates>4,5,6 7,8,9</coordinates></LineString>
</MultiGeometry></Placemark></Document></kml>`;
  const gpx = geoDataToGpx(kmlToGeoData(input));
  expect(gpx).not.toContain('<metadata>');
  expect(gpx).toContain(`  <wpt lat="2" lon="1">
    <ele>3</ele>
    <name>Trail &amp; stops</name>
  </wpt>
  <wpt lat="5" lon="4">
    <name>Trail &amp; stops</name>
  </wpt>`);
  expect(gpx.match(/<trkseg>[\s\S]*?<\/trkseg>/g)).toEqual([
    `<trkseg>
      <trkpt lat="2" lon="1">
        <ele>3</ele>
      </trkpt>
      <trkpt lat="5" lon="4">
        <ele>6</ele>
      </trkpt>
    </trkseg>`,
    `<trkseg>
      <trkpt lat="5" lon="4">
        <ele>6</ele>
      </trkpt>
      <trkpt lat="8" lon="7">
        <ele>9</ele>
      </trkpt>
    </trkseg>`,
  ]);
});
