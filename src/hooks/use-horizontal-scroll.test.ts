import { describe, expect, it, vi } from "vitest";

describe("horizontal scroll logic", () => {
  it("converts vertical wheel delta to horizontal scroll amount", () => {
    let scrollLeft = 0;
    const scrollWidth = 1000;
    const clientWidth = 400;

    const handleWheel = (event: { deltaX: number; deltaY: number; deltaMode: number; preventDefault: () => void }) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }
      if (event.deltaY !== 0 && scrollWidth > clientWidth) {
        event.preventDefault();
        let delta = event.deltaY;
        if (event.deltaMode === 1) delta *= 33;
        else if (event.deltaMode === 2) delta *= clientWidth;
        scrollLeft += delta;
      }
    };

    const preventDefault = vi.fn();

    // Standard mouse wheel down (deltaY = 100)
    handleWheel({ deltaX: 0, deltaY: 100, deltaMode: 0, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(scrollLeft).toBe(100);

    // Line mode wheel up (deltaY = -3, deltaMode = 1)
    handleWheel({ deltaX: 0, deltaY: -3, deltaMode: 1, preventDefault });
    expect(scrollLeft).toBe(1);

    // Trackpad horizontal swipe (deltaX = 50, deltaY = 0) - should not interfere
    handleWheel({ deltaX: 50, deltaY: 0, deltaMode: 0, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2); // not called again for horizontal swipe
    expect(scrollLeft).toBe(1);
  });
});
