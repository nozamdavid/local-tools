import type JSZip from 'jszip';

const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CHART_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const SUPPORTED_PLOTS = new Set(['barChart', 'lineChart', 'pieChart']);

export type ChartText = { title: string; categories?: string[] };

function child(parent: Element | undefined, name: string): Element | undefined {
  return Array.from(parent?.children ?? []).find((element) => element.namespaceURI === CHART_NS && element.localName === name);
}

function readTitle(chart: Element): string {
  const text = child(child(chart, 'title'), 'tx');
  const rich = child(text, 'rich');
  if (rich) {
    return Array.from(rich.getElementsByTagNameNS(DRAWING_NS, 'p'), (paragraph) =>
      Array.from(paragraph.children, (run) =>
        run.namespaceURI === DRAWING_NS && run.localName === 'br'
          ? '\n'
          : (run.getElementsByTagNameNS(DRAWING_NS, 't')[0]?.textContent ?? ''),
      ).join(''),
    ).join('\n');
  }
  const cache = child(child(text, 'strRef'), 'strCache');
  return child(child(cache, 'pt'), 'v')?.textContent ?? '';
}

function readCategories(series: Element, reference: Element): string[] | undefined {
  // ECharts has one row of category labels here. Use the first level, which holds the leaf labels.
  const level = child(child(reference, 'multiLvlStrCache'), 'lvl');
  const labels = new Map(
    Array.from(level?.getElementsByTagNameNS(CHART_NS, 'pt') ?? [], (point) => [
      point.getAttribute('idx'),
      child(point, 'v')?.textContent ?? '',
    ]),
  );
  if (!labels.size) return undefined;

  // pptx-preview reads values in cache order. Match each value to its own category index.
  const values = child(child(child(series, 'val'), 'numRef'), 'numCache');
  const points = Array.from(values?.getElementsByTagNameNS(CHART_NS, 'pt') ?? []);
  return points.length ? points.map((point) => labels.get(point.getAttribute('idx')) ?? '') : undefined;
}

export async function prepareChartText(zip: JSZip, contentTypes: string, result: Map<string, ChartText>): Promise<void> {
  const parser = new DOMParser();
  const types = parser.parseFromString(contentTypes, 'application/xml');
  for (const entry of Array.from(types.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override'))) {
    if (entry.getAttribute('ContentType') !== CHART_CONTENT_TYPE) continue;
    const path = entry.getAttribute('PartName')?.replace(/^\//, '');
    const part = path ? zip.file(path) : null;
    if (!path || !part) continue;

    const xml = parser.parseFromString(await part.async('text'), 'application/xml');
    const chart = child(xml.documentElement, 'chart');
    const area = child(chart, 'plotArea');
    const plots = Array.from(area?.children ?? []).filter(
      (element) => element.namespaceURI === CHART_NS && element.localName.endsWith('Chart'),
    );
    if (!chart || plots.length !== 1 || !SUPPORTED_PLOTS.has(plots[0].localName)) continue;

    const plot = plots[0];
    const series = child(plot, 'ser');
    const reference = child(child(series, 'cat'), 'multiLvlStrRef');
    const categories = series && reference ? readCategories(series, reference) : undefined;
    result.set(path, { title: readTitle(chart), categories });

    // The pie parser needs a recognized category cache before it can create slices.
    // It reads only the number of labels here; the decoded text is applied to its options below.
    if (plot.localName === 'pieChart' && reference && categories) {
      const stringRef = xml.createElementNS(CHART_NS, 'c:strRef');
      const formula = child(reference, 'f');
      if (formula) stringRef.append(formula.cloneNode(true));
      const cache = xml.createElementNS(CHART_NS, 'c:strCache');
      for (const [index, label] of categories.entries()) {
        const point = xml.createElementNS(CHART_NS, 'c:pt');
        point.setAttribute('idx', String(index));
        const value = xml.createElementNS(CHART_NS, 'c:v');
        value.textContent = label;
        point.append(value);
        cache.append(point);
      }
      stringRef.append(cache);
      reference.replaceWith(stringRef);
      zip.file(path, new XMLSerializer().serializeToString(xml));
    }
  }
}

type PreviewAxis = { type?: string; data?: string[] };
type PreviewSeries = { type: 'pie'; data: { name: string }[] } | { type: 'bar' | 'line'; data: number[] };
type PreviewNode = {
  nodes?: PreviewNode[];
  source?: { 'a:graphic'?: { 'a:graphicData'?: { 'c:chart'?: { attrs?: { 'r:id'?: string } } } } };
  ctx?: { rels?: Record<string, { type: string; target: string }> };
  options?: {
    animation?: boolean;
    title?: { text?: string; show?: boolean };
    xAxis?: PreviewAxis;
    yAxis?: PreviewAxis;
    series?: PreviewSeries[];
  };
};

export function applyChartText(nodes: PreviewNode[], chartText: ReadonlyMap<string, ChartText>): void {
  for (const node of nodes) {
    if (node.nodes) applyChartText(node.nodes, chartText);
    const { options } = node;
    if (!options?.series) continue;
    options.animation = false;

    // Use the same relationship as pptx-preview, even when IDs or filenames repeat.
    const id = node.source?.['a:graphic']?.['a:graphicData']?.['c:chart']?.attrs?.['r:id'];
    const relationship = id ? node.ctx?.rels?.[id] : undefined;
    const text = relationship?.type === 'chart' ? chartText.get(relationship.target) : undefined;
    if (!text) continue;

    options.title = { ...options.title, text: text.title, show: Boolean(text.title.trim()) };
    const { categories } = text;
    if (!categories) continue;
    const axis = options.xAxis?.type === 'category' ? options.xAxis : options.yAxis;
    if (axis?.type === 'category') axis.data = categories;
    const pie = options.series[0];
    if (pie?.type === 'pie') {
      pie.data.forEach((slice, index) => {
        slice.name = categories[index] ?? '';
      });
    }
  }
}
