import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { topFraction } from '../core/barMapping';
import {
  classifyDrag,
  pageOffset,
  settlePage,
  settleStage,
  stageOffset,
  velocityOf,
  WheelPager,
  wheelPixels,
  type DragMode,
  type Sample,
  type Stage,
} from '../core/gestures';
import {
  bubbleCenter,
  bubbleHitRect,
  computeLayout,
  contains,
  inGuessRegion,
  topFractionForY,
} from '../core/layout';
import type { FeedModel } from '../store/feedModel';
import { useElementSize, useMediaQuery, useSettled } from './hooks';
import { Page } from './Page';
import { PieceDefs } from './PieceDefs';
import { Stats } from './Stats';
import { durations, rectStyle } from './style';

interface Drag {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly startsGuess: boolean;
  /** Where on the bubble the pointer landed, so the bubble does not jump on contact. */
  readonly grab: number;
  mode: DragMode;
  readonly samples: Sample[];
}

const INTERACTIVE = 'input, button, a, select, textarea';
const NUMERIC_KEY = /^[0-9.,+\-−]$/;
/** After a submit, paging waits this long, so a double Enter cannot skip the reveal. */
const SUBMIT_LOCK_MS = 250;

/**
 * The whole app: a vertical feed of positions, with Stats one sideways move to the right.
 * One pointer classifier serves the guess, the feed and the stage; one keyboard router
 * serves the typed flow (type, Enter to submit, Enter to move on).
 */
export function Game({ model }: { readonly model: FeedModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const size = useElementSize(column);
  const layout = useMemo(() => (size ? computeLayout(size.width, size.height) : null), [size]);

  const [stage, setStage] = useState<Stage>('feed');
  const [pageDrag, setPageDrag] = useState(0);
  const [stageDrag, setStageDrag] = useState(0);
  const [dragging, setDragging] = useState<'page' | 'stage' | null>(null);

  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  const motion = durations(reducedMotion);
  const settledVisible = useSettled(state.visible, motion.page + 40);
  const settledStage = useSettled(stage, motion.stage + 40);

  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const wheel = useRef<WheelPager | null>(null);
  const suppressClick = useRef(false);
  const lockUntil = useRef(0);

  const submit = () => {
    const now = performance.now();
    const s = model.getState();
    if (now < lockUntil.current || stage !== 'feed' || s.visible !== s.historyCount) return;
    lockUntil.current = now + SUBMIT_LOCK_MS;
    model.submit();
  };

  const pageTo = (target: number) => {
    if (performance.now() < lockUntil.current) return;
    model.show(target);
  };

  /** ↓ on the live page: a small rubber band that says there is nothing below. */
  const bounce = () => {
    setPageDrag(-24);
    window.setTimeout(() => setPageDrag(0), 140);
  };

  const openStats = () => {
    setStageDrag(0);
    setStage('stats');
  };

  const closeStats = () => {
    setStageDrag(0);
    setStage('feed');
  };

  const localPoint = (e: PointerEvent): Sample => {
    const r = column?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), t: e.timeStamp };
  };

  const onPointerDown = useEffectEvent((e: PointerEvent) => {
    if (!layout || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target instanceof Element ? e.target : null;
    const interactive = !!target?.closest(INTERACTIVE);
    // Keeps focus in the eval box and stops text selection while the board is dragged.
    if (!interactive) e.preventDefault();
    suppressClick.current = false;
    const p = localPoint(e);
    const s = model.getState();
    const live = stage === 'feed' && s.visible === s.historyCount && s.livePositionIndex !== null;
    const startsGuess = live && !interactive && inGuessRegion(layout, p.x, p.y);
    const top = topFraction(s.liveGuess);
    const grab =
      startsGuess && contains(bubbleHitRect(layout, top), p.x, p.y)
        ? p.y - bubbleCenter(layout, top).y
        : 0;
    drag.current = {
      id: e.pointerId,
      x0: p.x,
      y0: p.y,
      startsGuess,
      grab,
      mode: 'undecided',
      samples: [p],
    };
  });

  const onPointerMove = useEffectEvent((e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id || !layout || !column) return;
    const p = localPoint(e);
    d.samples.push(p);
    if (d.samples.length > 12) d.samples.shift();
    const dx = p.x - d.x0;
    const dy = p.y - d.y0;
    if (d.mode === 'undecided') {
      d.mode = classifyDrag(dx, dy, stage, d.startsGuess);
      if (d.mode === 'undecided') return;
      suppressClick.current = true;
      if (d.mode !== 'ignored') column.setPointerCapture(e.pointerId);
      if (d.mode === 'page' || d.mode === 'stage') setDragging(d.mode);
    }
    if (d.mode === 'guess') {
      model.setLiveGuessTopFraction(topFractionForY(layout, p.y - d.grab));
    } else if (d.mode === 'page') {
      setPageDrag(pageOffset(dy, model.getState().visible, model.lastPage, layout.pageH));
    } else if (d.mode === 'stage') {
      setStageDrag(stageOffset(dx, stage, layout.pageW));
    }
  });

  const onPointerEnd = useEffectEvent((e: PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (!layout) return;
    const p = localPoint(e);
    const { vx, vy } = velocityOf(d.samples);
    if (d.mode === 'page') {
      setDragging(null);
      setPageDrag(0);
      if (!cancelled) {
        const visible = model.getState().visible;
        model.show(settlePage(p.y - d.y0, vy, visible, model.lastPage, layout.pageH));
      }
    } else if (d.mode === 'stage') {
      setDragging(null);
      setStageDrag(0);
      if (!cancelled) setStage(settleStage(p.x - d.x0, vx, stage, layout.pageW));
    } else if (d.mode === 'undecided' && d.startsGuess && !cancelled) {
      // A plain click beside the board puts the guess there.
      model.setLiveGuessTopFraction(topFractionForY(layout, p.y - d.grab));
    }
  });

  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (!layout || stage !== 'feed' || e.ctrlKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    wheel.current ??= new WheelPager();
    const step = wheel.current.push(wheelPixels(e.deltaY, e.deltaMode, layout.pageH), e.timeStamp);
    if (step !== 0) model.show(model.getState().visible + step);
  });

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !layout) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const inBox = target?.tagName === 'INPUT';
    const onControl = !inBox && !!target?.closest('button, a');

    if (stage === 'stats') {
      if (e.key === 'Escape' || e.key === 'ArrowLeft') {
        e.preventDefault();
        closeStats();
      }
      return;
    }

    const s = model.getState();
    const live = s.visible === s.historyCount;
    switch (e.key) {
      case 'Enter':
        if (onControl) return; // a focused button or link keeps its own Enter
        e.preventDefault();
        if (e.repeat) return;
        if (live) submit();
        else pageTo(s.visible + 1);
        return;
      case 'ArrowDown':
      case 's':
      case 'S':
        e.preventDefault();
        if (!live) pageTo(s.visible + 1);
        else if (!e.repeat) bounce();
        return;
      case 'ArrowUp':
      case 'w':
      case 'W':
        e.preventDefault();
        pageTo(s.visible - 1);
        return;
      case 'Escape':
        if (inBox) target?.blur();
        return;
      default:
        if (live && !inBox && NUMERIC_KEY.test(e.key)) {
          inputRef.current?.focus({ preventScroll: true });
        }
    }
  });

  useEffect(() => {
    if (!column) return;
    const down = (e: PointerEvent) => onPointerDown(e);
    const move = (e: PointerEvent) => onPointerMove(e);
    const up = (e: PointerEvent) => onPointerEnd(e, false);
    const cancel = (e: PointerEvent) => onPointerEnd(e, true);
    const wheelHandler = (e: WheelEvent) => onWheel(e);
    const key = (e: KeyboardEvent) => onKeyDown(e);
    // The click that follows a drag must not press whatever the pointer ended on.
    const click = (e: MouseEvent) => {
      if (!suppressClick.current || e.detail === 0) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    };
    column.addEventListener('pointerdown', down);
    column.addEventListener('pointermove', move);
    column.addEventListener('pointerup', up);
    column.addEventListener('pointercancel', cancel);
    column.addEventListener('click', click, true);
    column.addEventListener('wheel', wheelHandler, { passive: false });
    document.addEventListener('keydown', key);
    return () => {
      column.removeEventListener('pointerdown', down);
      column.removeEventListener('pointermove', move);
      column.removeEventListener('pointerup', up);
      column.removeEventListener('pointercancel', cancel);
      column.removeEventListener('click', click, true);
      column.removeEventListener('wheel', wheelHandler);
      document.removeEventListener('keydown', key);
    };
  }, [column]);

  const indices = [state.visible - 1, state.visible, state.visible + 1].filter(
    (i) => i >= 0 && i <= state.historyCount,
  );
  const guessActive =
    stage === 'feed' &&
    settledStage === 'feed' &&
    dragging === null &&
    state.visible === settledVisible;
  const stageX = (stage === 'stats' && layout ? -layout.pageW : 0) + stageDrag;

  return (
    <div className="app" ref={setColumn}>
      <PieceDefs />
      {layout && (
        <div
          className={dragging === 'stage' ? 'stage-track dragging' : 'stage-track'}
          style={{ width: layout.pageW * 2, transform: `translate3d(${stageX}px, 0, 0)` }}
        >
          <main
            className={dragging === 'page' ? 'feed dragging' : 'feed'}
            style={{ width: layout.pageW }}
            inert={stage !== 'feed'}
            aria-label="Positions"
          >
            {model.showsEmptyState ? (
              <p className="boot">No positions available.</p>
            ) : (
              indices.map((i) => {
                const page = model.page(i);
                if (!page) return null;
                const onScreen = i === state.visible;
                const offset = (i - state.visible) * layout.pageH + pageDrag;
                return (
                  <div
                    key={i}
                    className="page-slot"
                    style={{ transform: `translate3d(0, ${offset}px, 0)` }}
                    inert={!onScreen}
                  >
                    <Page
                      page={page}
                      layout={layout}
                      liveGuess={state.liveGuess}
                      active={onScreen && guessActive}
                      finePointer={finePointer}
                      showHint={state.historyCount === 0}
                      inputRef={inputRef}
                      onGuess={(value) => model.setLiveGuessEval(value)}
                      onSubmit={submit}
                      onNext={() => pageTo(i + 1)}
                    />
                  </div>
                );
              })
            )}
            <button
              type="button"
              className="stats-link"
              style={rectStyle(layout.stats)}
              onClick={openStats}
            >
              Stats
            </button>
          </main>
          <Stats
            stats={state.stats}
            inert={stage !== 'stats'}
            style={{ left: layout.pageW, width: layout.pageW }}
            onBack={closeStats}
          />
        </div>
      )}
    </div>
  );
}
