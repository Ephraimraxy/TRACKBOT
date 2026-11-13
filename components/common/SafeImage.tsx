"use client";

import { useEffect, useState } from "react";
import NextImage, { type ImageProps } from "next/image";

const FALLBACK = "/images/placeholder.png";

/**
 * A drop-in replacement for next/image that never shows a broken-image icon.
 *
 * A photo can fail to load for reasons that have nothing to do with the photo itself: the image
 * optimiser timing out while a page asks for dozens of new pictures at once, or a brief network
 * hiccup. So on a failure the image is requested once more (with a different address, so the
 * browser does not reuse the failed answer). If that fails too, the shop's placeholder is shown
 * instead, and the alt text stays available to screen readers.
 */
export default function SafeImage({ src, alt, onError, ...rest }: ImageProps) {
  // 0 = first try, 1 = retrying, 2 = give up and show the placeholder
  const [attempt, setAttempt] = useState(0);

  // A different picture (new src) starts over.
  useEffect(() => setAttempt(0), [src]);

  if (!src || attempt >= 2 || typeof src !== "string") {
    if (typeof src !== "string" && src && attempt < 2) {
      // An imported (static) image: nothing to retry, let next/image handle it as usual.
      return <NextImage {...rest} src={src} alt={alt} onError={onError} />;
    }
    return <NextImage {...rest} src={FALLBACK} alt={alt} unoptimized />;
  }

  const address = attempt === 1 ? `${src}${src.includes("?") ? "&" : "?"}retry=1` : src;

  return (
    <NextImage
      {...rest}
      key={address}
      src={address}
      alt={alt}
      onError={(event) => {
        onError?.(event);
        setAttempt((a) => a + 1);
      }}
    />
  );
}
