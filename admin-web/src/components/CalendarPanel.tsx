'use client';

import { useMemo } from 'react';
import { formatDate } from '@/lib/utils';

type CalendarEvent = {
  date: string;
  label: string;
};

function toDateKey(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function CalendarPanel({
  month = new Date(),
  events = [],
  title = 'Calendar',
}: {
  month?: Date;
  events?: CalendarEvent[];
  title?: string;
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = toDateKey(event.date);
      if (!key) continue;
      const list = map.get(key) || [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const cells: Array<{ day: number | null; key: string }> = [];
  for (let i = 0; i < startOffset; i += 1) cells.push({ day: null, key: `pad-${i}` });
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, key });
  }

  const monthLabel = month.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const todayKey = toDateKey(new Date().toISOString());

  return (
    <div className="calendar-panel">
      <div className="calendar-panel-header">
        <div className="card-title">{title}</div>
        <div className="text-muted">{monthLabel}</div>
      </div>
      <div className="calendar-grid calendar-weekdays">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="calendar-weekday">{d}</div>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((cell) => {
          if (!cell.day) return <div key={cell.key} className="calendar-cell empty" />;
          const dayEvents = eventsByDay.get(cell.key) || [];
          const isToday = cell.key === todayKey;
          return (
            <div key={cell.key} className={`calendar-cell${isToday ? ' today' : ''}${dayEvents.length ? ' has-events' : ''}`}>
              <div className="calendar-day">{cell.day}</div>
              {dayEvents.slice(0, 2).map((event) => (
                <div className="calendar-event" key={`${cell.key}-${event.label}`} title={event.label}>
                  {event.label}
                </div>
              ))}
              {dayEvents.length > 2 && (
                <div className="calendar-more">+{dayEvents.length - 2} more</div>
              )}
            </div>
          );
        })}
      </div>
      {events.length > 0 && (
        <div className="calendar-upcoming">
          <div className="section-title">Upcoming</div>
          <ul>
            {events.slice(0, 5).map((event) => (
              <li key={`${event.date}-${event.label}`}>
                <strong>{formatDate(event.date)}</strong> — {event.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
