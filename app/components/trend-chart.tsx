type Point = { label: string; planned: number; earned: number; actual: number };

function pathFor(
  points: Point[],
  key: "planned" | "earned" | "actual",
  max: number,
) {
  return points
    .map((point, index) => {
      const x = 8 + (index / Math.max(1, points.length - 1)) * 84;
      const y = 88 - (point[key] / Math.max(1, max)) * 72;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

export function TrendChart({ points }: { points: Point[] }) {
  const max = Math.max(
    ...points.flatMap((point) => [point.planned, point.earned, point.actual]),
    1,
  );
  return (
    <figure className="chart-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Labour trend</span>
          <h2>Plan, progress and hours used</h2>
        </div>
        <div className="chart-legend" aria-label="Chart legend">
          <span data-series="planned">Planned</span>
          <span data-series="earned">Earned</span>
          <span data-series="actual">Actual</span>
        </div>
      </div>
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label="Cumulative planned, earned and actual labour hours"
        preserveAspectRatio="none"
      >
        {[16, 34, 52, 70, 88].map((y) => (
          <line
            key={y}
            x1="8"
            x2="92"
            y1={y}
            y2={y}
            className="chart-gridline"
          />
        ))}
        <path d={pathFor(points, "planned", max)} className="chart-planned" />
        <path d={pathFor(points, "earned", max)} className="chart-earned" />
        <path d={pathFor(points, "actual", max)} className="chart-actual" />
      </svg>
      <figcaption>
        Earned below planned indicates programme slippage. Actual above earned
        indicates labour overrun.
      </figcaption>
    </figure>
  );
}

