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
  className,
  iconGridClassName,
}: {
  name: string;
  avatarPath?: string | null;
  onPickIcon: (iconId: string) => void;
  onPickImage: () => void;
  className?: string;
  iconGridClassName?: string;
}) {
  const selectedIconId = lucideIconId(avatarPath);

  return (
    <DialogSurface className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <EntityAvatar name={name} path={avatarPath} />
        <Button type="button" variant="secondary" onClick={onPickImage}>
          <ImagePlus size={16} />
          Image
        </Button>
      </div>
      <span className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-muted-foreground">Add icon</span>
      <div
        className={cn("grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-1.5", iconGridClassName)}
        aria-label="Add icon"
      >
        {iconOptions.map(({ id, label, Icon }) => (
          <Button
            aria-label={label}
            size="icon"
            variant="ghost"
            className={cn(
              "h-8 min-w-8 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-muted-foreground hover:border-border-strong hover:bg-[var(--vscode-list-hover)] hover:text-foreground",
              selectedIconId === id && "border-primary/35 bg-[var(--vscode-list-active)] text-foreground",
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

