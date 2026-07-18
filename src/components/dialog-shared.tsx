import { useEffect, useMemo, useState, type UIEvent } from "react";
import { ImagePlus, Search, Shapes } from "lucide-react";
import { cn } from "@/lib/utils";
import { allLucideIconOptions, EntityAvatar, getLucideIconOption, iconOptions, lucideIconId, type IconOption } from "./entity-avatar";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DialogErrorText, DialogSurface } from "./ui/dialog-form";
import { Input } from "./ui/input";

const ICON_PAGE_SIZE = 120;

function IconPickerButton({
  option,
  isSelected,
  onSelect,
}: {
  option: IconOption;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const { Icon } = option;

  return (
    <Button
      aria-label={option.label}
      size="icon"
      variant="ghost"
      className={cn(
        "h-9 min-w-9 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-muted-foreground hover:border-border-strong hover:bg-[var(--vscode-list-hover)] hover:text-foreground",
        isSelected && "border-primary/35 bg-[var(--vscode-list-active)] text-foreground",
      )}
      onClick={() => onSelect(option.id)}
      title={option.label}
      type="button"
    >
      <Icon size={18} />
    </Button>
  );
}

function IconPickerDialog({
  open,
  selectedIconId,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  selectedIconId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (iconId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(ICON_PAGE_SIZE);
  const normalizedQuery = query.trim().toLowerCase();
  const suggestedIconIds = useMemo(() => new Set(iconOptions.map((option) => option.id)), []);

  const suggestedIcons = useMemo(() => {
    if (!normalizedQuery) {
      return iconOptions;
    }

    return iconOptions.filter((option) => {
      const haystack = `${option.label} ${option.id}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery]);

  const filteredAllIcons = useMemo(() => {
    const filtered = allLucideIconOptions.filter((option) => {
      if (suggestedIconIds.has(option.id)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      const haystack = `${option.label} ${option.id}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    return filtered;
  }, [normalizedQuery, suggestedIconIds]);

  const visibleIcons = filteredAllIcons.slice(0, visibleCount);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    setVisibleCount(ICON_PAGE_SIZE);
  }, [normalizedQuery]);

  function handleGridScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining > 240) {
      return;
    }

    setVisibleCount((current) => Math.min(current + ICON_PAGE_SIZE, filteredAllIcons.length));
  }

  function handleSelect(iconId: string) {
    onSelect(iconId);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(760px,calc(100vw-20px))] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Pick icon</DialogTitle>
          <DialogDescription>Choose a suggested icon or search the full Lucide library.</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(100vh-180px)] flex-col gap-4 overflow-hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search icons"
              className="pl-9"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          <section className="flex flex-col gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Suggested</div>
              <p className="text-[11.5px] text-muted-foreground">The icon set currently used throughout the app.</p>
            </div>
            {suggestedIcons.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
                {suggestedIcons.map((option) => (
                  <IconPickerButton
                    key={option.id}
                    option={option}
                    isSelected={selectedIconId === option.id}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[6px] border border-dashed border-[var(--vscode-border)] px-3 py-4 text-[12px] text-muted-foreground">
                No suggested icons match this search.
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">All icons</div>
              <p className="text-[11.5px] text-muted-foreground">Scroll to load more icons from the library.</p>
            </div>
            <div
              className="h-[360px] min-h-[360px] overflow-y-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2"
              onScroll={handleGridScroll}
            >
              {visibleIcons.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
                  {visibleIcons.map((option) => (
                    <IconPickerButton
                      key={option.id}
                      option={option}
                      isSelected={selectedIconId === option.id}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-2 py-8 text-center text-[12px] text-muted-foreground">No icons match this search.</div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AvatarPicker({
  name,
  avatarPath,
  onPickIcon,
  onPickImage,
  className,
}: {
  name: string;
  avatarPath?: string | null;
  onPickIcon: (iconId: string) => void;
  onPickImage: () => void;
  className?: string;
}) {
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const selectedIconId = lucideIconId(avatarPath);
  const selectedIconOption = getLucideIconOption(selectedIconId);
  const SelectedIcon = selectedIconOption?.Icon;

  return (
    <>
      <DialogSurface className={cn("flex flex-col gap-2", className)}>
        <div className="flex items-center justify-between gap-3">
          <EntityAvatar name={name} path={avatarPath} />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setIsIconPickerOpen(true)}>
              {SelectedIcon ? <SelectedIcon size={16} /> : <Shapes size={16} />}
              Pick icon
            </Button>
            <Button type="button" variant="secondary" onClick={onPickImage}>
              <ImagePlus size={16} />
              Image
            </Button>
          </div>
        </div>
      </DialogSurface>
      <IconPickerDialog
        open={isIconPickerOpen}
        selectedIconId={selectedIconId}
        onOpenChange={setIsIconPickerOpen}
        onSelect={onPickIcon}
      />
    </>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <DialogErrorText>{message}</DialogErrorText> : null;
}

