// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pawns } from '../../core/eval';
import { computeLayout } from '../../core/layout';
import { PositionSource } from '../../core/positions';
import { launch, makeDataset } from '../../store/__tests__/fixtures';
import { SoundSetting } from '../../store/soundSetting';
import { memoryStore } from '../../store/storage';
import { Game } from '../Game';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 393,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 800,
  });
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('pointer: fine'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

function setup() {
  const source = new PositionSource(makeDataset(30, 'test', () => 1.3));
  const model = launch(memoryStore(), source, 5);
  const sound = new SoundSetting(memoryStore());
  render(<Game model={model} sound={sound} />);
  const input = () => screen.getByLabelText(/your guess/i) as HTMLInputElement;
  return { model, input, sound };
}

describe('Game keyboard flow', () => {
  it('types a guess, submits with Enter, and moves on with Enter', async () => {
    const { model, input } = setup();
    await wait(20);
    expect(document.activeElement).toBe(input());

    fireEvent.change(input(), { target: { value: '1.3' } });
    expect(model.getState().liveGuess).toEqual(pawns(1.3));
    expect(screen.getAllByText('+1.30').length).toBeGreaterThan(0);

    fireEvent.change(input(), { target: { value: '1.3x' } });
    expect(input().value).toBe('1.3');

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(model.getState().historyCount).toBe(1);
    expect(model.getState().visible).toBe(0);
    expect(model.page(0)?.accuracy).toBe('exact');

    const link = screen.getByRole('link', { name: /lichess/i }) as HTMLAnchorElement;
    expect(link.href).toMatch(/#\d+$/);
    expect(link.target).toBe('_blank');

    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(model.getState().visible).toBe(0);

    await wait(300);
    fireEvent.keyDown(document.body, { key: 'Enter', repeat: true });
    expect(model.getState().visible).toBe(0);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(model.getState().visible).toBe(1);

    fireEvent.keyDown(document.body, { key: 's' });
    expect(model.getState().visible).toBe(1);
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(model.getState().visible).toBe(0);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(model.getState().visible).toBe(1);
    fireEvent.keyDown(document.body, { key: 'w' });
    expect(model.getState().visible).toBe(0);
  });

  it('submits from the button and from a numeric key typed with the box unfocused', async () => {
    const { model, input } = setup();
    await wait(20);
    input().blur();
    fireEvent.keyDown(document.body, { key: '2' });
    expect(document.activeElement).toBe(input());
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(model.getState().historyCount).toBe(1);
  });

  it('opens Stats from its link and returns with Escape', () => {
    setup();
    const stats = screen.getByRole('heading', { name: 'Stats' }).closest('section');
    expect(stats?.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stats' }));
    expect(stats?.hasAttribute('inert')).toBe(false);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(stats?.hasAttribute('inert')).toBe(true);
  });
});

describe('Game sound', () => {
  it('toggles sound from the speaker and from Stats, and remembers it', () => {
    const { sound } = setup();
    const speaker = document.querySelector('.sound-toggle')!;
    expect(speaker.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(speaker);
    expect(sound.on).toBe(false);
    expect(speaker.getAttribute('aria-pressed')).toBe('false');
    const row = document.querySelector('.stats-page .setting')!;
    expect(row.textContent).toBe('Off');
    fireEvent.click(row);
    expect(sound.on).toBe(true);
    expect(speaker.getAttribute('aria-pressed')).toBe('true');
  });

  it('submits without Web Audio, as in browsers that lack it', async () => {
    const { model, input } = setup();
    await wait(20);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(model.getState().historyCount).toBe(1);
  });
});

describe('Game reveal effects', () => {
  it('rings gold on the live page only, and never holds up Enter', async () => {
    const { model, input } = setup();
    await wait(20);
    fireEvent.change(input(), { target: { value: '1.3' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(model.page(0)?.accuracy).toBe('exact');
    expect(document.querySelector('.bubble.cheer-exact')).not.toBeNull();
    expect(document.querySelector('.bar.shimmer')).not.toBeNull();
    expect(document.querySelector('canvas.effects')).not.toBeNull();
    await wait(260);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(model.getState().visible).toBe(1);
    // Paging back remounts the answered page as history: no ring, no sweep.
    await wait(260);
    fireEvent.change(input(), { target: { value: '1.2' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(model.page(1)?.accuracy).toBe('close');
    expect(document.querySelector('.bubble.cheer-close')).not.toBeNull();
  });
});

describe('Game drawing', () => {
  const board = computeLayout(393, 800).board;
  const unit = board.width / 8;
  /** Page coordinates of the centre of the square in drawn column c, row r. */
  const at = (c: number, r: number) => ({
    clientX: board.x + (c + 0.5) * unit,
    clientY: board.y + (r + 0.5) * unit,
  });
  const mouse = { pointerType: 'mouse', pointerId: 1, isPrimary: true };

  it('draws a circle and an arrow with the right button, and a left click clears them', () => {
    setup();
    const svg = document.querySelector('.board')!;
    fireEvent.pointerDown(svg, { ...mouse, button: 2, ...at(4, 6) });
    fireEvent.pointerUp(svg, { ...mouse, button: 2, ...at(4, 6) });
    expect(document.querySelectorAll('.shapes circle')).toHaveLength(1);

    fireEvent.pointerDown(svg, { ...mouse, button: 2, shiftKey: true, ...at(4, 6) });
    fireEvent.pointerMove(svg, { ...mouse, buttons: 2, ...at(4, 4) });
    fireEvent.pointerUp(svg, { ...mouse, button: 2, ...at(4, 4) });
    expect(document.querySelectorAll('.shapes circle')).toHaveLength(1);
    expect(document.querySelector('.shapes line')?.getAttribute('stroke')).toBe('#882020');

    // Drawing the same circle again removes it.
    fireEvent.pointerDown(svg, { ...mouse, button: 2, ...at(4, 6) });
    fireEvent.pointerUp(svg, { ...mouse, button: 2, ...at(4, 6) });
    expect(document.querySelectorAll('.shapes circle')).toHaveLength(0);

    const menu = fireEvent.contextMenu(svg);
    expect(menu).toBe(false);

    fireEvent.pointerDown(svg, { ...mouse, button: 0, ...at(1, 1) });
    fireEvent.pointerUp(svg, { ...mouse, button: 0, ...at(1, 1) });
    expect(document.querySelector('.shapes')).toBeNull();
  });
});
