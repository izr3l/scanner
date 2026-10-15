"use client";

import { useLayoutEffect, useRef, type ImgHTMLAttributes, type RefObject, type SyntheticEvent } from "react";
import { acquireObjectUrl } from "../../lib/object-url";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "alt"> & {
  blob: Blob | null | undefined;
  alt: string;
  imageRef?: RefObject<HTMLImageElement | null>;
};

/** The committed image owns its source: detach first, then release the URL. */
export function BlobImage({ blob, imageRef, onLoad, ...props }: Props) {
  const ownedImage = useRef<HTMLImageElement>(null);
  const image = imageRef ?? ownedImage;
  const source = useRef<string | null>(null);
  const notified = useRef(false);
  useLayoutEffect(() => {
    const element = image.current;
    if (!blob || !element) return;
    const lease = acquireObjectUrl(blob);
    source.current = lease.url;
    notified.current = false;
    element.setAttribute("src", lease.url);
    return () => {
      element.removeAttribute("src");
      if (source.current === lease.url) source.current = null;
      lease.release();
    };
  }, [blob, image]);

  function loaded(event: SyntheticEvent<HTMLImageElement>) {
    const element = event.currentTarget;
    if (notified.current || element.currentSrc !== source.current || !element.complete || !element.naturalWidth) return;
    notified.current = true;
    onLoad?.(event);
  }

  return blob ? <img {...props} ref={image} onLoad={loaded} /> : null;
}
