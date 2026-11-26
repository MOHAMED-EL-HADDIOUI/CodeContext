import React, { useEffect, useRef, useState } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  height: number;
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  empty?: React.ReactNode;
}

export function VirtualList<T>({ items, itemHeight, height, overscan = 8, className = '', getKey, renderItem, empty }: VirtualListProps<T>): React.ReactElement {
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef<number | null>(null);
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / itemHeight) + overscan);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return (
    <div className={`overflow-auto ${className}`} style={{ height }} onScroll={(event) => {
      const value = event.currentTarget.scrollTop;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => setScrollTop(value));
    }}>
      {items.length === 0 ? empty : <div className="relative" style={{ height: items.length * itemHeight }}>
        {items.slice(start, end).map((item, offset) => {
          const index = start + offset;
          return <div key={getKey(item, index)} className="absolute left-0 right-0" style={{ top: index * itemHeight, height: itemHeight }}>{renderItem(item, index)}</div>;
        })}
      </div>}
    </div>
  );
}
