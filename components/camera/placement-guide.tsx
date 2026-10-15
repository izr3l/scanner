'use client';
import { useEffect, useId, useState, type RefObject } from 'react';
import { CAPTURE_GUIDES, getCaptureGuide } from '@/lib/camera-guide';
import type { ScanMode } from '@/lib/types';

interface Props {
  stage: RefObject<HTMLDivElement | null>;
  video: RefObject<HTMLVideoElement | null>;
  mode: ScanMode;
  backOfCard: boolean;
}

export function PlacementGuide({ stage, video, mode, backOfCard }: Props) {
  const maskId = useId();
  const [size, setSize] = useState({ width: 0, height: 0, videoWidth: 0, videoHeight: 0 });
  useEffect(() => {
    const element = stage.current;
    const source = video.current;
    if (!element || !source) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const next = { width: element.clientWidth || bounds.width, height: element.clientHeight || bounds.height, videoWidth: source.videoWidth, videoHeight: source.videoHeight };
      setSize((previous) => Object.keys(next).every((key) => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    source.addEventListener('loadedmetadata', measure);
    source.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); source.removeEventListener('loadedmetadata', measure); source.removeEventListener('resize', measure); };
  }, [stage, video]);
  const frame = getCaptureGuide(size.width, size.height, size.videoWidth, size.videoHeight, mode);
  if (!frame) return null;
  const { x, y, width, height } = frame;
  const label = mode === 'id' ? `${backOfCard ? 'Back' : 'Front'} of ID card · 85.6 × 53.98 mm` : CAPTURE_GUIDES[mode].label;
  const corner = Math.min(22, width / 5, height / 5);
  const radius = mode === 'id' ? Math.min(12, height * 0.06) : 3;
  return <svg className="camera-placement-guide" viewBox={`0 0 ${size.width} ${size.height}`} aria-label={`${label} placement guide`} role="img">
    <defs><mask id={maskId}><rect width={size.width} height={size.height} fill="white" /><rect {...frame} rx={radius} fill="black" /></mask></defs>
    <rect width={size.width} height={size.height} fill="#000000" fillOpacity="0.28" mask={`url(#${maskId})`} />
    <rect className="placement-outline" {...frame} rx={radius} />
    <path className="placement-corners" d={`M${x},${y + corner} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + corner} M${x + width - corner},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + corner} M${x + width},${y + height - corner} V${y + height - radius} Q${x + width},${y + height} ${x + width - radius},${y + height} H${x + width - corner} M${x + corner},${y + height} H${x + radius} Q${x},${y + height} ${x},${y + height - radius} V${y + height - corner}`} />
    <text className="placement-label" x={size.width / 2} y={Math.max(15, y - 13)} textAnchor="middle">{label}</text>
  </svg>;
}
