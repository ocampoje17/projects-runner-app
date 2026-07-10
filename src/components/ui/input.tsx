import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "field flex h-8 w-full rounded-[8px] border border-app-border bg-input px-2.5 py-1.5 text-[12.5px] text-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground app-focus-ring",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
