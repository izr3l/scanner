"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useReducedMotion } from "motion/react";

type Layer = { url: string; blob: Blob; key: string | undefined };
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
  const urls = useRef(new Set<string>());
  const timer = useRef<number | null>(null);
  const animation = useRef<number | null>(null);

  const revoke = useCallback((url: string) => { URL.revokeObjectURL(url); urls.current.delete(url); }, []);
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
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    for (const owned of urls.current) if (owned !== url && (!animate || owned !== prior?.url)) revoke(owned);
    const next = { current: { url, blob, key: transitionKey }, previous: animate ? prior ?? null : null, active: !animate };
    current.current = next;
    previousInstant.current = instant;
    setFrame(next);
  }, [blob, transitionKey, instant, reduced, cancelMotion, revoke]);

  useEffect(() => () => {
    cancelMotion();
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    current.current = null;
  }, [cancelMotion]);

  function imageLoaded(event: SyntheticEvent<HTMLImageElement>, url: string) {
    if (current.current?.current.url !== url) return;
    onLoad?.(event);
    if (!current.current.previous) return;
    animation.current = window.requestAnimationFrame(() => {
      if (current.current?.current.url !== url) return;
      animation.current = window.requestAnimationFrame(() => {
        const active = current.current;
        if (!active || active.current.url !== url) return;
        const next = { ...active, active: true };
        current.current = next;
        setFrame(next);
        timer.current = window.setTimeout(() => {
          const latest = current.current;
          if (!latest || latest.current.url !== url) return;
          if (latest.previous) revoke(latest.previous.url);
          const finished = { ...latest, previous: null };
          current.current = finished;
          setFrame(finished);
        }, 180);
      });
    });
  }

  return frame ? <div className={`preview-image-stack ${frame.active ? "is-active" : "is-pending"}`}>
    {frame.previous ? <img className="editor-rendered-image preview-image-previous" src={frame.previous.url} alt="" aria-hidden="true" draggable={false} /> : null}
    <img className="editor-rendered-image preview-image-current" src={frame.current.url} alt={alt} draggable={false} onLoad={(event) => imageLoaded(event, frame.current.url)} />
  </div> : null;
}
