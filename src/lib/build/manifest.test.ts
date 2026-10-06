import { describe, expect, it } from 'vitest';
import { FIREFOX_ID, firefoxVersion, manifestFor } from './manifest';

describe('manifestFor', () => {
  it('describes the same extension in every browser', () => {
    for (const browser of ['chrome', 'firefox']) {
      const manifest = manifestFor(browser);
      expect(manifest.name).toBe('poe2ultra');
      expect(manifest.permissions).toEqual(['storage', 'unlimitedStorage', 'contextMenus', 'scripting', 'activeTab']);
      expect(manifest.commands['translate-selection'].suggested_key.default).toBe('Alt+Q');
      expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
      expect(manifest.host_permissions).toEqual(['https://api.deepseek.com/*', 'https://poe2db.tw/*', 'https://api.tavily.com/*']);
      expect(manifest.homepage_url).toBe('https://github.com/ReSenpai/poe2perfect');
    }
  });

  // This fork must not impersonate or replace the upstream extension.
  it('gives the fork its own id and declares translation of website content', () => {
    expect(manifestFor('firefox').browser_specific_settings).toEqual({
      gecko: { id: FIREFOX_ID, strict_min_version: '140.0', data_collection_permissions: { required: ['websiteContent'] } },
    });
    expect(FIREFOX_ID).toBe('poe2ultra@local');
  });

  it('leaves Chrome without Firefox settings, which Chrome would refuse', () => {
    expect(manifestFor('chrome').browser_specific_settings).toBeUndefined();
    expect(manifestFor('chrome').version).toBeUndefined();
  });

  it('numbers the Firefox build itself, since addons.mozilla.org takes digits only', () => {
    expect(manifestFor('firefox', '1.3.0').version).toBe('1.3.0');
    expect(manifestFor('chrome', '1.3.0').version).toBeUndefined();
  });

  it('carries a tester build number through to the Firefox version', () => {
    expect(manifestFor('firefox', '1.3.0', 2).version).toBe('1.3.0.2');
    expect(manifestFor('chrome', '1.3.0', 2).version).toBeUndefined();
  });
});

describe('firefoxVersion', () => {
  it('keeps a release as it is', () => {
    expect(firefoxVersion('1.2.0')).toBe('1.2.0');
    expect(firefoxVersion('2.0.3')).toBe('2.0.3');
  });

  // addons.mozilla.org sorts versions as numbers, so a pre-release has to sit below the release it leads to.
  it('numbers a pre-release just below its release', () => {
    expect(firefoxVersion('1.3.0-beta.1')).toBe('1.2.999.1');
    expect(firefoxVersion('1.3.2-beta.4')).toBe('1.3.1.4');
    expect(firefoxVersion('2.0.0-beta.2')).toBe('1.999.999.2');
  });

  // While a release waits for review, testers get the same code signed unlisted — and AMO takes each number once,
  // so that package sits just above the release and below the next one.
  it('numbers a signed build for testers above the release it carries', () => {
    expect(firefoxVersion('1.3.0', 1)).toBe('1.3.0.1');
    expect(firefoxVersion('1.3.0', 2)).toBe('1.3.0.2');
    expect(firefoxVersion('1.3.0-beta.1', 1)).toBe('1.2.999.1');
  });

  it('refuses a version it cannot number, rather than guessing', () => {
    expect(() => firefoxVersion('1.2')).toThrow();
    expect(() => firefoxVersion('1.2.0-rc1')).toThrow();
  });
});
