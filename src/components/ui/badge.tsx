import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-[18px] w-fit items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-[0.08em]",
  {
    variants: {
      variant: {
        default: "border-app-border bg-muted text-muted-foreground",
        muted: "border-app-border bg-muted text-muted-foreground",
        success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
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
  return <span className={cn("badge", `badge-${variant}`, badgeVariants({ variant }), className)} {...props} />;
}
