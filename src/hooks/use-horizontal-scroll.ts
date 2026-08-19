import { useEffect, useRef } from "react";

export function useHorizontalScroll<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      // If user is already scrolling horizontally (trackpad gesture or horizontal tilt wheel),
      // let default horizontal scrolling take precedence if it's dominant.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      if (event.deltaY !== 0) {
        if (container.scrollWidth > container.clientWidth) {
          event.preventDefault();
          let delta = event.deltaY;
          if (event.deltaMode === 1) {
            // DOM_DELTA_LINE: lines to pixels
            delta *= 33;
          } else if (event.deltaMode === 2) {
            // DOM_DELTA_PAGE: pages to pixels
            delta *= container.clientWidth;
          }
          container.scrollLeft += delta;
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, []);

  return containerRef;
}
