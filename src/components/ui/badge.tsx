import type * as React from "react";
import { cn } from "../../lib/utils";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "danger" | "muted";
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return <span className={cn("badge", `badge-${variant}`, className)} {...props} />;
}
