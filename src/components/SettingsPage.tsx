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
      <header className="workspace-header">
        <div className="title-cluster">
          <Settings className="app-icon settings-header-icon" size={24} />
          <div>
            <h2>Settings</h2>
            <p>Customize your workspace, terminal preferences, and view system information</p>
          </div>
        </div>
      </header>
      
      <div className="settings-container">
        <aside className="settings-nav">
          <Button type="button" variant="ghost" className={`settings-nav-item ${activeTab === "appearance" ? "active" : ""}`} onClick={() => setActiveTab("appearance")}>
            <Palette size={16} />
            <span>Appearance</span>
          </Button>
          <Button type="button" variant="ghost" className={`settings-nav-item ${activeTab === "terminal" ? "active" : ""}`} onClick={() => setActiveTab("terminal")}>
            <Terminal size={16} />
            <span>Terminal</span>
          </Button>
          <Button type="button" variant="ghost" className={`settings-nav-item ${activeTab === "system" ? "active" : ""}`} onClick={() => setActiveTab("system")}>
            <Info size={16} />
            <span>System Details</span>
          </Button>
        </aside>

        <div className="settings-content">
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
