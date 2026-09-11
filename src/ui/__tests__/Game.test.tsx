// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pawns } from '../../core/eval';
import { PositionSource } from '../../core/positions';
import { launch, makeDataset } from '../../store/__tests__/fixtures';
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
  render(<Game model={model} />);
  const input = () => screen.getByLabelText(/your guess/i) as HTMLInputElement;
  return { model, input };
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
