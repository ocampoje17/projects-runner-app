import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-full border border-border bg-input px-3.5 py-2 text-[13px] text-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground app-focus-ring",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
