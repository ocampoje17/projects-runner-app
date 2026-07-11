"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import * as React from "react";
import { SPRING_PRESS } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border shadow-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 app-focus-ring disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground shadow-[0_1px_2px_var(--primary-glow)] hover:bg-primary/92 hover:shadow-[0_4px_14px_var(--primary-glow)]",
        primary: "border-primary bg-primary text-primary-foreground shadow-[0_1px_2px_var(--primary-glow)] hover:bg-primary/92 hover:shadow-[0_4px_14px_var(--primary-glow)]",
        secondary:
          "border-border bg-card/96 text-foreground hover:border-border-strong hover:bg-[var(--btn-secondary-hover)] hover:shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_8%,transparent)]",
        ghost:
          "border-transparent bg-transparent text-muted-foreground shadow-none hover:border-border hover:bg-[var(--btn-ghost-hover-bg)] hover:text-foreground",
        danger:
          "border-destructive/35 bg-destructive text-destructive-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--danger-color)_18%,transparent)] hover:bg-destructive/92 hover:shadow-[0_4px_14px_color-mix(in_oklab,var(--danger-color)_18%,transparent)]",
        outline:
          "border-border bg-[color-mix(in_oklab,var(--bg-input)_82%,var(--bg-workspace))] text-foreground hover:border-border-strong hover:bg-[var(--btn-ghost-hover-bg)]",
      },
      size: {
        default: "h-9 rounded-full px-4 text-[13px]",
        sm: "h-8 rounded-full px-3 text-xs gap-1.5",
        md: "h-10 rounded-full px-5 text-sm gap-2",
        lg: "h-12 rounded-full px-6 text-base gap-2",
        icon: "h-9 w-9 rounded-[12px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = Omit<HTMLMotionProps<"button">, "ref"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const MotionButton = motion.button;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      asChild = false,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const reduce = useReducedMotion();
    const canHover = useHoverCapable();
    const classes = cn(buttonVariants({ variant, size }), className);

    if (asChild) {
      return <Slot ref={ref} className={classes} {...(props as object)} />;
    }

    return (
      <MotionButton
        ref={ref}
        type={type}
        disabled={disabled}
        whileTap={reduce || disabled ? undefined : { scale: 0.93 }}
        whileHover={reduce || disabled || !canHover ? undefined : { scale: 1.02 }}
        transition={SPRING_PRESS}
        className={classes}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { buttonVariants };
export type { ButtonProps };
