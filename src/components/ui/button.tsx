"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import * as React from "react";
import { SPRING_PRESS } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border text-[12.5px] font-semibold transition-colors duration-150 app-focus-ring disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:brightness-[1.04]",
        primary: "border-primary bg-primary text-primary-foreground hover:brightness-[1.04]",
        secondary: "border-app-border bg-card text-foreground hover:bg-muted",
        ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        danger: "border-destructive bg-destructive text-destructive-foreground hover:brightness-[1.04]",
        outline: "border-app-border bg-transparent text-foreground hover:bg-muted",
      },
      size: {
        default: "h-8 rounded-[8px] px-3",
        sm: "h-[26px] rounded-[6px] px-2.5 text-[11.5px]",
        md: "h-8 rounded-[8px] px-3",
        lg: "h-10 rounded-[8px] px-4 text-[13px]",
        icon: "h-[30px] w-[30px] rounded-[7px] p-0",
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
        whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
        whileHover={reduce || disabled || !canHover ? undefined : { scale: 1.015 }}
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
