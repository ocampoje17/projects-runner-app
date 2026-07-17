"use client";

import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import { useMotionPreferences } from "@/lib/motion";
import { cn } from "@/lib/utils";

const CHECK_PATH = "M5 13l4 4L19 7";
const INDETERMINATE_PATH = "M6 12h12";

export interface CheckboxProps {
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  indeterminate?: boolean;
  label?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  name?: string;
  "aria-label"?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  {
    checked,
    defaultChecked = false,
    onCheckedChange,
    disabled,
    indeterminate,
    label,
    className,
    id,
    name,
    onClick,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const autoId = React.useId();
  const checkboxId = id ?? autoId;
  const { allowRichMotion } = useMotionPreferences();
  const [uncontrolled, setUncontrolled] = React.useState(defaultChecked);
  const isControlled = checked !== undefined;
  const raw = isControlled ? checked : uncontrolled;
  const isChecked = raw === true;
  const isIndeterminate = indeterminate || raw === "indeterminate";
  const showMark = isChecked || isIndeterminate;
  const path = isIndeterminate ? INDETERMINATE_PATH : CHECK_PATH;

  return (
    <span className={cn("inline-flex items-center gap-2", label ? "cursor-pointer" : undefined)}>
      {name ? <input type="hidden" name={name} value={isChecked ? "true" : "false"} readOnly /> : null}
      <motion.button
        ref={ref}
        id={checkboxId}
        type="button"
        role="checkbox"
        aria-checked={isIndeterminate ? "mixed" : isChecked}
        aria-label={ariaLabel}
        disabled={disabled}
        whileTap={allowRichMotion && !disabled ? { scale: 0.92 } : undefined}
        transition={SPRING_PRESS}
        data-state={isChecked ? "checked" : isIndeterminate ? "indeterminate" : "unchecked"}
        className={cn(
          "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border outline-none transition-[background-color,border-color,color,box-shadow] duration-200 app-focus-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          showMark
            ? "border-primary/50 bg-[var(--vscode-list-active)] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
            : "border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-transparent hover:border-border-strong hover:bg-[var(--vscode-list-hover)] active:bg-[var(--vscode-list-active)]",
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || disabled) return;
          const next = !(isChecked && !isIndeterminate);
          if (!isControlled) setUncontrolled(next);
          onCheckedChange?.(next);
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {showMark ? (
            <motion.svg
              key={path}
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={allowRichMotion ? { pathLength: 0, opacity: 0 } : { opacity: 0 }}
              animate={allowRichMotion ? { pathLength: 1, opacity: 1 } : { opacity: 1 }}
              exit={allowRichMotion ? { pathLength: 0, opacity: 0 } : { opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
            >
              <motion.path d={path} />
            </motion.svg>
          ) : null}
        </AnimatePresence>
      </motion.button>
      {label ? (
        <label htmlFor={checkboxId} className="cursor-pointer text-[13px] text-foreground">
          {label}
        </label>
      ) : null}
    </span>
  );
});

Checkbox.displayName = "Checkbox";

