"use client";

import { animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import * as React from "react";
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
  const [uncontrolled, setUncontrolled] = React.useState(defaultChecked);
  const [isPressed, setIsPressed] = React.useState(false);
  const [isPointer, setIsPointer] = React.useState(false);
  const isControlled = checked !== undefined;
  const current = isControlled ? Boolean(checked) : uncontrolled;

  React.useEffect(() => {
    if (!thumbRef.current || reduce) return;
    if (disabled && isPressed) {
      animate(thumbRef.current, { x: [0, -2, 2, -1, 0] }, { delay: 0.2, duration: 0.6 });
    }
  }, [disabled, isPressed, reduce]);

  const squish = !disabled && isPointer && isPressed && !reduce;

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : THUMB_SPRING}>
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
            "group peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 outline-none transition-colors duration-200 app-focus-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            current ? "justify-end bg-primary" : "justify-start bg-muted-foreground/50",
          )}
        >
          <motion.div
            ref={thumbRef}
            layout
            animate={{ scale: squish ? 0.9 : 1 }}
            className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm"
          />
        </motion.button>
        {label ? (
          <label htmlFor={switchId} className="cursor-pointer text-[12.5px] text-foreground">
            {label}
          </label>
        ) : null}
      </span>
    </MotionConfig>
  );
});

Switch.displayName = "Switch";
