"use client";

import {
  MotionConfig,
  motion,
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
import { useMotionPreferences } from "@/lib/motion";
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
  const { allowRichMotion } = useMotionPreferences();
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = (next: string) => {
    if (!controlled) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <MotionConfig transition={allowRichMotion ? transition : { duration: 0 }}>
      <TabsCtx.Provider value={{ value: current, setValue, layoutId, variant }}>
        {allowRichMotion ? (
          <motion.div layoutRoot className={className} data-slot="tabs">
            {children}
          </motion.div>
        ) : (
          <div className={className} data-slot="tabs">
            {children}
          </div>
        )}
      </TabsCtx.Provider>
    </MotionConfig>
  );
}

const listClasses: Record<Variant, string> = {
  pill: "tabs-list inline-flex items-center gap-1 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-tabs)] p-1 text-muted-foreground",
  underline: "tabs-list inline-flex items-center gap-1 border-b border-border text-muted-foreground",
  segment:
    "tabs-list inline-flex h-9 items-center gap-1 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-tabs)] p-1 text-muted-foreground",
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
  const { allowRichMotion } = useMotionPreferences();
  const active = current === value;
  const usesDefaultIndicator = indicatorClassName === undefined;
  const radius = variant === "underline" ? "rounded-none" : "rounded-[7px]";

  if (variant === "underline") {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        data-state={active ? "active" : "inactive"}
        onClick={() => setValue(value)}
        className={cn(
          "tabs-trigger relative isolate inline-flex items-center rounded-t-[6px] px-2.5 pb-2 pt-1 text-[12px] font-medium outline-none transition-[background-color,border-color,color,box-shadow] app-focus-ring",
          active
            ? "bg-[color-mix(in_srgb,var(--vscode-list-selected)_78%,var(--vscode-editor))] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            : "text-muted-foreground hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]",
          className,
        )}
      >
        {children}
        {active && allowRichMotion ? (
          <motion.span
            layoutId={layoutId}
            className={cn("absolute inset-x-1 bottom-0 h-[3px] rounded-t-full bg-primary", indicatorClassName)}
          />
        ) : active ? (
          <span className={cn("absolute inset-x-1 bottom-0 h-[3px] rounded-t-full bg-primary", indicatorClassName)} />
        ) : null}
      </button>
    );
  }

  return (
    <div className="relative">
      {active && allowRichMotion ? (
        <motion.span
          layoutId={layoutId}
          style={{ borderRadius: 7 }}
          className={cn("absolute inset-0 border border-primary/35 bg-[var(--vscode-list-active)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]", radius, indicatorClassName)}
        />
      ) : active ? (
        <span
          className={cn("absolute inset-0 border border-primary/35 bg-[var(--vscode-list-active)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]", radius, indicatorClassName)}
          style={{ borderRadius: 7 }}
        />
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        data-state={active ? "active" : "inactive"}
        onClick={() => setValue(value)}
          className={cn(
            "tabs-trigger relative z-10 inline-flex h-7 items-center justify-center whitespace-nowrap bg-transparent px-3 text-[12px] font-medium outline-none app-focus-ring",
            usesDefaultIndicator ? "transition-[background-color,color,transform]" : "transition-[background-color,color,transform]",
            usesDefaultIndicator
              ? active
                ? "text-foreground"
                : "text-muted-foreground hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:scale-[0.985] active:bg-[var(--vscode-list-active)]"
              : active
                ? "text-foreground"
                : "text-muted-foreground hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:scale-[0.985] active:bg-[var(--vscode-list-active)]",
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
  const { allowRichMotion } = useMotionPreferences();
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

  if (!allowRichMotion) {
    return (
      <div data-state="active" className={cn("tabs-content flex min-h-0 min-w-0 flex-1 flex-col outline-none", className)}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      key={value}
      data-state="active"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className={cn("tabs-content flex min-h-0 min-w-0 flex-1 flex-col outline-none", className)}
    >
      {children}
    </motion.div>
  );
}
