import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "../../lib/utils";

export function Avatar({ className, ...props }: AvatarPrimitive.AvatarProps) {
  return <AvatarPrimitive.Root className={cn("avatar", className)} {...props} />;
}

export function AvatarImage({ className, ...props }: AvatarPrimitive.AvatarImageProps) {
  return <AvatarPrimitive.Image className={cn("avatar-image", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: AvatarPrimitive.AvatarFallbackProps) {
  return <AvatarPrimitive.Fallback className={cn("avatar-fallback", className)} {...props} />;
}
