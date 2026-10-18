import type { AppInfo } from "../lib/api";
import type { InteractiveTerminalKind, InteractiveTerminalOption } from "../lib/interactive-terminal";
import type { AccentColor, ThemePreference } from "../lib/theme";
import type { MotionLevel } from "../lib/motion";
import type { DateFormatPreference } from "../lib/date-time";
import {
  AppearanceSettingsPanel,
  SystemSettingsPanel,
  TerminalSettingsPanel,
  TwofaSettingsPanel,
} from "./settings-panels";

export type SettingsSectionId = "appearance" | "terminal" | "system" | "twofa";

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
  motionLevel: MotionLevel;
  setMotionLevel: (level: MotionLevel) => void;
  allowMultipleExplorerItems: boolean;
  setAllowMultipleExplorerItems: (allow: boolean) => void;
  restoreOpenTabs: boolean;
  setRestoreOpenTabs: (restore: boolean) => void;
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
  allowMultipleExplorerItems,
  setAllowMultipleExplorerItems,
  restoreOpenTabs,
  setRestoreOpenTabs,
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
        allowMultipleExplorerItems={allowMultipleExplorerItems}
        setAllowMultipleExplorerItems={setAllowMultipleExplorerItems}
        restoreOpenTabs={restoreOpenTabs}
        setRestoreOpenTabs={setRestoreOpenTabs}
        motionLevel={motionLevel}
        setMotionLevel={setMotionLevel}
      />
    ) : currentSection === "terminal" ? (
      <TerminalSettingsPanel
        terminalFontSize={terminalFontSize}
        setTerminalFontSize={setTerminalFontSize}
        defaultInteractiveTerminalKind={defaultInteractiveTerminalKind}
        setDefaultInteractiveTerminalKind={setDefaultInteractiveTerminalKind}
        interactiveTerminalOptions={interactiveTerminalOptions}
        terminalFontFamily={terminalFontFamily}
        setTerminalFontFamily={setTerminalFontFamily}
        autoClearLogs={autoClearLogs}
        setAutoClearLogs={setAutoClearLogs}
        showLogsTimestamp={showLogsTimestamp}
        setShowLogsTimestamp={setShowLogsTimestamp}
        showStreamName={showStreamName}
        setShowStreamName={setShowStreamName}
      />
    ) : currentSection === "twofa" ? (
      <TwofaSettingsPanel />
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
