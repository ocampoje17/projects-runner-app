import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({ className, ...props }: DialogPrimitive.DialogOverlayProps) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-[1000] bg-black/56 backdrop-blur-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({ className, children, ...props }: DialogPrimitive.DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[1001] max-h-[calc(100vh-28px)] w-[min(520px,calc(100vw-20px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-4 text-popover-foreground shadow-[0_14px_34px_rgba(0,0,0,0.32)] outline-none",
            className,
          )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <Button className="absolute right-2.5 top-2.5 h-7 w-7" size="icon" variant="ghost" aria-label="Close">
            <X size={16} />
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex flex-col gap-1 pr-9", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[15px] font-semibold tracking-[0.01em] text-foreground", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      className={cn("text-[12px] leading-6 text-muted-foreground", className)}
      {...props}
    />
  );
}
