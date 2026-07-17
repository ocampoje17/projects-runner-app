import {
  Check,
  Info,
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
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import type { AppInfo } from "../lib/api";
import { ACCENT_THEMES, type AccentColor } from "../lib/theme";
import type { MotionLevel } from "../lib/motion";
import { ThemeToggle } from "./motion/theme-toggle";
import { cn } from "@/lib/utils";

function SettingsSection({
  icon,
  title,
  description,
  children,
  action,
  tone = "default",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className={cn(
              "mt-0.5 shrink-0 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-2",
              tone === "danger" ? "text-destructive" : "text-primary",
            )}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold tracking-[-0.02em] text-foreground">{title}</h3>
            <p className="text-[12px] text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-3.5">
        <div className="space-y-2.5">{children}</div>
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-3.5 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h4 className="text-[12.5px] font-semibold text-foreground">{title}</h4>
        {description ? <p className="text-[11.5px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
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
  motionLevel: MotionLevel;
  setMotionLevel: (level: MotionLevel) => void;
}) {
  return (
    <div className="fade-in mx-auto flex w-full max-w-[1120px] flex-col gap-6">
      <SettingsSection
        icon={<Palette size={16} />}
        title="Theme mode"
        description="Switch between light and dark interface styles"
        action={<ThemeToggle theme={theme} onThemeChange={setTheme} variant="circle" start="center" />}
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {(
            [
              { id: "light", label: "Light", Icon: Sun },
              { id: "dark", label: "Dark", Icon: Moon },
            ] as const
          ).map((option) => {
            const active = theme === option.id;
            return (
              <Button
                key={option.id}
                type="button"
                variant="ghost"
                className={cn(
                  "h-auto flex-col items-stretch gap-2 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-3 text-left hover:border-border-strong hover:bg-[var(--vscode-list-hover)]",
                  active && "border-primary/50 bg-[var(--vscode-list-active)] text-foreground",
                )}
                onClick={() => setTheme(option.id)}
              >
                <div
                  className={cn(
                    "flex h-[78px] w-full flex-col gap-2 overflow-hidden rounded-[6px] border border-[var(--vscode-border)] p-2.5",
                    option.id === "light" ? "bg-[#fafafa]" : "bg-[#151515]",
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
      </SettingsSection>

      <SettingsSection
        icon={<Sparkles size={16} />}
        title="Accent color"
        description="Primary highlights, focus rings, and gradients"
      >
        <div className="flex flex-wrap gap-2">
          {(["mono", "blue"] as AccentColor[]).map((col) => {
            const active = accent === col;
            return (
              <Button
                key={col}
                type="button"
                variant="ghost"
                className={cn(
                  "h-auto rounded-[999px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] px-3 py-2 text-[12.5px] font-medium text-muted-foreground hover:border-border-strong hover:bg-[var(--vscode-list-hover)] hover:text-foreground",
                  active && "border-primary bg-[var(--vscode-list-active)] text-foreground",
                )}
                style={{ ["--accent-color-color" as string]: ACCENT_THEMES[col].primary } as CSSProperties}
                onClick={() => setAccent(col)}
                title={col.charAt(0).toUpperCase() + col.slice(1)}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ACCENT_THEMES[col].primary }} />
                <span>{col.charAt(0).toUpperCase() + col.slice(1)}</span>
                {active ? <Check size={14} className="text-primary" /> : null}
              </Button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<Check size={16} />}
        title="Motion"
        description="Interface motion is disabled so the app behaves like a static VS Code-style shell"
      >
        <div className="rounded-[8px] border border-primary/35 bg-[var(--vscode-list-active)] px-3.5 py-3 text-[12.5px] text-foreground">
          Motion has been turned off globally. Hover, focus, active, and selected states now use static color and border changes only.
        </div>
      </SettingsSection>
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
    <div className="fade-in mx-auto flex w-full max-w-[1120px] flex-col gap-6">
      <SettingsSection
        icon={<Terminal size={16} />}
        title="Typography"
        description="Font family and size used by the logs terminal"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="terminal-font">Font family</Label>
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
            <Label>Font size</Label>
            <div className="flex flex-wrap gap-1.5">
              {["12px", "13px", "14px", "15px", "16px"].map((size) => {
                const active = terminalFontSize === size;
                return (
                  <Button
                    key={size}
                    type="button"
                    size="sm"
                    variant={active ? "primary" : "secondary"}
                    className={cn("min-w-12", !active && "border-[var(--vscode-border)] bg-[var(--vscode-editor)] hover:bg-[var(--vscode-list-hover)]")}
                    onClick={() => setTerminalFontSize(size)}
                  >
                    {size.replace("px", "")}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<Info size={16} />}
        title="Log display"
        description="Control what appears in each terminal line"
      >
        {[
          {
            title: "Auto clear logs",
            description: "Clear previous logs whenever a command starts",
            checked: autoClearLogs,
            onChange: setAutoClearLogs,
          },
          {
            title: "Line timestamps",
            description: "Prepend logs with arrival time (e.g. [10:32:01])",
            checked: showLogsTimestamp,
            onChange: setShowLogsTimestamp,
          },
          {
            title: "Stream identifiers",
            description: "Show stdout / stderr badges next to output",
            checked: showStreamName,
            onChange: setShowStreamName,
          },
        ].map((item) => (
          <SettingsRow key={item.title} title={item.title} description={item.description}>
            <Switch checked={item.checked} onCheckedChange={item.onChange} />
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection
        icon={<Terminal size={16} />}
        title="Render preview"
        description="Live preview of the selected terminal styles"
      >
        <div
          className="overflow-hidden rounded-[8px] border border-[var(--vscode-border)] bg-[var(--terminal-bg)] p-3 font-mono text-[var(--terminal-fg)]"
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
      </SettingsSection>
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
    <div className="fade-in mx-auto flex w-full max-w-[1120px] flex-col gap-6">
      <SettingsSection
        icon={<Info size={16} />}
        title="About"
        description="App identity and workspace inventory"
      >
        <div className="flex items-start gap-3 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-3.5">
          <img className="h-12 w-12 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] object-cover" src={appIcon} alt="" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[14px] font-semibold text-foreground">{appInfo?.name ?? "Projects Runner"}</h4>
              <Badge variant="muted">v{appInfo?.version ?? "0.1.0"}</Badge>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Developer dashboard companion to organize, configure and run repeated project command lines.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Projects
            </span>
            <strong className="mt-1 block text-[20px] text-foreground">{projectCount}</strong>
          </div>
          <div className="rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Commands
            </span>
            <strong className="mt-1 block text-[20px] text-foreground">{commandCount}</strong>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<Trash2 size={16} />}
        title="Danger zone"
        description="Reset local preferences and cached application state"
        tone="danger"
      >
        <SettingsRow
          title="Reset application cache"
          description="Wipe theme overrides, local preferences and reload projects"
        >
          <Button variant="danger" onClick={onResetCache}>
            Reset cache
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
