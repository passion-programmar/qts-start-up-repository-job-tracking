export function BidBars({
  items,
  emptyLabel,
}: {
  items: Array<{ label: string; count: number }>;
  emptyLabel: string;
}) {
  if (!items.length) {
    return <div className="text-muted">{emptyLabel}</div>;
  }

  const max = Math.max(...items.map((i) => Number(i.count) || 0), 1);

  return (
    <>
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-label">{item.label}</div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.round((Number(item.count) / max) * 100)}%` }}
            />
          </div>
          <div className="bar-count">{item.count}</div>
        </div>
      ))}
    </>
  );
}
