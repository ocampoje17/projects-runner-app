import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-editor)] px-3 py-2 text-left text-[12px] font-normal text-foreground outline-none transition-[background-color,border-color,color,transform] hover:border-border-strong hover:bg-[var(--vscode-list-hover)] active:scale-[0.995] data-[placeholder]:text-muted-foreground data-[state=open]:border-[var(--vscode-input-focus-border)] data-[state=open]:bg-[var(--vscode-list-active)] app-input-focus [&_span]:font-normal",
        className,
      )}
      {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-60" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "z-[1100] min-w-[8rem] overflow-hidden rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] text-popover-foreground shadow-[0_10px_24px_rgba(0,0,0,0.24)]",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
        <ChevronUp className="h-3.5 w-3.5" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport
        className={cn(
          "p-1.5",
          position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
        <ChevronDown className="h-3.5 w-3.5" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex min-h-8 w-full cursor-default items-center rounded-[4px] border border-transparent py-1.5 pl-8 pr-3 text-[12px] font-normal text-[var(--vscode-foreground)] outline-none transition-[background-color,border-color,color] data-[disabled]:pointer-events-none data-[highlighted]:border-[var(--vscode-border)] data-[highlighted]:bg-[var(--vscode-list-hover)] data-[highlighted]:text-foreground data-[state=checked]:border-primary/20 data-[state=checked]:bg-[var(--vscode-list-active)]/60 data-[state=checked]:text-[var(--vscode-foreground)] [&_.select-item-title]:text-[12px] [&_.select-item-title]:font-normal [&_.select-item-title]:text-[var(--vscode-foreground)] [&_.select-item-description]:text-[11px] [&_.select-item-description]:font-normal [&_.select-item-description]:leading-5 [&_.select-item-description]:text-[var(--vscode-foreground)]/62 [&_span]:font-normal",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;
