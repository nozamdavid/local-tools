export type LayerType = 'text' | 'image' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'path' | 'badge' | 'callout' | 'redact';

export interface BaseLayer {
  id: string;
  type: LayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // in degrees
  opacity?: number; // 0 to 1
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  bgBox?: boolean;
  bgBoxColor?: string;
  bgBoxOpacity?: number;
  bgBoxPadding?: number;
  bgBoxRadius?: number;
  uppercase?: boolean;
  autoFit?: boolean;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  image: HTMLImageElement | HTMLCanvasElement;
}

export interface RectLayer extends BaseLayer {
  type: 'rect';
  stroke: string;
  strokeWidth: number;
  fill?: string;
}

export interface EllipseLayer extends BaseLayer {
  type: 'ellipse';
  stroke: string;
  strokeWidth: number;
  fill?: string;
}

export interface ArrowLayer extends BaseLayer {
  type: 'arrow';
  stroke: string;
  strokeWidth: number;
}

export interface LineLayer extends BaseLayer {
  type: 'line';
  stroke: string;
  strokeWidth: number;
}

export interface PathLayer extends BaseLayer {
  type: 'path';
  points: Array<{ x: number; y: number }>;
  stroke: string;
  strokeWidth: number;
  isEraser?: boolean;
  isHighlighter?: boolean;
}

export interface BadgeLayer extends BaseLayer {
  type: 'badge';
  number: number;
  fill: string;
  textColor: string;
}

export interface CalloutLayer extends BaseLayer {
  type: 'callout';
  text: string;
  fill: string;
  textColor: string;
  fontSize: number;
  tailDirection?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
}

export interface RedactLayer extends BaseLayer {
  type: 'redact';
  redactType: 'blur' | 'pixelate';
}

export type Layer =
  TextLayer | ImageLayer | RectLayer | EllipseLayer | ArrowLayer | LineLayer | PathLayer | BadgeLayer | CalloutLayer | RedactLayer;

export interface Adjustments {
  brightness: number; // 0 to 200 (100 = default)
  contrast: number; // 0 to 200 (100 = default)
  saturation: number; // 0 to 200 (100 = default)
  blur: number; // 0 to 20 px (0 = default)
  preset?: 'none' | 'vivid' | 'mono' | 'sepia' | 'vintage' | 'cool' | 'warm';
}

export interface CanvasDocument {
  width: number;
  height: number;
  baseImage: HTMLImageElement | HTMLCanvasElement | null;
  backgroundColor?: string;
  adjustments?: Adjustments;
  layers: Layer[];
}

export type TransformHandle = 'nw' | 'ne' | 'se' | 'sw' | 'rot';
