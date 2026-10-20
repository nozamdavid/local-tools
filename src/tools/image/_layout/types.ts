export type FitMode = 'cover' | 'contain';
export type BgType = 'blur' | 'color';
export type ExportMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface TransformState {
  zoom: number; // 1.0 to 3.0+
  panX: number; // target-canvas coordinates
  panY: number; // target-canvas coordinates
}

export interface SafeZoneBox {
  type: 'box';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SafeZoneEdge {
  type: 'top' | 'bottom';
  label: string;
  size: number; // px from edge
}

export interface SafeZoneCircle {
  type: 'circle';
  label: string;
  cx: number;
  cy: number;
  radius: number;
}

export type SafeZoneGuide = SafeZoneBox | SafeZoneEdge | SafeZoneCircle;

export interface FrameConfig {
  id: string;
  name: string;
  width: number;
  height: number;
  description?: string;
  guides?: SafeZoneGuide[];
  isCirclePreview?: boolean;
  allowCircularExport?: boolean;
  warnIfOverBytes?: number; // e.g. 2 * 1024 * 1024 for YT thumbnail
}
