import * as React from "react";
import { cn } from "@/lib/utils";

export function DialogForm({ className, ...props }: React.FormHTMLAttributes<HTMLFormElement>) {
  return <form className={cn("flex flex-col gap-2", className)} {...props} />;
}

export function DialogField({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 flex-col gap-1", className)} {...props} />;
}

export function DialogInlineField({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-1.5 flex items-center justify-end gap-2 border-t border-app-border pt-2.5",
        className,
      )}
      {...props}
    />
  );
}

export function DialogErrorText({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[11px] font-medium text-red-500", className)} {...props} />;
}

export function DialogToggleRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-[10px] border border-app-border bg-muted/30 px-3 py-2.5",
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
        "rounded-[10px] border border-app-border bg-muted/20 p-2.5",
        className,
      )}
      {...props}
    />
  );
}

export function DialogMetaGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-2.5 grid grid-cols-2 gap-2", className)} {...props} />;
}

export function DialogMetaItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-app-border bg-muted/20 p-2.5",
        className,
      )}
      {...props}
    />
  );
}
