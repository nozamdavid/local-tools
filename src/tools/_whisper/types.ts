export type WhisperModel = 'onnx-community/whisper-tiny' | 'onnx-community/whisper-base' | 'onnx-community/whisper-small';

export type WhisperTask = 'transcribe' | 'translate';

export interface WhisperModelOption {
  value: WhisperModel;
  label: string;
  size: string;
}

export const WHISPER_MODELS: WhisperModelOption[] = [
  {
    value: 'onnx-community/whisper-tiny',
    label: 'Whisper Tiny (Multilingual ~75MB - Fastest)',
    size: '~75 MB',
  },
  {
    value: 'onnx-community/whisper-base',
    label: 'Whisper Base (Multilingual ~145MB - Balanced)',
    size: '~145 MB',
  },
  {
    value: 'onnx-community/whisper-small',
    label: 'Whisper Small (Multilingual ~480MB - Most Accurate)',
    size: '~480 MB',
  },
];

export interface WhisperLanguageOption {
  value: string;
  label: string;
}

export const WHISPER_LANGUAGES: WhisperLanguageOption[] = [
  { value: '', label: 'Auto-detect' },
  { value: 'english', label: 'English' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'french', label: 'French' },
  { value: 'german', label: 'German' },
  { value: 'italian', label: 'Italian' },
  { value: 'portuguese', label: 'Portuguese' },
  { value: 'dutch', label: 'Dutch' },
  { value: 'russian', label: 'Russian' },
  { value: 'chinese', label: 'Chinese' },
  { value: 'japanese', label: 'Japanese' },
  { value: 'korean', label: 'Korean' },
  { value: 'arabic', label: 'Arabic' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'turkish', label: 'Turkish' },
  { value: 'polish', label: 'Polish' },
  { value: 'vietnamese', label: 'Vietnamese' },
  { value: 'ukrainian', label: 'Ukrainian' },
];

export interface WhisperChunk {
  text: string;
  timestamp: [number, number | null];
}

export interface SubtitleCue {
  id: string;
  start: number; // in seconds
  end: number; // in seconds
  text: string;
}

export type TranscriptionPhase = 'idle' | 'extracting' | 'downloading' | 'transcribing' | 'burning' | 'done';

export interface ProgressState {
  phase: TranscriptionPhase;
  ratio: number; // 0 to 1
  label: string;
  elapsedSeconds?: number;
}

export type WorkerInMessage = {
  type: 'transcribe';
  audio: Float32Array;
  model: WhisperModel;
  language?: string;
  task?: WhisperTask;
};

export type WorkerOutMessage =
  | { type: 'download_progress'; progress: number; loaded?: number; total?: number; file?: string }
  | { type: 'status'; phase: 'transcribing'; elapsedSeconds: number }
  | { type: 'complete'; text: string; chunks: WhisperChunk[] }
  | { type: 'error'; error: string };
