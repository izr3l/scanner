"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ImagePlane({ width, height, children, className = "" }: { width: number; height: number; children: ReactNode; className?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const bounds = entry.contentRect;
      const ratio = width / Math.max(height, 1);
      const nextWidth = Math.min(bounds.width, bounds.height * ratio);
      setSize({ width: nextWidth, height: nextWidth / ratio });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height]);
  return <div className={`editor-image-stage ${className}`} ref={frame}><div className="editor-image-plane" style={{ width: size.width, height: size.height }}>{children}</div></div>;
}
