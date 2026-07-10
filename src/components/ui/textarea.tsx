import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[100px] w-full rounded-[16px] border border-border bg-input px-3.5 py-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground app-focus-ring",
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
