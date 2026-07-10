import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "field textarea flex min-h-[88px] w-full rounded-[8px] border border-app-border bg-input px-2.5 py-2 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground app-focus-ring",
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
