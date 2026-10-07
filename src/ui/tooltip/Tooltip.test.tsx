import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { TooltipModel } from '@/lib/tooltip/tooltip-model';
import { TooltipProvider, WithTooltip } from './Tooltip';
import { TranslationProvider } from '@/ui/translation/BilingualText';

const MODEL: TooltipModel = {
  title: "Atziri's Disdain",
  subtitle: 'Helmets',
  iconUrl: 'https://cdn/atziri.webp',
  accent: 'unique',
  tags: ['Spell', 'AoE'],
  stats: [{ name: 'Energy Shield', value: '62' }],
  requirements: 'Level 40, Intelligence 58',
  description: 'A crown of thorns.',
  sections: [
    { title: null, lines: ['+(60-100) to maximum Mana'], tone: 'mod' },
    { title: 'Sockets', lines: ['Idol of Egrin'], tone: 'muted' },
  ],
  note: 'Modifier values are ranges',
  flavour: 'They screamed her name',
  corrupted: true,
};

function renderTrigger(model: TooltipModel | null = MODEL) {
  return render(
    <TooltipProvider>
      <p>
        Wear <WithTooltip model={model}>Atziri</WithTooltip> for ES.
      </p>
    </TooltipProvider>,
  );
}

const trigger = () => screen.getByText('Atziri');

describe('WithTooltip', () => {
  it('renders as an accessible button', () => {
    renderTrigger();

    expect(trigger().getAttribute('role')).toBe('button');
  });

  it('opens the tooltip on click', () => {
    renderTrigger();

    fireEvent.click(trigger());

    const tooltip = screen.getByRole('dialog');
    expect(trigger().getAttribute('aria-controls')).toBe(tooltip.id);
  });

  it('renders everything the model describes', () => {
    renderTrigger();
    fireEvent.click(trigger());

    const tooltip = screen.getByRole('dialog');
    expect(tooltip.classList.contains('tooltip--unique')).toBe(true);
    expect(tooltip.querySelector('img')?.getAttribute('src')).toBe('https://cdn/atziri.webp');
    for (const text of [
      "Atziri's Disdain",
      'Helmets',
      'Spell',
      'AoE',
      'Energy Shield',
      '62',
      'Requires: Level 40, Intelligence 58',
      'A crown of thorns.',
      '+(60-100) to maximum Mana',
      'Sockets',
      'Idol of Egrin',
      'Modifier values are ranges',
      'They screamed her name',
      'Corrupted',
    ]) {
      expect(tooltip.textContent).toContain(text);
    }
  });

  it('localizes fixed gem labels and quality heading without a model translation', () => {
    render(
      <TranslationProvider records={{}} locale="cn">
        <TooltipProvider>
          <WithTooltip model={{ ...MODEL, subtitle: 'Skill Gem', sections: [{ title: 'Additional Effects From Quality', lines: ['(0-20)% increased Cooldown Recovery Rate'], tone: 'muted' }] }}>Atziri</WithTooltip>
        </TooltipProvider>
      </TranslationProvider>,
    );
    fireEvent.click(trigger());
    const tooltip = screen.getByRole('dialog');
    expect(tooltip.textContent).toContain('技能宝石');
    expect(tooltip.textContent).toContain('品质附加效果');
    expect(tooltip.textContent).toContain('需求：等级 40, 智慧 58');
    expect(tooltip.textContent).not.toContain('Additional Effects From Quality');
  });

  it('does not open on hover', () => {
    renderTrigger();

    fireEvent.pointerOver(trigger());

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays pinned after opening until explicitly closed', () => {
    renderTrigger();
    fireEvent.click(trigger());

    fireEvent.pointerLeave(trigger());

    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger().hasAttribute('aria-controls')).toBe(false);
  });

  it('opens and closes with keyboard Enter and Space', () => {
    renderTrigger();

    expect(trigger().getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(trigger(), { key: ' ' });
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(trigger(), { key: ' ' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape while open', () => {
    renderTrigger();
    fireEvent.click(trigger());

    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays fixed when the page or details scroll', () => {
    renderTrigger();
    fireEvent.click(trigger());

    const before = screen.getByRole('dialog').style.cssText;
    fireEvent.scroll(document);
    fireEvent.scroll(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog').style.cssText).toBe(before);
  });

  it('closes on a second click of the same trigger', () => {
    renderTrigger();

    fireEvent.click(trigger());
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('positions the tooltip next to the trigger', () => {
    renderTrigger();
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 160, bottom: 120, width: 60, height: 20, x: 100, y: 100, toJSON: () => ({}) });

    fireEvent.click(trigger());

    const style = screen.getByRole('dialog').style;
    expect([style.left, style.top]).toEqual(['100px', '128px']);
  });

  it('keeps the pinned card on hover and switches to a nested trigger on click', () => {
    const rune = { ...MODEL, title: 'Idol of Egrin', subtitle: 'Socketable' };
    render(
      <TooltipProvider>
        <WithTooltip model={MODEL}>
          <span>Item card</span>
          <WithTooltip model={rune}>
            <img alt="rune" />
          </WithTooltip>
        </WithTooltip>
      </TooltipProvider>,
    );
    const title = () => screen.queryByRole('dialog')?.querySelector('.tooltip__title')?.textContent;

    fireEvent.click(screen.getByText('Item card'));
    expect(title()).toBe("Atziri's Disdain");

    const runeImage = screen.getByAltText('rune');
    fireEvent.pointerOver(runeImage);
    expect(title()).toBe("Atziri's Disdain");
    fireEvent.click(runeImage);
    expect(title()).toBe('Idol of Egrin');

    fireEvent.click(screen.getByText('Item card'));
    expect(title()).toBe("Atziri's Disdain");
  });

  it("renders above the guide's overlay, so the embedded site tree can't cover it", () => {
    const { container } = render(
      <div class="overlay">
        <TooltipProvider>
          <WithTooltip model={MODEL}>Atziri</WithTooltip>
        </TooltipProvider>
      </div>,
    );

    fireEvent.click(trigger());

    const tooltip = screen.getByRole('dialog');
    expect(container.querySelector('.overlay')?.contains(tooltip)).toBe(false);
    expect(container.contains(tooltip)).toBe(true);
  });

  it('renders just the content without a model', () => {
    const { container } = renderTrigger(null);

    expect(container.querySelector('p')?.textContent).toBe('Wear Atziri for ES.');
    expect(container.querySelector('[tabindex]')).toBeNull();
  });

  it('does not steal a click from an interactive child inside the trigger', () => {
    const onChildClick = vi.fn();
    render(
      <TooltipProvider>
        <WithTooltip model={MODEL}>
          Atziri <button onClick={onChildClick}>child</button>
        </WithTooltip>
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByText('child'));
    expect(onChildClick).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
