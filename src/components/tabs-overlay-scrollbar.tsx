import { useCallback, useEffect, useRef, useState, type RefObject, type MouseEvent, type PointerEvent } from "react";

export function TabsOverlayScrollbar({
  containerRef,
  isHeaderHovered,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  isHeaderHovered: boolean;
}) {
  const [scrollInfo, setScrollInfo] = useState<{
    scrollLeft: number;
    scrollWidth: number;
    clientWidth: number;
  }>({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0 });

  const [isDragging, setIsDragging] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);

  const updateScrollInfo = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollInfo({
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    });
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    updateScrollInfo();

    const handleScroll = () => {
      updateScrollInfo();
      setIsScrolling(true);
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = window.setTimeout(() => {
        setIsScrolling(false);
      }, 800);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      updateScrollInfo();
    });
    resizeObserver.observe(el);

    const mutationObserver = new MutationObserver(() => {
      updateScrollInfo();
    });
    mutationObserver.observe(el, { childList: true, subtree: true, attributes: true });

    return () => {
      el.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [containerRef, updateScrollInfo]);

  const { scrollLeft, scrollWidth, clientWidth } = scrollInfo;
  const canScroll = scrollWidth > clientWidth && clientWidth > 0;

  if (!canScroll) {
    return null;
  }

  const maxScroll = scrollWidth - clientWidth;
  const minThumbWidth = 28;
  const thumbWidth = Math.max(minThumbWidth, (clientWidth / scrollWidth) * clientWidth);
  const maxThumbLeft = clientWidth - thumbWidth;
  const thumbLeft = maxScroll > 0 ? (scrollLeft / maxScroll) * maxThumbLeft : 0;

  const isVisible = isHeaderHovered || isScrolling || isDragging;

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const deltaX = e.clientX - dragStartRef.current.startX;
    const scrollDelta = maxThumbLeft > 0 ? (deltaX / maxThumbLeft) * maxScroll : 0;
    el.scrollLeft = dragStartRef.current.startScrollLeft + scrollDelta;
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignore pointer release errors
      }
      setIsDragging(false);
      dragStartRef.current = null;
    }
  };

  const handleTrackClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    const track = e.currentTarget;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetScroll = (clickX / clientWidth) * scrollWidth - clientWidth / 2;
    el.scrollTo({ left: targetScroll, behavior: "smooth" });
  };

  return (
    <div
      className={`pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-[4px] transition-opacity duration-200 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      aria-hidden="true"
    >
      <div
        className="pointer-events-auto relative h-full w-full"
        onClick={handleTrackClick}
      >
        <div
          className="absolute top-0 h-full cursor-pointer rounded-full bg-[color-mix(in_oklab,var(--foreground)_28%,transparent)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_48%,transparent)]"
          style={{
            width: `${thumbWidth}px`,
            transform: `translateX(${thumbLeft}px)`,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
