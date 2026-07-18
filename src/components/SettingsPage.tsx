import type { AppInfo } from "../lib/api";
import type { AccentColor, ThemePreference } from "../lib/theme";
import type { MotionLevel } from "../lib/motion";
import type { DateFormatPreference } from "../lib/date-time";
import { AppearanceSettingsPanel, SystemSettingsPanel, TerminalSettingsPanel } from "./settings-panels";

export type SettingsSectionId = "appearance" | "terminal" | "system";

export interface SettingsPageProps {
  appInfo?: AppInfo;
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
  dateFormat: DateFormatPreference;
  setDateFormat: (format: DateFormatPreference) => void;
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
  isCheckingUpdates: boolean;
  onCheckUpdates: () => void;
  activeSection?: SettingsSectionId;
}

export function SettingsPage({
  appInfo,
  theme,
  setTheme,
  accent,
  setAccent,
  dateFormat,
  setDateFormat,
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
  onResetCache,
  isCheckingUpdates,
  onCheckUpdates,
  activeSection,
}: SettingsPageProps) {
  const currentSection = activeSection ?? "appearance";

  const panel =
    currentSection === "appearance" ? (
      <AppearanceSettingsPanel
        theme={theme}
        setTheme={setTheme}
        accent={accent}
        setAccent={setAccent}
        dateFormat={dateFormat}
        setDateFormat={setDateFormat}
        motionLevel={motionLevel}
        setMotionLevel={setMotionLevel}
      />
    ) : currentSection === "terminal" ? (
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
    ) : (
      <SystemSettingsPanel
        appInfo={appInfo}
        onResetCache={onResetCache}
        isCheckingUpdates={isCheckingUpdates}
        onCheckUpdates={onCheckUpdates}
      />
    );

  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[var(--vscode-editor)]">
      <div className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col px-6 py-5">
        {panel}
      </div>
    </section>
  );
}
