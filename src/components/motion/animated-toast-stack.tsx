"use client";

import {
  AlertCircle,
  Bell,
  Check,
  Info,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type ToastStatus = "neutral" | "info" | "loading" | "success" | "error";
export type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type AnimatedToastAction = {
  label: ReactNode;
  onClick: (toast: AnimatedToast) => void;
};

export type AnimatedToast = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  status?: ToastStatus;
  icon?: ReactNode;
  action?: AnimatedToastAction;
  duration?: number;
  dismissible?: boolean;
  createdAt?: number;
};

export type ToastInput = Omit<AnimatedToast, "id" | "createdAt"> & {
  id?: string;
};

export interface AnimatedToastStackProps {
  toasts: AnimatedToast[];
  onDismiss?: (id: string) => void;
  position?: ToastPosition;
  placement?: "static" | "fixed" | "absolute";
  portal?: boolean;
  portalRoot?: Element | null;
  maxVisible?: number;
  className?: string;
}

export interface UseAnimatedToastStackOptions {
  initialToasts?: ToastInput[];
  defaultDuration?: number;
  limit?: number;
}

const STACK_SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
};

const CONTENT_TRANSITION = {
  duration: 0.28,
  ease: EASE_OUT,
} as const;

const STATUS_ICON: Record<ToastStatus, LucideIcon> = {
  neutral: Bell,
  info: Info,
  loading: LoaderCircle,
  success: Check,
  error: AlertCircle,
};

const STATUS_CLASS: Record<ToastStatus, string> = {
  neutral: "text-muted-foreground bg-primary/[0.05]",
  info: "text-primary bg-primary/10",
  loading: "text-primary bg-primary/10",
  success: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
  error: "text-destructive bg-destructive/10",
};

const POSITION_CLASS: Record<ToastPosition, string> = {
  "top-left": "left-4 top-4",
  "top-center": "left-1/2 top-4 -translate-x-1/2",
  "top-right": "right-4 top-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-4 right-4",
};

let idSeed = 0;

function createToast(input: ToastInput, defaultDuration: number): AnimatedToast {
  return {
    duration: defaultDuration,
    dismissible: true,
    ...input,
    id: input.id ?? `toast-${Date.now()}-${idSeed++}`,
    createdAt: Date.now(),
  };
}

export function useAnimatedToastStack({
  initialToasts = [],
  defaultDuration = 4200,
  limit,
}: UseAnimatedToastStackOptions = {}) {
  const toastTimers = useRef<Map<string, { timer: number; signature: string }>>(new Map());
  const [toasts, setToasts] = useState<AnimatedToast[]>(() =>
    initialToasts.map((toast) => createToast(toast, defaultDuration)),
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (input: ToastInput) => {
      const toast = createToast(input, defaultDuration);
      setToasts((current) => {
        const next = [...current, toast];
        return typeof limit === "number" ? next.slice(-limit) : next;
      });
      return toast.id;
    },
    [defaultDuration, limit],
  );

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));

    toastTimers.current.forEach((entry, id) => {
      if (!activeIds.has(id)) {
        window.clearTimeout(entry.timer);
        toastTimers.current.delete(id);
      }
    });

    toasts.forEach((toast) => {
      const duration = toast.duration ?? defaultDuration;
      const existing = toastTimers.current.get(toast.id);

      if (duration <= 0) {
        if (existing) {
          window.clearTimeout(existing.timer);
          toastTimers.current.delete(toast.id);
        }
        return;
      }

      const createdAt = toast.createdAt ?? Date.now();
      const signature = `${createdAt}:${duration}`;

      if (existing?.signature === signature) return;
      if (existing) window.clearTimeout(existing.timer);

      const elapsed = Date.now() - createdAt;
      const remaining = Math.max(duration - elapsed, 0);
      const timer = window.setTimeout(() => {
        toastTimers.current.delete(toast.id);
        dismissToast(toast.id);
      }, remaining);

      toastTimers.current.set(toast.id, { timer, signature });
    });
  }, [defaultDuration, dismissToast, toasts]);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((entry) => {
        window.clearTimeout(entry.timer);
      });
      timers.clear();
    };
  }, []);

  return useMemo(
    () => ({
      toasts,
      showToast,
      dismissToast,
      setToasts,
    }),
    [dismissToast, showToast, toasts],
  );
}

export function AnimatedToastStack({
  toasts,
  onDismiss,
  position = "bottom-right",
  placement = "fixed",
  portal = true,
  portalRoot,
  maxVisible = 4,
  className,
}: AnimatedToastStackProps) {
  const [mounted, setMounted] = useState(false);
  const visibleToasts = toasts.slice(-maxVisible);
  const isBottom = position.startsWith("bottom");

  useEffect(() => {
    setMounted(true);
  }, []);

  const stack = (
    <ol
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "pointer-events-none flex w-[calc(100vw-2rem)] max-w-sm gap-2",
        isBottom ? "flex-col-reverse" : "flex-col",
        placement === "fixed" && "fixed z-[1200]",
        placement === "absolute" && "absolute z-[1200]",
        POSITION_CLASS[position],
        className,
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {visibleToasts.map((toast, index) => (
          <ToastItem key={toast.id} toast={toast} index={index} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </ol>
  );

  if (portal && !mounted) return null;
  if (portal) return createPortal(stack, portalRoot ?? document.body);
  return stack;
}

const ToastItem = memo(function ToastItem({
  toast,
  index,
  onDismiss,
}: {
  toast: AnimatedToast;
  index: number;
  onDismiss?: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const status = toast.status ?? "neutral";
  const Icon = STATUS_ICON[status];
  const iconNode = toast.icon ?? <Icon className="h-3.5 w-3.5" />;
  const canDismiss = toast.dismissible !== false && Boolean(onDismiss);

  return (
    <motion.li
      layout
      initial={
        reduce
          ? { opacity: 0 }
          : { opacity: 0, y: 18, scale: 0.97, filter: "blur(10px)" }
      }
      animate={
        reduce
          ? { opacity: 1 }
          : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
      }
      exit={
        reduce
          ? { opacity: 0 }
          : {
              opacity: 0,
              x: 32,
              scale: 0.97,
              filter: "blur(8px)",
              transition: { duration: 0.18, ease: EASE_OUT },
            }
      }
      transition={STACK_SPRING}
      className="pointer-events-auto relative will-change-transform"
      style={{ zIndex: 20 - index }}
    >
      <div className="relative overflow-hidden rounded-2xl border border-app-border bg-card/95 p-3 shadow-app-dialog">
        <div className="flex items-start gap-3">
          <motion.span
            layout
            className={cn(
              "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
              STATUS_CLASS[status],
            )}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={status}
                initial={
                  reduce
                    ? { opacity: 0 }
                    : { opacity: 0, y: 8, scale: 0.8, filter: "blur(6px)" }
                }
                animate={
                  reduce
                    ? { opacity: 1 }
                    : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
                }
                exit={
                  reduce
                    ? { opacity: 0 }
                    : { opacity: 0, y: -8, scale: 0.9, filter: "blur(6px)" }
                }
                transition={CONTENT_TRANSITION}
                className="inline-flex"
              >
                {status === "loading" ? <span className="inline-flex animate-spin">{iconNode}</span> : iconNode}
              </motion.span>
            </AnimatePresence>
          </motion.span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-5 text-foreground">{toast.title}</p>
            {toast.description ? (
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">{toast.description}</p>
            ) : null}
            {toast.action ? (
              <button
                type="button"
                onClick={() => toast.action?.onClick(toast)}
                className="mt-2 inline-flex h-7 items-center rounded-full bg-primary/[0.06] px-3 text-xs font-medium text-foreground transition-colors hover:bg-primary/[0.1]"
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>

          {canDismiss ? (
            <button
              type="button"
              onClick={() => onDismiss?.(toast.id)}
              aria-label="Dismiss toast"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/[0.06] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
});
