import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";

export function Avatar({ className, ...props }: AvatarPrimitive.AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "avatar relative inline-flex h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[8px] border border-app-border bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: AvatarPrimitive.AvatarImageProps) {
  return <AvatarPrimitive.Image className={cn("avatar-image aspect-square h-full w-full", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: AvatarPrimitive.AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "avatar-fallback flex h-full w-full items-center justify-center bg-primary/10 text-[12px] font-semibold text-primary",
        className,
      )}
      {...props}
    />
  );
}
