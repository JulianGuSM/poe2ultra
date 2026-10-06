export type TranslationStage = 'checking' | 'queued' | 'glossary' | 'context' | 'requesting' | 'reasoning' | 'receiving' | 'validating' | 'saving';
export interface Activity {
  stage: TranslationStage;
  batch?: number;
  batches?: number;
  receivedChars?: number;
  modelRequest?: boolean;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number; total_tokens?: number } | null;
}
export type ReportActivity = (activity: Activity) => void;
