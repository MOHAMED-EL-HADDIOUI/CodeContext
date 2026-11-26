import React, { useEffect, useRef, useState } from 'react';

interface VirtualTreeProps<T> {
  items: T[];
  itemHeight: number;
  getKey: (item: T) => string;
  children: (item: T) => React.ReactNode;
  empty?: React.ReactNode;
  className?: string;
  label?: string;
}

/** Fills the available explorer pane and only mounts rows near the viewport. */
export function VirtualTree<T>({ items, itemHeight, getKey, children, empty, className = '', label }: VirtualTreeProps<T>): React.ReactElement {
  const viewport = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const [range, setRange] = useState({ scrollTop: 0, height: 560 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRange((current) => ({ ...current, height: entry.contentRect.height }));
    });
    observer.observe(element);
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  const overscan = 8;
  const start = Math.max(0, Math.floor(range.scrollTop / itemHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((range.scrollTop + range.height) / itemHeight) + overscan);
  return (
    <div ref={viewport} className={`min-h-0 flex-1 overflow-auto ${className}`} role="list" aria-label={label} onScroll={(event) => {
      const scrollTop = event.currentTarget.scrollTop;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => setRange((current) => ({ ...current, scrollTop })));
    }}>
      {!items.length ? empty : <div className="relative" style={{ height: items.length * itemHeight }}>
        {items.slice(start, end).map((item, offset) => {
          const index = start + offset;
          return <div key={getKey(item)} role="listitem" className="absolute left-0 right-0" style={{ top: index * itemHeight, height: itemHeight }}>{children(item)}</div>;
        })}
      </div>}
    </div>
  );
}
