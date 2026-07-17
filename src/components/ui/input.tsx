import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9 w-full rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-2 text-[12px] text-foreground outline-none transition-[background-color,border-color,box-shadow,color] placeholder:text-muted-foreground hover:border-border-strong hover:bg-[var(--vscode-list-hover)] focus-visible:border-primary/40 focus-visible:bg-[var(--vscode-list-active)] app-focus-ring",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
