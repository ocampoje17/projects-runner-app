import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-[22px] w-fit items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-[-0.01em]",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-muted-foreground",
        muted: "border-border bg-muted text-muted-foreground",
        success: "border-success/20 bg-success/10 text-success",
        danger: "border-destructive/20 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
