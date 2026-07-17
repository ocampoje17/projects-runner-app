import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[100px] w-full rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-2.5 font-mono text-[12px] text-foreground outline-none transition-[background-color,border-color,box-shadow,color] placeholder:text-muted-foreground hover:border-border-strong hover:bg-[var(--vscode-list-hover)] focus-visible:border-primary/40 focus-visible:bg-[var(--vscode-list-active)] app-focus-ring",
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
