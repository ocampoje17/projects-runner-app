import {
  Check,
  Info,
  Layout,
  Moon,
  Palette,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import appIcon from "../assets/app-icon.png";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import type { AppInfo } from "../lib/api";
import { ACCENT_THEMES, type AccentColor } from "../lib/theme";
import { cn } from "@/lib/utils";

function SettingsCard({
  icon,
  title,
  description,
  children,
  className,
  iconClassName,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={cn("rounded-[12px] border border-app-border bg-card p-4 shadow-app-card", className)}>
      <div className="mb-3 flex items-start gap-3 border-b border-app-border pb-3">
        <div className={cn("shrink-0 rounded-[8px] bg-primary/10 p-2 text-primary", iconClassName)}>{icon}</div>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-app-title">{title}</h3>
          <p className="text-[12px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function AppearanceSettingsPanel({
  theme,
  setTheme,
  accent,
  setAccent,
}: {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
}) {
  return (
    <div className="fade-in space-y-3">
      <SettingsCard
        icon={<Palette size={18} />}
        title="Visual Theme"
        description="Select the color mode for the user interface"
      >
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "light", label: "Light Mode", Icon: Sun },
              { id: "dark", label: "Dark Mode", Icon: Moon },
            ] as const
          ).map((option) => {
            const active = theme === option.id;
            return (
              <Button
                key={option.id}
                type="button"
                variant="ghost"
                className={cn(
                  "h-auto flex-col items-stretch gap-2 rounded-[12px] border-2 border-app-border bg-input p-3 text-left hover:bg-card",
                  active && "border-primary bg-card shadow-[0_0_0_4px_var(--primary-glow)]",
                )}
                onClick={() => setTheme(option.id)}
              >
                <div
                  className={cn(
                    "flex h-[90px] w-full flex-col gap-2 overflow-hidden rounded-[8px] border border-app-border p-2.5",
                    option.id === "light" ? "bg-white" : "bg-[#0d111c]",
                  )}
                >
                  <div className={cn("h-2 w-[40%] rounded", option.id === "light" ? "bg-slate-200" : "bg-slate-800")} />
                  <div className="flex items-center gap-1.5">
                    <div className={cn("h-3.5 w-3.5 rounded", option.id === "light" ? "bg-primary/20" : "bg-primary/40")} />
                    <div className={cn("h-1.5 w-[65%] rounded", option.id === "light" ? "bg-slate-100" : "bg-slate-800")} />
                  </div>
                  <div
                    className={cn(
                      "mt-auto h-3.5 w-8 rounded-full",
                      option.id === "light" ? "bg-primary/15" : "app-gradient-primary",
                    )}
                  />
                </div>
                <div className="flex w-full items-center gap-2 px-1 text-[12.5px] font-semibold text-foreground">
                  <option.Icon size={15} />
                  <span>{option.label}</span>
                  {active ? <Check className="ml-auto rounded-full bg-primary/10 p-0.5 text-primary" size={14} /> : null}
                </div>
              </Button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<Sparkles size={18} />}
        title="Accent Color"
        description="Customize the primary focus highlights and gradients"
      >
        <div className="flex flex-wrap gap-2">
          {(["indigo", "emerald", "rose", "amber", "sky"] as AccentColor[]).map((col) => {
            const active = accent === col;
            return (
              <Button
                key={col}
                type="button"
                variant="ghost"
                className={cn(
                  "h-auto rounded-full border border-app-border bg-input px-3 py-2 text-[12.5px] font-semibold text-muted-foreground hover:bg-card hover:text-app-title",
                  active && "border-primary bg-card text-app-title shadow-[0_0_0_3px_var(--primary-glow)]",
                )}
                style={{ ["--accent-color-color" as string]: ACCENT_THEMES[col].primary } as CSSProperties}
                onClick={() => setAccent(col)}
                title={col.charAt(0).toUpperCase() + col.slice(1)}
              >
                <span className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: ACCENT_THEMES[col].primary }} />
                <span>{col.charAt(0).toUpperCase() + col.slice(1)}</span>
                {active ? <Check size={14} className="text-primary" /> : null}
              </Button>
            );
          })}
        </div>
      </SettingsCard>
    </div>
  );
}

export function TerminalSettingsPanel({
  terminalFontSize,
  setTerminalFontSize,
  terminalFontFamily,
  setTerminalFontFamily,
  autoClearLogs,
  setAutoClearLogs,
  showLogsTimestamp,
  setShowLogsTimestamp,
  showStreamName,
  setShowStreamName,
}: {
  terminalFontSize: string;
  setTerminalFontSize: (size: string) => void;
  terminalFontFamily: string;
  setTerminalFontFamily: (family: string) => void;
  autoClearLogs: boolean;
  setAutoClearLogs: (clear: boolean) => void;
  showLogsTimestamp: boolean;
  setShowLogsTimestamp: (show: boolean) => void;
  showStreamName: boolean;
  setShowStreamName: (show: boolean) => void;
}) {
  const previewFontFamily =
    terminalFontFamily === "System Mono"
      ? "'Cascadia Mono', 'SF Mono', Consolas, 'Liberation Mono', monospace"
      : terminalFontFamily === "Consolas"
        ? "'Consolas', 'Cascadia Mono', monospace"
        : terminalFontFamily === "SF Mono"
          ? "'SF Mono', system-ui, monospace"
          : "monospace";

  return (
    <div className="fade-in space-y-3">
      <SettingsCard
        icon={<Terminal size={18} />}
        title="Text Typography"
        description="Change font styles and size of logs displayed in terminal"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="terminal-font" className="text-[12px] font-semibold text-muted-foreground">
              Font Family
            </label>
            <Select value={terminalFontFamily} onValueChange={setTerminalFontFamily}>
              <SelectTrigger id="terminal-font">
                <SelectValue placeholder="Select a font family" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="System Mono">System Mono</SelectItem>
                <SelectItem value="Consolas">Consolas</SelectItem>
                <SelectItem value="SF Mono">SF Mono</SelectItem>
                <SelectItem value="Monospace">Generic Monospace</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-semibold text-muted-foreground">Font Size</label>
            <div className="flex gap-2">
              {["12px", "13px", "14px", "15px"].map((size) => (
                <Button
                  key={size}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-8 flex-1 rounded-[8px] border border-app-border bg-input text-[12.5px] font-semibold text-muted-foreground",
                    terminalFontSize === size && "border-primary bg-primary/10 text-primary",
                  )}
                  onClick={() => setTerminalFontSize(size)}
                >
                  {size}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<Layout size={18} />}
        title="Console Settings"
        description="Manage terminal behavior and stream layouts"
      >
        <div className="flex flex-col gap-3">
          {[
            {
              title: "Auto-clear logs on command execution",
              description: "Automatically wipe prior stdout/stderr logs whenever a command starts",
              checked: autoClearLogs,
              onChange: setAutoClearLogs,
            },
            {
              title: "Display line timestamps",
              description: "Prepend console logs with their arrival time (e.g. [10:32:01])",
              checked: showLogsTimestamp,
              onChange: setShowLogsTimestamp,
            },
            {
              title: "Show stream identifiers",
              description: "Show stdout / stderr badges alongside outputs",
              checked: showStreamName,
              onChange: setShowStreamName,
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-app-border bg-input/40 px-3 py-2.5"
            >
              <div className="min-w-0">
                <h4 className="text-[12.5px] font-semibold text-app-title">{item.title}</h4>
                <p className="text-[11.5px] text-muted-foreground">{item.description}</p>
              </div>
              <Switch checked={item.checked} onCheckedChange={item.onChange} />
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<Info size={16} />}
        title="Terminal Render Preview"
        description="Live preview of logs using selected styles"
      >
        <div
          className="overflow-hidden rounded-[10px] border border-app-border bg-[#03050a] p-3 font-mono text-slate-200"
          style={{ fontSize: terminalFontSize, fontFamily: previewFontFamily }}
        >
          <div className="text-slate-400">$ npm run dev</div>
          <div className="text-emerald-200">
            {showLogsTimestamp ? <span className="mr-1 opacity-60">[{new Date().toLocaleTimeString()}] </span> : null}
            {showStreamName ? <span className="mr-1 opacity-70">[stdout] </span> : null}
            Vite server started on port 3000 successfully.
          </div>
          <div className="text-emerald-200">
            {showLogsTimestamp ? <span className="mr-1 opacity-60">[{new Date().toLocaleTimeString()}] </span> : null}
            {showStreamName ? <span className="mr-1 opacity-70">[stdout] </span> : null}
            Watching files in /projects/app-shell...
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

export function SystemSettingsPanel({
  appInfo,
  projectCount,
  commandCount,
  onResetCache,
}: {
  appInfo?: AppInfo;
  projectCount: number;
  commandCount: number;
  onResetCache: () => void;
}) {
  return (
    <div className="fade-in space-y-3">
      <div className="rounded-[12px] border border-app-border bg-card p-4 shadow-app-card">
        <div className="flex items-start gap-3">
          <img className="h-14 w-14 rounded-[12px] border border-app-border object-cover" src={appIcon} alt="" />
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-app-title">{appInfo?.name ?? "Projects Runner"}</h3>
            <p className="text-[12px] text-muted-foreground">Version {appInfo?.version ?? "0.1.0"}</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Developer dashboard companion to organize, configure and run repeated project command lines synchronously.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[10px] border border-app-border bg-input/50 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Registered Projects
          </span>
          <strong className="mt-1 block text-[20px] text-app-title">{projectCount}</strong>
        </div>
        <div className="rounded-[10px] border border-app-border bg-input/50 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Active Project Commands
          </span>
          <strong className="mt-1 block text-[20px] text-app-title">{commandCount}</strong>
        </div>
      </div>

      <SettingsCard
        icon={<Trash2 size={18} />}
        title="Danger Zone"
        description="Reset application cache, config preferences, or clear local logs cache"
        iconClassName="bg-destructive/10 text-destructive"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-[12.5px] font-semibold text-app-title">Reset Application Cache</h4>
            <p className="text-[11.5px] text-muted-foreground">
              Wipe all theme overrides, local preferences and reload projects list
            </p>
          </div>
          <Button variant="danger" onClick={onResetCache}>
            Reset App Cache
          </Button>
        </div>
      </SettingsCard>
    </div>
  );
}
