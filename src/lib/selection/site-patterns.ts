/**
 * Parse the supported browser match-pattern subset used to decide where the
 * selection translator is registered. One pattern per line.
 */
export function parseSiteMatchPatterns(raw: string): string[] {
  const patterns = String(raw ?? '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const unique = [...new Set(patterns)];
  for (const pattern of unique) {
    const match = /^(https?|\*):\/\/(\*\.)?([a-z0-9.-]+)(\/.*)$/i.exec(pattern);
    if (!match || match[3] === '*' || match[3].startsWith('.') || match[3].endsWith('.') || match[3].includes('..') ||
        match[3].split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
      throw new Error(`站点规则无效：${pattern}。请使用 https://example.com/* 或 https://*.example.com/* 格式；不能匹配所有网站。`);
    }
  }
  return unique;
}

/** Convert match patterns to optional host permission patterns (origin only). */
export function sitePermissionOrigins(raw: string): string[] {
  const patterns = parseSiteMatchPatterns(raw);
  const origins = new Set<string>();
  for (const pattern of patterns) {
    const match = /^(https?|\*):\/\/(\*\.)?([a-z0-9.-]+)\//i.exec(pattern)!;
    const schemes = match[1] === '*' ? ['http', 'https'] : [match[1].toLowerCase()];
    for (const scheme of schemes) origins.add(`${scheme}://${match[2] || ''}${match[3]}/*`);
  }
  return [...origins];
}

/** Same matching semantics for one-off injection into a tab that was already open. */
export function sitePatternMatchesUrl(raw: string, url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return parseSiteMatchPatterns(raw).some((pattern) => {
    const match = /^(https?|\*):\/\/(\*\.)?([a-z0-9.-]+)(\/.*)$/i.exec(pattern)!;
    const schemeMatches = match[1] === '*' || `${match[1].toLowerCase()}:` === parsed.protocol;
    const host = match[3].toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hostPattern = match[2] ? `(?:[^./]+\\.)?${host}` : host;
    const pathPattern = match[4].split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return schemeMatches && new RegExp(`^${hostPattern}$`, 'i').test(parsed.hostname) &&
      new RegExp(`^${pathPattern}$`).test(parsed.pathname);
  });
}
