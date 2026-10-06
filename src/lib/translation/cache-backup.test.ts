import { expect, it } from 'vitest';
import { createCacheBackup, validateCacheBackup } from './cache-backup';
import { defaultSettings } from './settings';

const key = 'c'.repeat(64);
const sample = () => createCacheBackup([[key, { cn: ['简中'], tw: ['繁中'] }]],
  { ...defaultSettings, apiKey: 'PRIVATE KEY', tavilyApiKey: 'PRIVATE SEARCH', extraHeaders: '{"Authorization":"SECRET"}',
    systemPrompt: 'selection only', model: 'custom-model', glossaryEnabled: true },
  { systemPrompt: 'legacy cached system', userPrompt: 'legacy cached user' },
  { entries: [{ e: 'Abyssal Lich', c: '深渊巫妖', t: '深淵妖巫' }] });

it('backs up both translations and matching parameters without credentials', () => {
  const backup = sample();
  expect(backup.kind).toBe('poe2ultra-translation-cache');
  expect(backup.records).toEqual([[key, { cn: ['简中'], tw: ['繁中'] }]]);
  expect(backup.settings.model).toBe('custom-model');
  expect(backup.legacyCachePrompts.systemPrompt).toBe('legacy cached system');
  expect(backup.glossaryOverride?.entries).toHaveLength(1);
  expect(JSON.stringify(backup)).not.toMatch(/PRIVATE KEY|PRIVATE SEARCH|SECRET|Authorization/);
  expect(validateCacheBackup(backup)).toEqual(backup);
});

it('rejects corrupted, duplicated or unrelated files before any cache write', () => {
  const backup = sample();
  expect(() => validateCacheBackup({ ...backup, kind: 'poe2ultra-debug' })).toThrow();
  expect(() => validateCacheBackup({ ...backup, schemaVersion: 2 })).toThrow();
  expect(() => validateCacheBackup({ ...backup, records: [...backup.records, backup.records[0]] })).toThrow();
  expect(() => validateCacheBackup({ ...backup, records: [[key, { cn: [], tw: ['繁中'] }]] })).toThrow();
  expect(() => validateCacheBackup({ ...backup, records: [['not-a-hash', backup.records[0]![1]]] })).toThrow();
  expect(() => validateCacheBackup({ ...backup, settings: { ...backup.settings, model: '' } })).toThrow();
  expect(() => validateCacheBackup({ ...backup, records: [[key, { cn: ['简中'], tw: ['繁中'], source: 3 }]] })).toThrow();
});

it('includes English source in new records while accepting old backups without it', () => {
  expect(validateCacheBackup(sample()).records[0]![1].source).toBeUndefined();
  const backup = sample();
  backup.records[0]![1].source = 'Original, text';
  expect(validateCacheBackup(backup).records[0]![1].source).toBe('Original, text');
});

it('backs up cost receipts and accepts older backups without cost history', () => {
  const receipt = { id: 'b5c186a4-0b0d-4734-abcf-a4b24022a947', guideKey: 'https://mobalytics.gg/poe-2/builds/example', cny: 0.0123, at: '2026-10-06T00:00:00.000Z' };
  const backup = sample();
  backup.guideCosts = [receipt];
  expect(validateCacheBackup(backup).guideCosts).toEqual([receipt]);
  expect(validateCacheBackup({ ...backup, guideCosts: undefined }).guideCosts).toBeUndefined();
  expect(() => validateCacheBackup({ ...backup, guideCosts: [{ ...receipt, cny: -1 }] })).toThrow();
  expect(() => validateCacheBackup({ ...backup, guideCosts: [receipt, receipt] })).toThrow();
});
