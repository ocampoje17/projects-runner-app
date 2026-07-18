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
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border font-medium leading-none tracking-normal [font-family:var(--font-sans)] transition-[background-color,border-color,color,box-shadow,transform] duration-120 app-focus-ring disabled:pointer-events-none disabled:opacity-50 select-none [&_svg]:pointer-events-none [&_svg]:h-[13px] [&_svg]:w-[13px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--primary-color)] text-[var(--primary-foreground-color)] shadow-none hover:bg-[color-mix(in_srgb,var(--primary-color)_88%,black)] active:scale-[0.985] active:bg-[color-mix(in_srgb,var(--primary-color)_76%,black)]",
        primary:
          "border-transparent bg-[var(--primary-color)] text-[var(--primary-foreground-color)] shadow-none hover:bg-[color-mix(in_srgb,var(--primary-color)_88%,black)] active:scale-[0.985] active:bg-[color-mix(in_srgb,var(--primary-color)_76%,black)]",
        secondary:
          "border-transparent bg-transparent text-foreground/90 shadow-none hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:scale-[0.985] active:border-[var(--vscode-border)] active:bg-[var(--vscode-list-active)]",
        ghost:
          "border-transparent bg-transparent text-muted-foreground shadow-none hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:scale-[0.985] active:border-[var(--vscode-border)] active:bg-[var(--vscode-list-active)] active:text-foreground",
        danger:
          "border-transparent bg-[var(--vscode-danger)] text-white shadow-none hover:bg-[color-mix(in_srgb,var(--vscode-danger)_90%,black)] active:scale-[0.985] active:bg-[color-mix(in_srgb,var(--vscode-danger)_78%,black)]",
        outline:
          "border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-foreground shadow-none hover:border-border-strong hover:bg-[var(--vscode-list-hover)] active:scale-[0.985] active:border-[var(--vscode-border)] active:bg-[var(--vscode-list-active)]",
      },
      size: {
        default: "h-7 rounded-[4px] px-2.5 text-[11.5px]",
        sm: "h-6 rounded-[4px] px-2 text-[11px]",
        md: "h-8 rounded-[4px] px-3 text-[11.5px]",
        lg: "h-9 rounded-[5px] px-4 text-[12px]",
        icon: "h-7 w-7 rounded-[4px] p-0",
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
      style,
      ...props
    },
    ref,
  ) => {
    const { allowRichMotion } = useMotionPreferences();
    const canHover = useHoverCapable();
    const classes = cn(buttonVariants({ variant, size }), className);
    const primaryStyle =
      variant === "default" || variant === "primary"
        ? {
            backgroundColor: "var(--primary-color)",
            color: "var(--primary-foreground-color)",
          }
        : undefined;
    const mergedStyle = primaryStyle ? { ...primaryStyle, ...style } : style;

    if (asChild) {
      return <Slot ref={ref} className={classes} style={mergedStyle} {...(props as object)} />;
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
          style={mergedStyle}
          {...(props as object)}
        />
      );
    }

    return <button ref={ref} type={type} disabled={disabled} className={classes} style={mergedStyle} {...props} />;
  },
);

Button.displayName = "Button";

export { buttonVariants };
export type { ButtonProps };
