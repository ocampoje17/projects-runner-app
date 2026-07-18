"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { useMotionPreferences } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Side = "top" | "right" | "bottom" | "left";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: Side;
  /** Delay before showing (ms). Default 120. */
  delay?: number;
  className?: string;
  /** Classes for the outer wrapper span. Use to fix baseline / fill parent. */
  wrapperClassName?: string;
}

const transformOrigin: Record<Side, string> = {
  top: "center bottom",
  bottom: "center top",
  left: "right center",
  right: "left center",
};

const GAP = 8;
const VIEWPORT_MARGIN = 8;

// Offset is in the direction *away* from the trigger — content originates near
// the trigger and rises into resting position.
const offsetFrom: Record<Side, { x?: number; y?: number }> = {
  top: { y: 10 },
  bottom: { y: -10 },
  left: { x: 10 },
  right: { x: -10 },
};

function buildVariants(side: Side): Variants {
  const o = offsetFrom[side];
  return {
    initial: {
      opacity: 0,
      scale: 0.85,
      filter: "blur(10px)",
      x: o.x ?? 0,
      y: o.y ?? 0,
    },
    animate: {
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      x: 0,
      y: 0,
      transition: {
        type: "spring",
        stiffness: 380,
        damping: 30,
        mass: 0.7,
        opacity: { duration: 0.22, ease: EASE_OUT },
        filter: { duration: 0.3, ease: EASE_OUT },
      },
    },
    exit: {
      opacity: 0,
      scale: 0.92,
      filter: "blur(6px)",
      x: (o.x ?? 0) * 0.6,
      y: (o.y ?? 0) * 0.6,
      transition: { duration: 0.14, ease: EASE_OUT },
    },
  };
}

const REDUCED_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.14, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } },
};

// Once any tooltip has just closed, neighbouring tooltips open without the
// initial delay — moving along a toolbar feels instant after the first one.
const WARM_WINDOW_MS = 300;
let lastHiddenAt = 0;

export function Tooltip({ content, children, side = "top", delay = 120, className, wrapperClassName }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const canHover = useHoverCapable();
  const { allowBasicMotion, allowRichMotion } = useMotionPreferences();

  const show = () => {
    if (!canHover) return;
    if (timer.current) clearTimeout(timer.current);
    const warm = Date.now() - lastHiddenAt < WARM_WINDOW_MS;
    timer.current = setTimeout(() => setOpen(true), warm ? 0 : delay);
  };
  const hide = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (open) lastHiddenAt = Date.now();
    setOpen(false);
  };

  useEffect(() => {
    setPortalReady(true);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  if (!isValidElement(children)) return children;

  const updatePosition = () => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    let left = 0;
    let top = 0;

    if (side === "top" || side === "bottom") {
      left = triggerRect.left + (triggerRect.width - bubbleRect.width) / 2;
      top = side === "top"
        ? triggerRect.top - bubbleRect.height - GAP
        : triggerRect.bottom + GAP;
    } else {
      left = side === "left"
        ? triggerRect.left - bubbleRect.width - GAP
        : triggerRect.right + GAP;
      top = triggerRect.top + (triggerRect.height - bubbleRect.height) / 2;
    }

    left = Math.min(
      Math.max(VIEWPORT_MARGIN, left),
      window.innerWidth - bubbleRect.width - VIEWPORT_MARGIN,
    );
    top = Math.min(
      Math.max(VIEWPORT_MARGIN, top),
      window.innerHeight - bubbleRect.height - VIEWPORT_MARGIN,
    );

    setPosition((current) => (
      current.left === left && current.top === top ? current : { left, top }
    ));
  };

  useLayoutEffect(() => {
    if (!open || !portalReady) {
      return;
    }

    updatePosition();
    const handleWindowChange = () => updatePosition();
    window.addEventListener("scroll", handleWindowChange, true);
    window.addEventListener("resize", handleWindowChange);

    return () => {
      window.removeEventListener("scroll", handleWindowChange, true);
      window.removeEventListener("resize", handleWindowChange);
    };
  }, [open, portalReady, side, content]);

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const originalRef = (children as { ref?: unknown }).ref;
      if (typeof originalRef === "function") {
        originalRef(node);
      } else if (originalRef && typeof originalRef === "object" && "current" in originalRef) {
        (originalRef as { current: HTMLElement | null }).current = node;
      }
    },
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    "aria-describedby": id,
  });

  const variants = allowRichMotion ? buildVariants(side) : REDUCED_VARIANTS;

  return (
    <span className={cn("relative inline-flex align-middle", wrapperClassName)}>
      {trigger}
      {portalReady
        ? createPortal(
            <AnimatePresence mode="wait">
              {open ? (
                <span
                  className="pointer-events-none fixed z-[2200]"
                  style={{ left: position.left, top: position.top }}
                >
                  {allowBasicMotion ? (
                    <motion.span
                      ref={bubbleRef}
                      id={id}
                      role="tooltip"
                      variants={variants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      style={{
                        transformOrigin: transformOrigin[side],
                        willChange: allowRichMotion ? "transform, opacity, filter" : "opacity",
                      }}
                      className={cn(
                        "block whitespace-nowrap rounded-[4px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-2 py-1 text-[11px] font-normal leading-none text-[var(--vscode-foreground)] shadow-[0_8px_18px_rgba(0,0,0,0.18)]",
                        className,
                      )}
                    >
                      {content}
                    </motion.span>
                  ) : (
                    <span
                      ref={bubbleRef}
                      id={id}
                      role="tooltip"
                      className={cn(
                        "block whitespace-nowrap rounded-[4px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-2 py-1 text-[11px] font-normal leading-none text-[var(--vscode-foreground)] shadow-[0_8px_18px_rgba(0,0,0,0.18)]",
                        className,
                      )}
                    >
                      {content}
                    </span>
                  )}
                </span>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </span>
  );
}


