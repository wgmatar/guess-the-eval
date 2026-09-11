import {
  arrowGeometry,
  BRUSHES,
  centre,
  CIRCLE_RADIUS,
  CIRCLE_WIDTH,
  isShort,
  opacity,
  sameEndpoints,
  type Shape,
} from '../core/shapes';

interface Props {
  readonly shapes: readonly Shape[];
  /** The shape under the pointer while the right button is held. */
  readonly current: Shape | null;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly flipped: boolean;
}

interface Drawn {
  readonly shape: Shape;
  readonly current: boolean;
  readonly pendingErase: boolean;
}

/**
 * Arrows and circles over the board, drawn as chessground draws them. A separate SVG, so the
 * memoised board never redraws. It never takes the pointer.
 */
export function Shapes({ shapes, current, size, x, y, flipped }: Props) {
  if (shapes.length === 0 && !current) return null;
  // Redrawing an existing shape with its own brush previews its removal instead of a duplicate.
  const pending = current
    ? shapes.findIndex((s) => sameEndpoints(s, current) && s.brush === current.brush)
    : -1;
  const drawn: Drawn[] = shapes.map((shape, i) => ({
    shape,
    current: false,
    pendingErase: i === pending,
  }));
  if (current && pending === -1) drawn.push({ shape: current, current: true, pendingErase: false });
  const arrows = drawn.map((d) => d.shape).filter((s) => s.dest !== null);

  return (
    <svg
      className="shapes"
      viewBox="0 0 8 8"
      width={size}
      height={size}
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      {drawn.map(({ shape, current: isCurrent, pendingErase }) => {
        const brush = BRUSHES[shape.brush];
        const alpha = opacity(shape.brush, isCurrent, pendingErase);
        const key = `${shape.orig}${shape.dest ?? ''}${isCurrent ? '*' : ''}`;
        if (shape.dest === null || shape.dest === shape.orig) {
          const [cx, cy] = centre(shape.orig, flipped);
          return (
            <circle
              key={key}
              cx={cx}
              cy={cy}
              r={CIRCLE_RADIUS}
              fill="none"
              stroke={brush.color}
              strokeWidth={isCurrent ? CIRCLE_WIDTH.current : CIRCLE_WIDTH.done}
              opacity={alpha}
            />
          );
        }
        const g = arrowGeometry(
          shape.orig,
          shape.dest,
          shape.brush,
          flipped,
          isCurrent,
          isShort(shape.dest, arrows),
        );
        return (
          <g key={key} opacity={alpha}>
            <line
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
              stroke={brush.color}
              strokeWidth={g.width}
              strokeLinecap="round"
            />
            <polygon points={g.head} fill={brush.color} />
          </g>
        );
      })}
    </svg>
  );
}
