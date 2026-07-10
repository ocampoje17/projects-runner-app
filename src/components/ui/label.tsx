import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground", className)}
      {...props}
    />
  );
}
