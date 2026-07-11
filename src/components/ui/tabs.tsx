"use client";

import {
  MotionConfig,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

type Variant = "pill" | "underline" | "segment";

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
  layoutId: string;
  variant: Variant;
};

const TabsCtx = createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("Tabs components must be used within <Tabs>");
  return ctx;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  variant = "pill",
  transition = SPRING_LAYOUT,
  className,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: Variant;
  transition?: Transition;
  className?: string;
  children: ReactNode;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const layoutId = useId();
  const reduce = useReducedMotion();
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = (next: string) => {
    if (!controlled) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : transition}>
      <TabsCtx.Provider value={{ value: current, setValue, layoutId, variant }}>
        <motion.div layoutRoot className={className} data-slot="tabs">
          {children}
        </motion.div>
      </TabsCtx.Provider>
    </MotionConfig>
  );
}

const listClasses: Record<Variant, string> = {
  pill: "tabs-list inline-flex items-center gap-1 rounded-full border border-border bg-card/92 p-1 text-muted-foreground shadow-sm backdrop-blur",
  underline: "tabs-list inline-flex items-center gap-1 border-b border-border text-muted-foreground",
  segment:
    "tabs-list inline-flex h-10 items-center gap-1 rounded-full border border-border bg-card/92 p-1 text-muted-foreground shadow-sm backdrop-blur",
};

export function TabsList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { variant } = useTabs();
  return (
    <div role="tablist" className={cn(listClasses[variant], className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
  indicatorClassName,
}: {
  value: string;
  children: ReactNode;
  className?: string;
  indicatorClassName?: string;
}) {
  const { value: current, setValue, layoutId, variant } = useTabs();
  const active = current === value;
  const usesDefaultIndicator = indicatorClassName === undefined;
  const radius = variant === "underline" ? "rounded-none" : "rounded-full";

  if (variant === "underline") {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        data-state={active ? "active" : "inactive"}
        onClick={() => setValue(value)}
        className={cn(
          "tabs-trigger relative isolate inline-flex items-center px-3 pb-2.5 pt-1 text-[13px] font-medium outline-none transition-colors app-focus-ring",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        {children}
        {active ? (
          <motion.span
            layoutId={layoutId}
            className={cn("absolute -bottom-px left-0 right-0 h-px bg-primary", indicatorClassName)}
          />
        ) : null}
      </button>
    );
  }

  return (
    <div className="relative">
      {active ? (
        <motion.span
          layoutId={layoutId}
          style={{ borderRadius: 9999 }}
          className={cn("absolute inset-0 border border-primary bg-primary shadow-sm", radius, indicatorClassName)}
        />
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        data-state={active ? "active" : "inactive"}
        onClick={() => setValue(value)}
        className={cn(
          "tabs-trigger relative z-10 inline-flex h-8 items-center justify-center whitespace-nowrap bg-transparent px-3.5 text-[13px] font-medium outline-none app-focus-ring",
          usesDefaultIndicator ? "transition-colors" : "transition-colors",
          usesDefaultIndicator
            ? active
              ? "text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
            : active
              ? "text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          radius,
          className,
        )}
      >
        {children}
      </button>
    </div>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const { value: current } = useTabs();
  const reduce = useReducedMotion();
  const active = current === value;

  if (!active) {
    // Keep inactive panels fully out of layout. Do not forward flex/min-h classes here,
    // otherwise they can still reserve space and create a blank gap under the active tab.
    return (
      <div hidden className="tabs-content hidden" data-state="inactive" aria-hidden="true">
        {children}
      </div>
    );
  }

  return (
    <motion.div
      key={value}
      data-state="active"
      initial={{ opacity: 0, y: reduce ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className={cn("tabs-content flex min-h-0 min-w-0 flex-1 flex-col outline-none", className)}
    >
      {children}
    </motion.div>
  );
}
