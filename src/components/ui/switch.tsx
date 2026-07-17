"use client";

import { animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import * as React from "react";
import { useMotionPreferences } from "@/lib/motion";
import { cn } from "@/lib/utils";

const THUMB_SPRING = { type: "spring", stiffness: 800, damping: 80, mass: 4 } as const;

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  id?: string;
  name?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    defaultChecked = false,
    onCheckedChange,
    disabled,
    label,
    className,
    id,
    name,
  },
  ref,
) {
  const reactId = React.useId();
  const switchId = id ?? reactId;
  const thumbRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { allowRichMotion } = useMotionPreferences();
  const [uncontrolled, setUncontrolled] = React.useState(defaultChecked);
  const [isPressed, setIsPressed] = React.useState(false);
  const [isPointer, setIsPointer] = React.useState(false);
  const isControlled = checked !== undefined;
  const current = isControlled ? Boolean(checked) : uncontrolled;

  React.useEffect(() => {
    if (!thumbRef.current || reduce || !allowRichMotion) return;
    if (disabled && isPressed) {
      animate(thumbRef.current, { x: [0, -2, 2, -1, 0] }, { delay: 0.2, duration: 0.6 });
    }
  }, [allowRichMotion, disabled, isPressed, reduce]);

  const squish = allowRichMotion && !disabled && isPointer && isPressed && !reduce;

  return (
    <MotionConfig transition={allowRichMotion && !reduce ? THUMB_SPRING : { duration: 0 }}>
      <span className={cn("inline-flex items-center gap-2", className)}>
        {name ? <input type="hidden" name={name} value={current ? "true" : "false"} readOnly /> : null}
        <motion.button
          ref={ref}
          id={switchId}
          type="button"
          role="switch"
          aria-checked={current}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            const next = !current;
            if (!isControlled) setUncontrolled(next);
            onCheckedChange?.(next);
          }}
          onPointerDown={(event) => {
            setIsPressed(true);
            setIsPointer(event.pointerType !== "touch" ? true : true);
          }}
          onPointerUp={() => setIsPressed(false)}
          onPointerLeave={() => setIsPressed(false)}
          initial={false}
          data-state={current ? "checked" : "unchecked"}
          className={cn(
            "group peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border px-0.5 outline-none transition-[background-color,border-color,box-shadow,transform] duration-200 app-focus-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            current
              ? "justify-end border-primary bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:brightness-110 active:scale-[0.97]"
              : "justify-start border-[var(--vscode-border)] bg-[var(--vscode-editor)] hover:border-border-strong hover:bg-[var(--vscode-list-hover)] active:scale-[0.97] active:bg-[var(--vscode-list-active)]",
          )}
        >
          <motion.div
            ref={thumbRef}
            layout={allowRichMotion}
            animate={{ scale: squish ? 0.9 : 1 }}
            className="pointer-events-none block h-[18px] w-[18px] rounded-full border border-black/5 bg-white dark:border-white/10"
          />
        </motion.button>
        {label ? (
          <label htmlFor={switchId} className="cursor-pointer text-[13px] text-foreground">
            {label}
          </label>
        ) : null}
      </span>
    </MotionConfig>
  );
});

Switch.displayName = "Switch";

