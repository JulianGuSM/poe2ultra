export type TranslationStage = 'checking' | 'queued' | 'glossary' | 'context' | 'requesting' | 'reasoning' | 'receiving' | 'validating' | 'saving';
export interface Activity {
  stage: TranslationStage;
  batch?: number;
  batches?: number;
  receivedChars?: number;
}
export type ReportActivity = (activity: Activity) => void;
