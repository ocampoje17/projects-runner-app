import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";

export function Avatar({ className, ...props }: AvatarPrimitive.AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)]",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: AvatarPrimitive.AvatarImageProps) {
  return <AvatarPrimitive.Image className={cn("aspect-square h-full w-full", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: AvatarPrimitive.AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex h-full w-full items-center justify-center bg-[var(--vscode-panel)] text-[12px] font-semibold text-foreground",
        className,
      )}
      {...props}
    />
  );
}
