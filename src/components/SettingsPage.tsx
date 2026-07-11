import { useState } from "react";
import { Info, Palette, Settings, Terminal } from "lucide-react";
import type { AppInfo } from "../lib/api";
import type { AccentColor } from "../lib/theme";
import type { MotionLevel } from "../lib/motion";
import {
  AppearanceSettingsPanel,
  SystemSettingsPanel,
  TerminalSettingsPanel,
} from "./settings-panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

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
  motionLevel: MotionLevel;
  setMotionLevel: (level: MotionLevel) => void;
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
  motionLevel,
  setMotionLevel,
  projectCount,
  commandCount,
  onResetCache,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<"appearance" | "terminal" | "system">("appearance");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
      <header className="flex shrink-0 items-start gap-2.5">
        <Settings className="h-9 w-9 rounded-[14px] border border-border bg-primary/6 p-2 text-primary shadow-sm" size={20} />
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-app-title">Settings</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Workspace appearance, terminal preferences, and system info
          </p>
        </div>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "appearance" | "terminal" | "system")}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
        variant="pill"
      >
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="appearance" className="gap-1.5">
            <Palette size={14} />
            Appearance
          </TabsTrigger>
          <TabsTrigger value="terminal" className="gap-1.5">
            <Terminal size={14} />
            Terminal
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-1.5">
            <Info size={14} />
            System
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <TabsContent value="appearance" className="block">
            <AppearanceSettingsPanel
              theme={theme}
              setTheme={setTheme}
              accent={accent}
              setAccent={setAccent}
              motionLevel={motionLevel}
              setMotionLevel={setMotionLevel}
            />
          </TabsContent>
          <TabsContent value="terminal" className="block">
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
          </TabsContent>
          <TabsContent value="system" className="block">
            <SystemSettingsPanel
              appInfo={appInfo}
              projectCount={projectCount}
              commandCount={commandCount}
              onResetCache={onResetCache}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
