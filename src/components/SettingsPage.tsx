import { useState } from "react";
import { Info, Palette, Settings, Terminal } from "lucide-react";
import type { AppInfo } from "../lib/api";
import type { AccentColor } from "../lib/theme";
import { Button } from "./ui/button";
import {
  AppearanceSettingsPanel,
  SystemSettingsPanel,
  TerminalSettingsPanel,
} from "./settings-panels";
import { cn } from "@/lib/utils";

export interface SettingsPageProps {
  appInfo?: AppInfo;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
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
  projectCount: number;
  commandCount: number;
  onResetCache: () => void;
}

export function SettingsPage({
  appInfo,
  theme,
  setTheme,
  accent,
  setAccent,
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
  projectCount,
  commandCount,
  onResetCache,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<"appearance" | "terminal" | "system">("appearance");

  const navItems = [
    { id: "appearance" as const, label: "Appearance", icon: Palette },
    { id: "terminal" as const, label: "Terminal", icon: Terminal },
    { id: "system" as const, label: "System", icon: Info },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Settings className="h-8 w-8 rounded-[8px] border border-app-border p-1.5 text-primary" size={24} />
          <div>
            <h2 className="text-[18px] font-semibold text-app-title">Settings</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Customize your workspace, terminal preferences, and view system information
            </p>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="flex h-fit flex-col gap-1 rounded-[12px] border border-app-border bg-card p-2 shadow-app-card">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                className={cn(
                  "justify-start gap-2 rounded-[10px] px-3 py-2 text-[12.5px]",
                  active && "bg-primary/10 text-primary",
                )}
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </Button>
            );
          })}
        </aside>

        <div className="min-h-0 overflow-y-auto pr-1 pb-4">
          {activeTab === "appearance" ? (
            <AppearanceSettingsPanel theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
          ) : null}
          {activeTab === "terminal" ? (
            <TerminalSettingsPanel
              terminalFontSize={terminalFontSize}
              setTerminalFontSize={setTerminalFontSize}
              terminalFontFamily={terminalFontFamily}
              setTerminalFontFamily={setTerminalFontFamily}
              autoClearLogs={autoClearLogs}
              setAutoClearLogs={setAutoClearLogs}
              showLogsTimestamp={showLogsTimestamp}
              setShowLogsTimestamp={setShowLogsTimestamp}
              showStreamName={showStreamName}
              setShowStreamName={setShowStreamName}
            />
          ) : null}
          {activeTab === "system" ? (
            <SystemSettingsPanel
              appInfo={appInfo}
              projectCount={projectCount}
              commandCount={commandCount}
              onResetCache={onResetCache}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

