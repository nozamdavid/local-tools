export interface AiModelInfo {
  id: string;
  name: string;
  sizeEstimate: string;
  sizeBytes: number;
  description: string;
  task: 'summarization' | 'translation';
  maxTokens: number;
  recommended?: boolean;
}

export interface TranslationPair {
  id: string;
  sourceLang: string;
  targetLang: string;
  label: string;
  modelId: string;
  sizeEstimate: string;
}

export interface ExtractedPageText {
  pageNum: number;
  paragraphs: string[];
  rawText: string;
}

export interface ExtractionResult {
  pages: ExtractedPageText[];
  totalChars: number;
  totalWords: number;
  hasText: boolean;
}

export interface TextChunk {
  index: number;
  text: string;
  pageHeader?: string;
  charCount: number;
}

export type AiWorkerInMessage =
  | {
      type: 'summarize';
      text: string;
      modelId: string;
      maxLength?: number;
      minLength?: number;
    }
  | {
      type: 'translate';
      chunks: string[];
      modelId: string;
    };

export type AiWorkerOutMessage =
  | {
      type: 'download_progress';
      progress: number;
      loaded: number;
      total: number;
      file?: string;
    }
  | {
      type: 'status';
      phase: 'downloading' | 'inferring';
      current?: number;
      total?: number;
      elapsedSeconds?: number;
    }
  | {
      type: 'chunk_complete';
      index: number;
      text: string;
    }
  | {
      type: 'complete';
      result: string;
    }
  | {
      type: 'error';
      error: string;
    };
