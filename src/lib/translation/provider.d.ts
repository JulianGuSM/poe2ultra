import type { Settings } from './settings';
import type { Segment, Translation } from './plan';
import type { ReportActivity } from './activity';
import type { BatchDebug } from './debug';
export const defaultSettings: Settings;
export function translateBatch(batch: Segment[], settings: Settings, signal: AbortSignal, report?: ReportActivity, glossary?: unknown, debug?: BatchDebug): Promise<{
  translations: Translation[]; warnings: string[]; usage: { total_tokens?: number } | null;
}>;
