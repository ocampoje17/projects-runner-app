import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-[20px] w-fit items-center rounded-[6px] border px-2 py-0.5 text-[10.5px] font-medium tracking-[-0.01em]",
  {
    variants: {
      variant: {
        default: "border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-muted-foreground",
        muted: "border-[var(--vscode-border)] bg-[var(--vscode-panel)] text-muted-foreground",
        success: "border-success/30 bg-success/10 text-success",
        danger: "border-destructive/30 bg-destructive/10 text-destructive",
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
