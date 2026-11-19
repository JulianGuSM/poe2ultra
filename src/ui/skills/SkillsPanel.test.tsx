import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { Build, Variant } from '@/lib/build/model';
import { parseBuild } from '@/lib/build/parse-build';
import { TooltipProvider } from '@/ui/tooltip/Tooltip';
import { loadFixture } from '../../../tests/fixtures/load';
import { SkillsPanel } from './SkillsPanel';
import { TranslationProvider } from '@/ui/translation/BilingualText';
import { ToastProvider } from '@/ui/common/Toast';

const fixture = loadFixture('chaos-dot-lich-starter-deadrabbit');
const BUILD: Build = parseBuild(fixture.build, fixture.staticData);
const ENDGAME = BUILD.variants.find((v) => v.title === 'ENDGAME (FULL LIFE)')!;

function renderPanel(variant: Variant = ENDGAME, copy = vi.fn(async () => true)) {
  const view = render(
    <ToastProvider><TooltipProvider>
      <SkillsPanel variant={variant} entities={BUILD.entities} copy={copy} />
    </TooltipProvider></ToastProvider>,
  );
  const expandPriority = screen.queryByRole('button', { name: 'Expand Gem Priority' });
  if (expandPriority) fireEvent.click(expandPriority);
  return { ...view, copy };
}

const skillList = () => screen.getByRole('list', { name: 'Active skills' });
const skillButton = (name: string) => within(skillList()).getByRole('button', { name: new RegExp(`^${name}`) });
const details = () => screen.getByRole('region', { name: 'Skill details' });

describe('SkillsPanel', () => {
  it('localizes the quality effects heading in skill details', () => {
    const first = ENDGAME.skills[0]!;
    const variant = { ...ENDGAME, skills: [{ ...first, gem: { ...first.gem, details: { ...first.gem.details!, qualityEffects: ['(0-20)% increased Cooldown Recovery Rate'] } } }] };
    render(
      <TranslationProvider records={{}} locale="cn">
        <TooltipProvider><SkillsPanel variant={variant} entities={BUILD.entities} /></TooltipProvider>
      </TranslationProvider>,
    );
    fireEvent.click(skillButton(first.gem.name));
    expect(screen.getByText('品质附加效果')).toBeTruthy();
    expect(screen.queryByText('Additional Effects From Quality')).toBeNull();
  });

  // The gem name is what you paste into the game's own search.
  it('copies the name of an active skill, and says it did', async () => {
    const { copy } = renderPanel();

    fireEvent.click(skillButton('Contagion'));

    expect(copy).toHaveBeenCalledWith('Contagion');
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Copied “Contagion”');
  });

  it('copies the name and opens details when clicking a support gem inside its button', () => {
    const { copy } = renderPanel();

    const row = skillButton('Essence Drain').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Copy “Chain II”' }).querySelector('.skill-row__support')!);

    expect(copy).toHaveBeenCalledWith('Chain II');
    expect(screen.getByRole('dialog').querySelector('.tooltip__title')?.textContent).toBe('Chain II');
  });

  it('copies the name of a gem from the priority list', () => {
    const { copy } = renderPanel();

    const first = within(screen.getByRole('list', { name: 'Gem priority' })).getAllByRole('listitem')[0]!;
    const name = first.querySelector('.gem-priority__name')!.textContent;
    fireEvent.click(within(first).getByRole('button', { name: `Copy “${name}”` }));

    expect(copy).toHaveBeenCalledWith(name);
    expect(screen.getByRole('dialog').querySelector('.tooltip__title')?.textContent).toBe(name);
  });

  it('copies the name of the active skill and of its supports', () => {
    const { copy } = renderPanel();

    fireEvent.click(skillButton('Essence Drain'));
    expect(copy).toHaveBeenCalledWith('Essence Drain');

    const row = skillButton('Essence Drain').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Copy “Chain II”' }).querySelector('.skill-row__support')!);
    expect(copy).toHaveBeenLastCalledWith('Chain II');
    expect(screen.getByRole('dialog').querySelector('.tooltip__title')?.textContent).toBe('Chain II');
  });

  it('says when the browser would not let it copy', async () => {
    renderPanel(ENDGAME, vi.fn(async () => false));

    fireEvent.click(skillButton('Contagion'));

    expect((await screen.findByRole('status')).textContent).toBe("Couldn't copy the name");
  });

  it('lists active skills without repeating tooltip tags, with the first one selected', () => {
    renderPanel();

    const buttons = [...skillList().querySelectorAll('.skill-row__main')];
    expect(buttons.map((b) => b.querySelector('.skill-row__name')?.textContent)).toEqual(ENDGAME.skills.map((s) => s.gem.name));
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('false');
    expect(buttons[0]?.querySelector('.skill-row__tags')).toBeNull();
  });

  it('shows support gem icons on each row, with tooltips', () => {
    renderPanel();

    const row = skillButton('Essence Drain').closest('li')!;
    const supports = row.querySelectorAll('.skill-row__support');
    expect(supports).toHaveLength(5);

    fireEvent.click(supports[0]!.closest('.tooltip-trigger')!);
    const tooltip = screen.getByRole('dialog');
    expect(tooltip.querySelector('.tooltip__title')?.textContent).toBe('Chain II');
    expect(tooltip.textContent).toContain('Support Gem');
  });

  it('shows bilingual details in a dismissible tooltip when an active skill is clicked', () => {
    renderPanel();

    fireEvent.click(skillButton('Essence Drain'));
    const tooltip = screen.getByRole('dialog');
    expect(tooltip.querySelector('.tooltip__title')?.textContent).toBe('Essence Drain');
    expect(tooltip.textContent).toContain('Mana Range');
    expect(tooltip.textContent).toContain('Requires: Level');
    expect(tooltip.querySelector('.tooltip__description')?.textContent).toMatch(/\w+/);
    expect(tooltip.querySelectorAll('.tooltip__section li').length).toBeGreaterThan(0);
    fireEvent.click(within(tooltip).getByRole('button', { name: /Close details/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the clicked skill details without adding a details column', () => {
    renderPanel();

    fireEvent.click(skillButton('Contagion'));

    expect(skillButton('Contagion').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('dialog').querySelector('.tooltip__title')?.textContent).toBe('Contagion');
    expect(screen.getByRole('dialog').querySelector('.tooltip__tags')?.textContent).toContain('Duration');
    expect(document.querySelector('.skill-details')).toBeNull();
  });

  it('shows the attributes the gems require', () => {
    renderPanel();

    expect(screen.getByText('Str 20 · Dex 25 · Int 100')).toBeTruthy();
  });

  it('lists the gem priority in order, with the skill each gem supports', () => {
    renderPanel();

    const rows = within(screen.getByRole('list', { name: 'Gem priority' })).getAllByRole('listitem');
    expect(rows).toHaveLength(ENDGAME.gemPriority.length);
    expect(rows[0]?.querySelector('.gem-priority__number')?.textContent).toBe('1');
    expect(rows[0]?.querySelector('.gem-priority__name')?.textContent).toBe('Chain II');
    expect(rows[0]?.querySelector('.gem-priority__parent')?.textContent).toBe('Essence Drain');

    fireEvent.click(rows[0]!.querySelector('.tooltip-trigger')!);
    expect(screen.getByRole('dialog').querySelector('.tooltip__title')?.textContent).toBe('Chain II');
  });

  it('highlights the priority entries of the selected skill', () => {
    renderPanel();
    const current = () =>
      [...screen.getByRole('list', { name: 'Gem priority' }).querySelectorAll('.gem-priority__row--current .gem-priority__parent')].map((el) => el.textContent);

    expect(new Set(current())).toEqual(new Set(['Essence Drain']));

    fireEvent.click(skillButton('Contagion'));
    expect(new Set(current())).toEqual(new Set(['Contagion']));
  });

  it('marks the support in Active Skills while the pointer rests on its gem priority entry', () => {
    renderPanel();
    const row = within(screen.getByRole('list', { name: 'Gem priority' })).getAllByRole('listitem')[0]!;
    const marks = () =>
      [...screen.getByRole('list', { name: 'Active skills' }).querySelectorAll('.skill-row__support--match')].map(
        (icon) => [icon.closest('.skill-row')!.querySelector('.skill-row__name')!.textContent, icon.getAttribute('src')],
      );

    fireEvent.pointerEnter(row);
    // Chain II belongs to Essence Drain: only that row's socket lights up, even if another skill uses the same support.
    expect(marks()).toEqual([['Essence Drain', ENDGAME.gemPriority[0]!.gem.iconUrl]]);

    fireEvent.pointerLeave(row);
    expect(marks()).toEqual([]);
  });

  it('marks the skill itself for a priority entry that is an active skill', () => {
    const skill = ENDGAME.skills[1]!;
    renderPanel({ ...ENDGAME, gemPriority: [{ gem: skill.gem, parentSlug: null, parentName: null }] });
    const row = within(screen.getByRole('list', { name: 'Gem priority' })).getAllByRole('listitem')[0]!;

    fireEvent.focusIn(row);

    const marked = screen.getByRole('list', { name: 'Active skills' }).querySelectorAll('.skill-row--match');
    expect([...marked].map((el) => el.querySelector('.skill-row__name')?.textContent)).toEqual([skill.gem.name]);
  });

  it('leaves out the gem priority when the author set none', () => {
    renderPanel({ ...ENDGAME, gemPriority: [] });

    expect(screen.queryByRole('list', { name: 'Gem priority' })).toBeNull();
  });

  it("shows the author's skill notes below the skills", () => {
    const { container } = renderPanel();

    const notes = screen.getByRole('heading', { level: 2, name: "Author's Notes" }).closest('section')!;
    expect(container.querySelector('.skills__columns')!.contains(notes)).toBe(false);
  });

  it('opens a tooltip for a gem without static detail data', () => {
    const bare: Variant = { ...ENDGAME, skills: ENDGAME.skills.map((s) => ({ gem: { ...s.gem, details: null }, supports: [] })) };
    renderPanel(bare);

    fireEvent.click(skillButton(bare.skills[0]!.gem.name));
    expect(screen.getByRole('dialog').querySelector('.tooltip__title')?.textContent).toBe(bare.skills[0]!.gem.name);
  });

  it('explains a variant without skills', () => {
    renderPanel({ ...ENDGAME, skills: [], gemRequirements: null, skillNotes: null });

    expect(screen.getByText("The author hasn't listed skills for this variant.")).toBeTruthy();
  });
});
