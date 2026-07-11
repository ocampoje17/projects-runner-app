import * as React from "react";
import { cn } from "@/lib/utils";

export function DialogForm({ className, ...props }: React.FormHTMLAttributes<HTMLFormElement>) {
  return <form className={cn("flex flex-col gap-3", className)} {...props} />;
}

export function DialogField({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props} />;
}

export function DialogInlineField({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-2 flex items-center justify-end gap-2 border-t border-border pt-3",
        className,
      )}
      {...props}
    />
  );
}

export function DialogErrorText({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[12px] font-medium text-destructive", className)} {...props} />;
}

export function DialogToggleRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
        className={cn(
          "flex items-start justify-between gap-3 rounded-[16px] border border-border bg-[color-mix(in_oklab,var(--bg-input)_80%,var(--bg-workspace))] px-3.5 py-3",
          className,
        )}
      {...props}
    />
  );
}

export function DialogToggleCopy({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)} {...props} />;
}

export function DialogSurface({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
        className={cn(
          "rounded-[16px] border border-border bg-[color-mix(in_oklab,var(--bg-input)_78%,var(--bg-workspace))] p-3",
          className,
        )}
      {...props}
    />
  );
}

export function DialogMetaGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-3 grid grid-cols-2 gap-2.5", className)} {...props} />;
}

export function DialogMetaItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
        className={cn(
          "flex min-w-0 flex-col gap-0.5 rounded-[16px] border border-border bg-[color-mix(in_oklab,var(--bg-input)_78%,var(--bg-workspace))] p-3",
          className,
        )}
      {...props}
    />
  );
}
