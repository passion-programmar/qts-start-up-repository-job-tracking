export function LineChart({
  items,
  emptyLabel,
  stroke = '#2563eb',
}: {
  items: Array<{ label: string; count: number }>;
  emptyLabel: string;
  stroke?: string;
}) {
  if (!items.length) {
    return <div className="text-muted">{emptyLabel}</div>;
  }

  const ordered = [...items].reverse();
  const width = 520;
  const height = 180;
  const padX = 28;
  const padY = 20;
  const max = Math.max(...ordered.map((i) => Number(i.count) || 0), 1);
  const stepX = ordered.length > 1 ? (width - padX * 2) / (ordered.length - 1) : 0;

  const points = ordered.map((item, index) => {
    const x = padX + stepX * index;
    const y = height - padY - ((Number(item.count) || 0) / max) * (height - padY * 2);
    return { x, y, item };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#e2e8f0" />
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline}
        />
        {points.map((p) => (
          <g key={p.item.label}>
            <circle cx={p.x} cy={p.y} r="4" fill={stroke} />
            <text x={p.x} y={height - 4} textAnchor="middle" fontSize="10" fill="#64748b">
              {p.item.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
