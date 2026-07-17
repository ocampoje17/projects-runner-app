"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { SPRING_PRESS } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { useMotionPreferences } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 app-focus-ring disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-primary/92 active:scale-[0.985] active:bg-primary/85",
        primary: "border-primary bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-primary/92 active:scale-[0.985] active:bg-primary/85",
        secondary:
          "border-[var(--vscode-border)] bg-[var(--vscode-panel)] text-foreground hover:border-border-strong hover:bg-[var(--vscode-list-hover)] active:scale-[0.985] active:border-primary/35 active:bg-[var(--vscode-list-active)]",
        ghost:
          "border-transparent bg-transparent text-muted-foreground shadow-none hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:scale-[0.985] active:border-primary/30 active:bg-[var(--vscode-list-active)] active:text-foreground",
        danger:
          "border-destructive/35 bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-destructive/92 active:scale-[0.985] active:bg-destructive/85",
        outline:
          "border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-foreground hover:border-border-strong hover:bg-[var(--vscode-list-hover)] active:scale-[0.985] active:border-primary/35 active:bg-[var(--vscode-list-active)]",
      },
      size: {
        default: "h-8 rounded-[6px] px-3 text-[12.5px]",
        sm: "h-7 rounded-[6px] px-2.5 text-[11.5px] gap-1.5",
        md: "h-9 rounded-[6px] px-4 text-[13px] gap-2",
        lg: "h-10 rounded-[7px] px-5 text-[13.5px] gap-2",
        icon: "h-8 w-8 rounded-[6px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    animated?: boolean;
    hoverScale?: number;
    tapScale?: number;
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
      animated = false,
      hoverScale = 1.02,
      tapScale = 0.93,
      ...props
    },
    ref,
  ) => {
    const { allowRichMotion } = useMotionPreferences();
    const canHover = useHoverCapable();
    const classes = cn(buttonVariants({ variant, size }), className);

    if (asChild) {
      return <Slot ref={ref} className={classes} {...(props as object)} />;
    }

    if (animated) {
      return (
        <MotionButton
          ref={ref}
          type={type}
          disabled={disabled}
          whileTap={allowRichMotion && !disabled ? { scale: tapScale } : undefined}
          whileHover={allowRichMotion && !disabled && canHover ? { scale: hoverScale } : undefined}
          transition={SPRING_PRESS}
          className={classes}
          {...(props as object)}
        />
      );
    }

    return <button ref={ref} type={type} disabled={disabled} className={classes} {...props} />;
  },
);

Button.displayName = "Button";

export { buttonVariants };
export type { ButtonProps };
