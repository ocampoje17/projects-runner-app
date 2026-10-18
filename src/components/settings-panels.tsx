import {
  Check,
  FolderKanban,
  Info,
  Moon,
  Palette,
  Sparkles,
  Sun,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import { type ReactNode } from "react";
import type { InteractiveTerminalKind, InteractiveTerminalOption } from "../lib/interactive-terminal";
import appIcon from "../assets/app-icon.png";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
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
import { ACCENT_THEMES, type AccentColor, type ThemePreference } from "../lib/theme";
import type { MotionLevel } from "../lib/motion";
import { formatTime, type DateFormatPreference } from "../lib/date-time";
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
    <section className="border-b border-[var(--vscode-border)] pb-6 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className={cn(
              "mt-0.5 shrink-0 text-[var(--vscode-icon)]",
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
      <div className="space-y-px">{children}</div>
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
        "flex items-center justify-between gap-4 border-b border-[var(--vscode-border)] py-3 last:border-b-0",
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
  dateFormat,
  setDateFormat,
  allowMultipleExplorerItems,
  setAllowMultipleExplorerItems,
  restoreOpenTabs,
  setRestoreOpenTabs,
}: {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
  dateFormat: DateFormatPreference;
  setDateFormat: (format: DateFormatPreference) => void;
  allowMultipleExplorerItems: boolean;
  setAllowMultipleExplorerItems: (allow: boolean) => void;
  restoreOpenTabs: boolean;
  setRestoreOpenTabs: (restore: boolean) => void;
  motionLevel: MotionLevel;
  setMotionLevel: (level: MotionLevel) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-4">
      <SettingsSection
        icon={<Palette size={16} />}
        title="Theme mode"
        description="Choose light, dark, or follow your system setting"
      >
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { id: "light", label: "Light", Icon: Sun },
              { id: "dark", label: "Dark", Icon: Moon },
              { id: "system", label: "System", Icon: Info },
            ] as const
          ).map((option) => {
            const active = theme === option.id;
            return (
              <Button
                key={option.id}
                type="button"
                variant="ghost"
                className={cn(
                  "h-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5 text-left hover:border-border-strong hover:bg-[var(--vscode-list-hover)]",
                  active && "border-primary/40 bg-[var(--vscode-list-selected)] text-foreground",
                )}
                onClick={() => setTheme(option.id)}
              >
                <div
                  className={cn(
                    "flex h-[52px] w-full flex-col gap-1.5 overflow-hidden rounded-[6px] border border-[var(--vscode-border)] p-2",
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
                <div className="flex w-full items-center gap-2 px-1 pt-2 text-[12.5px] font-normal text-foreground">
                  <option.Icon size={15} />
                  <span>{option.label}</span>
                  {active ? <Check className="ml-auto text-primary" size={14} /> : null}
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
        <div className="max-w-[260px] py-1">
          <Select value={accent} onValueChange={(value) => setAccent(value as AccentColor)}>
            <SelectTrigger aria-label="Accent color">
              <SelectValue placeholder="Select an accent color">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-[var(--vscode-border)]"
                    style={{ backgroundColor: ACCENT_THEMES[accent].primary }}
                  />
                  <span>{accent === "mono" ? "Mono" : "Blue"}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mono">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-[var(--vscode-border)]"
                    style={{ backgroundColor: ACCENT_THEMES.mono.primary }}
                  />
                  <span>Mono</span>
                </div>
              </SelectItem>
              <SelectItem value="blue">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-[var(--vscode-border)]"
                    style={{ backgroundColor: ACCENT_THEMES.blue.primary }}
                  />
                  <span>Blue</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<Info size={16} />}
        title="Date format"
        description="Choose how dates are displayed across the app"
      >
        <div className="max-w-[260px] py-1">
          <Select value={dateFormat} onValueChange={(value) => setDateFormat(value as DateFormatPreference)}>
            <SelectTrigger aria-label="Date format">
              <SelectValue placeholder="Select a date format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dd/mm/yyyy">dd/mm/yyyy</SelectItem>
              <SelectItem value="mm/dd/yyyy">mm/dd/yyyy</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<FolderKanban size={16} />}
        title="Sidebar & Tabs"
        description="Customize display behavior for the Explorer sidebar and workspace tabs"
      >
        <SettingsRow
          title="Allow multiple open items"
          description="Allow multiple projects to remain expanded simultaneously in the Explorer sidebar instead of auto-collapsing others"
        >
          <Switch
            checked={allowMultipleExplorerItems}
            onCheckedChange={setAllowMultipleExplorerItems}
          />
        </SettingsRow>
        <SettingsRow
          title="Restore open tabs on startup"
          description="Automatically reopen all open tabs when relaunching the app. Pinned tabs are always preserved regardless of this setting"
        >
          <Switch
            checked={restoreOpenTabs}
            onCheckedChange={setRestoreOpenTabs}
          />
        </SettingsRow>
      </SettingsSection>

    </div>
  );
}

export function TerminalSettingsPanel({
  terminalFontSize,
  setTerminalFontSize,
  defaultInteractiveTerminalKind,
  setDefaultInteractiveTerminalKind,
  interactiveTerminalOptions,
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
  defaultInteractiveTerminalKind: InteractiveTerminalKind;
  setDefaultInteractiveTerminalKind: (kind: InteractiveTerminalKind) => void;
  interactiveTerminalOptions: InteractiveTerminalOption[];
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
    <div className="flex w-full flex-col gap-4">
      <SettingsSection icon={<Terminal size={16} />} title="Default terminal" description="Used when opening a new internal interactive terminal from the app">
        <div className="flex flex-col gap-2 py-1">
          <Label htmlFor="default-interactive-terminal">Terminal</Label>
          <Select value={defaultInteractiveTerminalKind} onValueChange={(value) => setDefaultInteractiveTerminalKind(value as InteractiveTerminalKind)}>
            <SelectTrigger id="default-interactive-terminal"><SelectValue placeholder="Select a terminal" /></SelectTrigger>
            <SelectContent>{interactiveTerminalOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </SettingsSection>
      <SettingsSection
        icon={<Terminal size={16} />}
        title="Typography"
        description="Font family and size used by the logs terminal"
      >
        <div className="grid gap-4 py-1 lg:grid-cols-2">
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
            <Label htmlFor="terminal-font-size">Font size</Label>
            <Input
              id="terminal-font-size"
              list="terminal-font-size-options"
              inputMode="numeric"
              placeholder="14px"
              value={terminalFontSize}
              onChange={(event) => setTerminalFontSize(event.target.value)}
            />
            <datalist id="terminal-font-size-options">
              {["12px", "13px", "14px", "15px", "16px", "18px"].map((size) => (
                <option key={size} value={size} />
              ))}
            </datalist>
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
          className="overflow-hidden rounded-[6px] border border-[var(--vscode-border)] bg-[var(--terminal-bg)] px-4 py-3 font-mono text-[var(--terminal-fg)]"
          style={{ fontSize: terminalFontSize, fontFamily: previewFontFamily }}
        >
          <div className="text-slate-400">$ npm run dev</div>
          <div className="text-emerald-200">
            {showLogsTimestamp ? <span className="mr-1 opacity-60">[{formatTime(new Date())}] </span> : null}
            {showStreamName ? <span className="mr-1 opacity-70">[stdout] </span> : null}
            Vite server started on port 3000 successfully.
          </div>
          <div className="text-emerald-200">
            {showLogsTimestamp ? <span className="mr-1 opacity-60">[{formatTime(new Date())}] </span> : null}
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
  onResetCache,
  isCheckingUpdates,
  onCheckUpdates,
}: {
  appInfo?: AppInfo;
  onResetCache: () => void;
  isCheckingUpdates: boolean;
  onCheckUpdates: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-4">
      <SettingsSection
        icon={<Info size={16} />}
        title="About"
        description="App identity and workspace inventory"
      >
        <div className="flex items-start gap-3 py-1">
          <img className="h-12 w-12 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] object-cover" src={appIcon} alt="" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[14px] font-semibold text-foreground">{appInfo?.name ?? "Projects Runner"}</h4>
              <Badge variant="muted">v{appInfo?.version ?? "0.1.0"}</Badge>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Developer dashboard companion to organize, configure and run repeated project command lines.
            </p>
            <div className="mt-3 space-y-1.5 text-[12px] text-muted-foreground">
              <p>
                Homepage:{" "}
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href="https://projects-runner.laychu.com/"
                  rel="noreferrer"
                  target="_blank"
                >
                  projects-runner.laychu.com
                </a>
              </p>
              <p>
                Email:{" "}
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href="mailto:namqhong@gmail.com"
                >
                  namqhong@gmail.com
                </a>
              </p>
              <p>Telegram: @namhnz</p>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<RefreshCw size={16} />}
        title="Software updates"
        description="Check for the latest releases from GitHub"
      >
        <SettingsRow
          title="Check for new updates"
          description="You will be notified if a newer release compatible with this device is available"
        >
          <Button variant="outline" onClick={onCheckUpdates} disabled={isCheckingUpdates}>
            <RefreshCw className={isCheckingUpdates ? "animate-spin" : undefined} size={14} />
            {isCheckingUpdates ? "Checking for updates..." : "Check for updates"}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        icon={<Trash2 size={16} className="text-[var(--vscode-danger)]" />}
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

export { TwofaSettingsPanel } from "./twofa/twofa-settings-panel";
