export type VideoMaxResolution = 'original' | '1080p' | '720p' | '480p';

export interface TextLayer {
  id: string;
  text: string;
  fontFamily: string;
  fontSize: number; // px relative to base preview
  fontWeight: string; // '400' | '600' | '700' | '900'
  color: string;
  letterSpacing: number; // in px
  opacity: number; // 0..1
  rotation: number; // degrees -180..180
  x: number; // fractional 0..1 (0.5 = center)
  y: number; // fractional 0..1 (0.5 = center)
}

export interface SegmentWorkerInitMessage {
  type: 'init';
  modelId?: string;
}

export interface SegmentWorkerSegmentMessage {
  type: 'segment';
  id: number;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type SegmentWorkerInMessage =
  | SegmentWorkerInitMessage
  | SegmentWorkerSegmentMessage;

export interface SegmentWorkerProgressMessage {
  type: 'progress';
  progress: {
    status?: string;
    file?: string;
    progress?: number;
    total?: number;
    loaded?: number;
  };
}

export interface SegmentWorkerReadyMessage {
  type: 'ready';
  device: string;
  model: string;
}

export interface SegmentWorkerErrorMessage {
  type: 'error';
  id?: number;
  error: string;
}

export interface SegmentWorkerResultMessage {
  type: 'result';
  id: number;
  mask: Uint8ClampedArray;
  width: number;
  height: number;
}

export type SegmentWorkerOutMessage =
  | SegmentWorkerProgressMessage
  | SegmentWorkerReadyMessage
  | SegmentWorkerErrorMessage
  | SegmentWorkerResultMessage;

export interface FrameProcessingProgress {
  currentFrame: number;
  totalFrames: number;
  fps: number;
  etaSeconds: number | null;
  phase: 'init' | 'processing' | 'encoding';
  statusText: string;
}
