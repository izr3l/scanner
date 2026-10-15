"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useReducedMotion } from "motion/react";
import { BlobImage } from "./blob-image";

type Layer = { id: number; blob: Blob; key: string | undefined };
type Frame = { current: Layer; previous: Layer | null; active: boolean };

/** Keep the outgoing pixels alive until the incoming image has decoded and the fade ends. */
export function PreviewImage({ blob, alt, transitionKey, instant = false, onLoad }: {
  blob: Blob;
  alt: string;
  transitionKey?: string;
  instant?: boolean;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState<Frame | null>(null);
  const current = useRef<Frame | null>(null);
  const previousInstant = useRef(instant);
  const nextId = useRef(0);
  const timer = useRef<number | null>(null);
  const animation = useRef<number | null>(null);

  const cancelMotion = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (animation.current !== null) window.cancelAnimationFrame(animation.current);
    timer.current = null;
    animation.current = null;
  }, []);

  useEffect(() => {
    if (current.current?.current.blob === blob) { previousInstant.current = instant; return; }
    cancelMotion();
    const prior = current.current?.active === false ? current.current.previous ?? current.current.current : current.current?.current;
    const animate = Boolean(prior && transitionKey !== undefined && prior.key !== transitionKey && !instant && !previousInstant.current && !reduced);
    const next = { current: { id: ++nextId.current, blob, key: transitionKey }, previous: animate ? prior ?? null : null, active: !animate };
    current.current = next;
    previousInstant.current = instant;
    setFrame(next);
  }, [blob, transitionKey, instant, reduced, cancelMotion]);

  useEffect(() => () => {
    cancelMotion();
    current.current = null;
  }, [cancelMotion]);

  function imageLoaded(event: SyntheticEvent<HTMLImageElement>, id: number) {
    if (current.current?.current.id !== id) return;
    onLoad?.(event);
    if (!current.current.previous) return;
    animation.current = window.requestAnimationFrame(() => {
      if (current.current?.current.id !== id) return;
      animation.current = window.requestAnimationFrame(() => {
        const active = current.current;
        if (!active || active.current.id !== id) return;
        const next = { ...active, active: true };
        current.current = next;
        setFrame(next);
        timer.current = window.setTimeout(() => {
          const latest = current.current;
          if (!latest || latest.current.id !== id) return;
          const finished = { ...latest, previous: null };
          current.current = finished;
          setFrame(finished);
        }, 180);
      });
    });
  }

  return frame ? <div className={`preview-image-stack ${frame.active ? "is-active" : "is-pending"}`}>
    {(frame.previous ? [frame.previous, frame.current] : [frame.current]).map((layer) => <BlobImage key={layer.id} blob={layer.blob} className={`editor-rendered-image ${layer.id === frame.current.id ? 'preview-image-current' : 'preview-image-previous'}`} alt={layer.id === frame.current.id ? alt : ''} aria-hidden={layer.id === frame.current.id ? undefined : true} draggable={false} onLoad={(event) => imageLoaded(event, layer.id)} />)}
  </div> : null;
}
