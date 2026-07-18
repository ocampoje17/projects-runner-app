"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, type ComponentPropsWithoutRef } from "react";
import { ActionSwapIcon } from "@/components/motion/action-swap";
import { useMotionPreferences } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type ThemeVariant = "rectangle" | "circle" | "circle-blur";
export type RectStart =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center"
  | "bottom-up";

export interface ThemeToggleProps
  extends Omit<ComponentPropsWithoutRef<"button">, "children" | "onClick"> {
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  variant?: ThemeVariant;
  start?: RectStart;
  iconClassName?: string;
}

const VT_STYLE_ID = "beui-theme-toggle-vt";

const VT_CSS = `
html[data-beui-vt="rect"]::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
}
html[data-beui-vt="rect"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-rect-reveal 400ms ease-out;
}
html[data-beui-vt="circle"]::view-transition-old(root),
html[data-beui-vt="circle-blur"]::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
}
html[data-beui-vt="circle"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-circle-reveal 700ms cubic-bezier(0.4, 0, 0.2, 1);
}
html[data-beui-vt="circle-blur"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-circle-blur-reveal 700ms cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes beui-rect-reveal {
  from { clip-path: var(--beui-vt-from, inset(100% 0 0 0)); }
  to   { clip-path: inset(0 0 0 0); }
}
@keyframes beui-circle-reveal {
  from { clip-path: circle(0% at var(--beui-vt-origin, 50% 100%)); }
  to   { clip-path: circle(150% at var(--beui-vt-origin, 50% 100%)); }
}
@keyframes beui-circle-blur-reveal {
  from { clip-path: circle(0% at var(--beui-vt-origin, 50% 100%)); filter: blur(8px); }
  to   { clip-path: circle(150% at var(--beui-vt-origin, 50% 100%)); filter: blur(0px); }
}
`;

const RECT_FROM: Record<RectStart, string> = {
  "top-left": "inset(0 100% 100% 0)",
  "top-right": "inset(0 0 100% 100%)",
  "bottom-left": "inset(100% 100% 0 0)",
  "bottom-right": "inset(100% 0 0 100%)",
  center: "inset(50% 50% 50% 50%)",
  "bottom-up": "inset(100% 0 0 0)",
};

const CIRCLE_ORIGIN: Record<RectStart, string> = {
  "top-left": "0% 0%",
  "top-right": "100% 0%",
  "bottom-left": "0% 100%",
  "bottom-right": "100% 100%",
  center: "50% 50%",
  "bottom-up": "50% 100%",
};

function ensureViewTransitionStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(VT_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = VT_STYLE_ID;
  el.textContent = VT_CSS;
  document.head.appendChild(el);
}

export function ThemeToggle({
  theme,
  onThemeChange,
  variant = "rectangle",
  start = "bottom-up",
  className,
  iconClassName,
  ...rest
}: ThemeToggleProps) {
  const { allowRichMotion } = useMotionPreferences();
  const isDark = theme === "dark";

  useEffect(() => {
    ensureViewTransitionStyles();
  }, []);

  const toggle = () => {
    const next = isDark ? "light" : "dark";

    if (!allowRichMotion || !("startViewTransition" in document)) {
      onThemeChange(next);
      return;
    }

    const root = document.documentElement;
    if (variant === "rectangle") {
      root.style.setProperty("--beui-vt-from", RECT_FROM[start]);
      root.dataset.beuiVt = "rect";
    } else {
      root.style.setProperty("--beui-vt-origin", CIRCLE_ORIGIN[start]);
      root.dataset.beuiVt = variant;
    }

    const vt = (
      document as Document & {
        startViewTransition(cb: () => void): { finished: Promise<void> };
      }
    ).startViewTransition(() => onThemeChange(next));

    void vt.finished.finally(() => {
      delete root.dataset.beuiVt;
    });
  };

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] text-foreground transition-colors hover:border-border-strong hover:bg-[var(--vscode-list-hover)] active:bg-[var(--vscode-list-active)]",
        className,
      )}
      {...rest}
    >
      {allowRichMotion ? (
        <ActionSwapIcon value={isDark ? "dark" : "light"} animation="blur" className={cn("h-4 w-4", iconClassName)}>
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </ActionSwapIcon>
      ) : isDark ? (
        <Sun className={cn("h-4 w-4", iconClassName)} />
      ) : (
        <Moon className={cn("h-4 w-4", iconClassName)} />
      )}
    </button>
  );
}
