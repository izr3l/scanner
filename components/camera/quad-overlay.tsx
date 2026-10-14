'use client';
import { useLayoutEffect, useRef } from 'react';
import type { DetectionResult, Quad } from '@/lib/types';
export function QuadOverlay({ detection }: { detection: DetectionResult }) {
  const polygon = useRef<SVGPolygonElement>(null);
  const displayed = useRef<Quad>(detection.corners);
  useLayoutEffect(() => {
    const from = displayed.current;
    const to = detection.corners;
    let frame = 0;
    const start = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    polygon.current?.setAttribute('points', from.map((point) => `${point.x},${point.y}`).join(' '));
    function paint(now: number) {
      const progress = reduced ? 1 : Math.min(1, (now - start) / 120);
      const eased = 1 - Math.pow(1 - progress, 3);
      const corners = to.map((point, index) => ({ x: from[index].x + (point.x - from[index].x) * eased, y: from[index].y + (point.y - from[index].y) * eased })) as Quad;
      displayed.current = corners;
      polygon.current?.setAttribute('points', corners.map((point) => `${point.x},${point.y}`).join(' '));
      if (progress < 1) frame = requestAnimationFrame(paint);
    }
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [detection]);
  return <svg className="camera-quad" viewBox={`0 0 ${detection.width} ${detection.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true"><polygon ref={polygon} points={detection.corners.map((point) => `${point.x},${point.y}`).join(' ')} /></svg>;
}
