import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border text-[12.5px] font-semibold transition-colors duration-150 app-focus-ring disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:brightness-[1.04]",
        secondary: "border-app-border bg-card text-foreground hover:bg-muted",
        ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        danger: "border-destructive bg-destructive text-destructive-foreground hover:brightness-[1.04]",
        outline: "border-app-border bg-transparent text-foreground hover:bg-muted",
      },
      size: {
        default: "h-8 rounded-[8px] px-3",
        sm: "h-[26px] rounded-[6px] px-2.5 text-[11.5px]",
        icon: "h-[30px] w-[30px] rounded-[7px] p-0",
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
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        className={cn(
          "btn",
          `btn-${variant}`,
          `btn-size-${size}`,
          buttonVariants({ variant, size }),
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
