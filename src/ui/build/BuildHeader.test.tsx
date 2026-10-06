import { render } from '@testing-library/preact';
import { expect, it } from 'vitest';
import { parseBuild } from '@/lib/build/parse-build';
import { loadFixture } from '../../../tests/fixtures/load';
import { TranslationContext } from '@/ui/translation/BilingualText';
import { BuildHeader } from './BuildHeader';

const fixture = loadFixture('chaos-dot-lich-starter-deadrabbit');
const base = parseBuild(fixture.build, fixture.staticData);
const content = (text: string) => ({ root: { children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] } });

it('finds real overview text after a separator-only section and reuses its cached translation', () => {
  const source = 'A guide for Patch 0.5.5. '.repeat(15);
  const build = { ...base, sections: [{ id: 'separator', title: '', content: content('------------------') }, { id: 'overview', title: 'Overview', content: content(source) }] };
  const { container } = render(<TranslationContext.Provider value={{ locale: 'cn', texts: new Map([[source, '适用于 0.5.5 版本的攻略。']]) }}><BuildHeader build={build} /></TranslationContext.Provider>);
  const summary = container.querySelector('.build-header__summary');
  expect(summary?.textContent).toContain('A guide for Patch 0.5.5.');
  expect(summary?.textContent).not.toContain('------------------');
  expect(summary?.querySelector('[lang="zh-Hans"]')?.textContent).toBe('适用于 0.5.5 版本的攻略。');
});

it('removes the empty summary column when no readable summary exists', () => {
  const { container } = render(<BuildHeader build={{ ...base, sections: [{ id: 'separator', title: '', content: content('------------------') }] }} />);
  expect(container.querySelector('.build-header__summary')).toBeNull();
  expect(container.querySelector('.build-header--no-summary')).toBeTruthy();
});
