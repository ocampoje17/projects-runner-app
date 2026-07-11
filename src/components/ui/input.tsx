import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-full border border-border bg-[color-mix(in_oklab,var(--bg-input)_92%,var(--bg-workspace))] px-3.5 py-2 text-[13px] text-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,var(--background)_70%,transparent)] outline-none transition-[background-color,border-color,box-shadow,color] placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-primary/40 app-focus-ring",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
