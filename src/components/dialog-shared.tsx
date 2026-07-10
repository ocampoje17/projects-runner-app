import { ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EntityAvatar, iconOptions, lucideIconId } from "./entity-avatar";
import { Button } from "./ui/button";
import { DialogErrorText, DialogSurface } from "./ui/dialog-form";

export function AvatarPicker({
  name,
  avatarPath,
  onPickIcon,
  onPickImage,
}: {
  name: string;
  avatarPath?: string | null;
  onPickIcon: (iconId: string) => void;
  onPickImage: () => void;
}) {
  const selectedIconId = lucideIconId(avatarPath);

  return (
    <DialogSurface className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <EntityAvatar name={name} path={avatarPath} />
        <Button type="button" variant="secondary" onClick={onPickImage}>
          <ImagePlus size={16} />
          Image
        </Button>
      </div>
      <span className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-app-text-muted">Add icon</span>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-1.5" aria-label="Add icon">
        {iconOptions.map(({ id, label, Icon }) => (
          <Button
            aria-label={label}
            size="icon"
            variant="ghost"
            className={cn(
              "h-8 min-w-8 rounded-full border border-border bg-input text-app-text-secondary hover:border-border-hover hover:bg-muted hover:text-app-title",
              selectedIconId === id && "border-transparent bg-primary text-primary-foreground shadow-[0_4px_12px_var(--primary-glow)]",
            )}
            key={id}
            onClick={() => onPickIcon(id)}
            title={label}
            type="button"
          >
            <Icon size={18} />
          </Button>
        ))}
      </div>
    </DialogSurface>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <DialogErrorText>{message}</DialogErrorText> : null;
}

