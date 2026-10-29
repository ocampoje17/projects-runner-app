// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useActiveTabReveal } from "./use-active-tab-reveal";
import { useHorizontalScroll } from "./use-horizontal-scroll";

function Tabs({ active, tick = 0, hidden = false }: { active: string; tick?: number; hidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useActiveTabReveal(ref, active);
  return hidden ? null : <div ref={ref} data-testid="viewport"><div data-tab-id="first" /><div data-tab-id="last">{tick}</div></div>;
}

beforeEach(() => {
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const start = this.dataset.tabId === "last" ? 800 : 0;
    const left = this.dataset.tabId ? start - this.parentElement!.scrollLeft : 0;
    const width = this.dataset.tabId ? 200 : 400;
    return { left, right: left + width, width } as DOMRect;
  });
  HTMLElement.prototype.scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number) {
    this.scrollLeft = typeof options === "number" ? options : options?.left ?? 0;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("active tab reveal", () => {
  it("reveals once on mount and preserves manual scrolling through countdown, log and title updates", () => {
    const { getByTestId, rerender } = render(<Tabs active="last" />);
    const viewport = getByTestId("viewport");
    expect(viewport.scrollLeft).toBe(612);
    expect(viewport.scrollTo).toHaveBeenCalledTimes(1);
    viewport.scrollLeft = 0;
    for (let tick = 1; tick <= 30; tick++) rerender(<Tabs active="last" tick={tick} />);
    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("only scrolls when the newly selected tab is outside the viewport", () => {
    const { getByTestId, rerender } = render(<Tabs active="first" />);
    expect(HTMLElement.prototype.scrollTo).not.toHaveBeenCalled();
    rerender(<Tabs active="last" />);
    expect(getByTestId("viewport").scrollLeft).toBe(612);
    rerender(<Tabs active="first" />);
    expect(getByTestId("viewport").scrollLeft).toBe(0);
  });

  it("reveals a restored tab when returning from Settings", () => {
    const { getByTestId, rerender } = render(<Tabs active="settings" hidden />);
    rerender(<Tabs active="last" />);
    expect(getByTestId("viewport").scrollLeft).toBe(612);
  });

  it("reattaches wheel handling when the header remounts after Settings", () => {
    function WheelTabs({ enabled }: { enabled: boolean }) {
      const ref = useHorizontalScroll<HTMLDivElement>(enabled);
      return enabled ? <div ref={ref} data-testid="wheel" /> : null;
    }
    const { getByTestId, rerender } = render(<WheelTabs enabled />);
    rerender(<WheelTabs enabled={false} />);
    rerender(<WheelTabs enabled />);
    const viewport = getByTestId("wheel");
    Object.defineProperties(viewport, { scrollWidth: { value: 1000 }, clientWidth: { value: 400 } });
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
    expect(viewport.scrollLeft).toBe(100);
  });
});
