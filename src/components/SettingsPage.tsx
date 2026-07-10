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

  const handleResetCache = () => {
    onResetCache();
  };

  return (
    <>
      <header className="workspace-header flex flex-wrap items-start justify-between gap-3">
        <div className="title-cluster flex min-w-0 items-center gap-2.5">
          <Settings className="app-icon settings-header-icon" size={24} />
          <div>
            <h2>Settings</h2>
            <p>Customize your workspace, terminal preferences, and view system information</p>
          </div>
        </div>
      </header>
      
      <div className="settings-container grid min-h-0 flex-1 gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="settings-nav flex flex-col gap-1 rounded-[10px] border border-app-border bg-card p-2 shadow-app-card">
          <Button type="button" variant="ghost" className={`settings-nav-item justify-start ${activeTab === "appearance" ? "active bg-primary/10 text-app-title" : ""}`} onClick={() => setActiveTab("appearance")}>
            <Palette size={16} />
            <span>Appearance</span>
          </Button>
          <Button type="button" variant="ghost" className={`settings-nav-item justify-start ${activeTab === "terminal" ? "active bg-primary/10 text-app-title" : ""}`} onClick={() => setActiveTab("terminal")}>
            <Terminal size={16} />
            <span>Terminal</span>
          </Button>
          <Button type="button" variant="ghost" className={`settings-nav-item justify-start ${activeTab === "system" ? "active bg-primary/10 text-app-title" : ""}`} onClick={() => setActiveTab("system")}>
            <Info size={16} />
            <span>System Details</span>
          </Button>
        </aside>

        <div className="settings-content min-h-0 overflow-y-auto">
          {activeTab === "appearance" && (
            <AppearanceSettingsPanel
              theme={theme}
              setTheme={setTheme}
              accent={accent}
              setAccent={setAccent}
            />
          )}

          {activeTab === "terminal" && (
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
          )}

          {activeTab === "system" && (
            <SystemSettingsPanel
              appInfo={appInfo}
              projectCount={projectCount}
              commandCount={commandCount}
              onResetCache={handleResetCache}
            />
          )}
        </div>
      </div>
    </>
  );
}


