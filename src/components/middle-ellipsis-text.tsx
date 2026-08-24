import { useLayoutEffect, useRef, useState } from "react";
import truncateMiddle from "truncate-middle";
import { cn } from "../lib/utils";

export type MiddleEllipsisTextProps = {
  text: string;
  frontLength?: number;
  endLength?: number;
  ellipsis?: string;
  className?: string;
  title?: string;
};

/**
 * Truncates text in the middle when it exceeds container width using the `truncate-middle` library.
 * Preserves the beginning and ending portions of the text with an ellipsis in the middle.
 */
export function MiddleEllipsisText({
  text,
  frontLength,
  endLength = 8,
  ellipsis = "…",
  className,
  title,
}: MiddleEllipsisTextProps) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [displayText, setDisplayText] = useState(text);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure || !text) {
      setDisplayText(text);
      return;
    }

    const updateTruncation = () => {
      const containerWidth = container.clientWidth;
      const fullWidth = measure.getBoundingClientRect().width;

      if (containerWidth <= 0 || fullWidth <= containerWidth + 0.5) {
        setDisplayText(text);
        return;
      }

      // Calculate how many characters approximately fit in containerWidth
      const charWidth = fullWidth / text.length;
      const maxChars = Math.max(4, Math.floor(containerWidth / charWidth));

      if (maxChars >= text.length) {
        setDisplayText(text);
        return;
      }

      const back = endLength !== undefined ? Math.min(endLength, Math.floor((maxChars - 1) / 2)) : Math.floor((maxChars - 1) / 2);
      const front = frontLength !== undefined ? frontLength : Math.max(1, maxChars - back - ellipsis.length);

      const truncated = truncateMiddle(text, Math.max(1, front), Math.max(1, back), ellipsis);
      setDisplayText(truncated || text);
    };

    updateTruncation();
    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(container);
    resizeObserver.observe(measure);
    return () => resizeObserver.disconnect();
  }, [text, frontLength, endLength, ellipsis]);

  return (
    <span
      ref={containerRef}
      className={cn("relative flex min-w-0 flex-1 overflow-hidden whitespace-nowrap", className)}
      title={title ?? text}
    >
      <span
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute whitespace-nowrap"
      >
        {text}
      </span>
      <span className="min-w-0 overflow-hidden whitespace-nowrap">{displayText}</span>
    </span>
  );
}

export { truncateMiddle };
