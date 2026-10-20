export type AnnotationType = 'text' | 'image' | 'rect' | 'drawing';

export interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  /** 1-based page number */
  pageNum: number;
  /** Percentage (0-100) from visual left */
  xPercent: number;
  /** Percentage (0-100) from visual bottom */
  yPercent: number;
  /** Percentage (0-100) of visual page width */
  widthPercent: number;
  /** Percentage (0-100) of visual page height */
  heightPercent: number;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  backgroundColor?: string;
}

export interface ImageAnnotation extends BaseAnnotation {
  type: 'image';
  /** Data URL of the image (PNG/JPEG) */
  dataUrl: string;
}

export interface RectAnnotation extends BaseAnnotation {
  type: 'rect';
  fillColor?: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface DrawingAnnotation extends BaseAnnotation {
  type: 'drawing';
  /** Transparent PNG data URL containing the strokes */
  dataUrl: string;
}

export type Annotation = TextAnnotation | ImageAnnotation | RectAnnotation | DrawingAnnotation;

export interface RedactionBox {
  id: string;
  /** 1-based page number */
  pageNum: number;
  /** Percentage (0-100) from visual left */
  xPercent: number;
  /** Percentage (0-100) from visual top */
  yTopPercent: number;
  /** Percentage (0-100) of visual page width */
  widthPercent: number;
  /** Percentage (0-100) of visual page height */
  heightPercent: number;
  color: string;
}

export type FormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list';

export interface FormFieldInfo {
  name: string;
  type: FormFieldType;
  isMultiline?: boolean;
  isPassword?: boolean;
  isReadOnly?: boolean;
  value: string | boolean | string[];
  options?: string[];
}
