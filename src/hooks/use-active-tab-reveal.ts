import { useLayoutEffect, type RefObject } from "react";

/** Reveal a newly selected tab without taking over the user's manual scrolling. */
export function useActiveTabReveal(containerRef: RefObject<HTMLDivElement | null>, activeTabId: string) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    const tab = container?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    if (!container || !tab) return;
    const viewport = container.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    if (!viewport.width || !bounds.width) return;

    if (bounds.left < viewport.left) {
      container.scrollTo({ left: Math.max(0, container.scrollLeft + bounds.left - viewport.left - 12), behavior: "auto" });
    } else if (bounds.right > viewport.right) {
      container.scrollTo({ left: container.scrollLeft + bounds.right - viewport.right + 12, behavior: "auto" });
    }
  }, [activeTabId, containerRef]);
}
