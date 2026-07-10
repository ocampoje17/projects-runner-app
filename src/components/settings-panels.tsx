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
    <div className="settings-pane fade-in space-y-3">
      <div className="settings-card rounded-[10px] border border-app-border bg-card p-3 shadow-app-card">
        <div className="settings-card-header">
          <Palette className="accent-icon" size={20} />
          <div>
            <h3>Visual Theme</h3>
            <p>Select the color mode for the user interface</p>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="theme-grid grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="ghost"
              className={`theme-card-option light ${theme === "light" ? "active" : ""}`}
              onClick={() => setTheme("light")}
            >
              <div className="theme-mockup light">
                <div className="mock-title" />
                <div className="mock-row">
                  <div className="mock-avatar" />
                  <div className="mock-text" />
                </div>
                <div className="mock-badge" />
              </div>
              <div className="theme-label">
                <Sun size={15} />
                <span>Light Mode</span>
                {theme === "light" && <Check className="check-badge" size={14} />}
              </div>
            </Button>

            <Button
              type="button"
              variant="ghost"
              className={`theme-card-option dark ${theme === "dark" ? "active" : ""}`}
              onClick={() => setTheme("dark")}
            >
              <div className="theme-mockup dark">
                <div className="mock-title" />
                <div className="mock-row">
                  <div className="mock-avatar" />
                  <div className="mock-text" />
                </div>
                <div className="mock-badge" />
              </div>
              <div className="theme-label">
                <Moon size={15} />
                <span>Dark Mode</span>
                {theme === "dark" && <Check className="check-badge" size={14} />}
              </div>
            </Button>
          </div>
        </div>
      </div>

      <div className="settings-card rounded-[10px] border border-app-border bg-card p-3 shadow-app-card">
        <div className="settings-card-header">
          <Sparkles className="accent-icon" size={20} />
          <div>
            <h3>Accent Color</h3>
            <p>Customize the primary focus highlights and gradients</p>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="accent-list">
            {(["indigo", "emerald", "rose", "amber", "sky"] as AccentColor[]).map((col) => (
              <Button
                key={col}
                type="button"
                variant="ghost"
                className={`accent-bubble-option ${accent === col ? "active" : ""}`}
                style={{ "--accent-color-color": ACCENT_THEMES[col].primary } as React.CSSProperties}
                onClick={() => setAccent(col)}
                title={col.charAt(0).toUpperCase() + col.slice(1)}
              >
                <span className="accent-bubble-circle" style={{ backgroundColor: ACCENT_THEMES[col].primary }} />
                <span className="accent-bubble-text">{col.charAt(0).toUpperCase() + col.slice(1)}</span>
                {accent === col && <Check size={14} className="accent-check" />}
              </Button>
            ))}
          </div>
        </div>
      </div>
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
  return (
    <div className="settings-pane fade-in space-y-3">
      <div className="settings-card rounded-[10px] border border-app-border bg-card p-3 shadow-app-card">
        <div className="settings-card-header">
          <Terminal className="accent-icon" size={20} />
          <div>
            <h3>Text Typography</h3>
            <p>Change font styles and size of logs displayed in terminal</p>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="form-group-row">
            <div className="form-item">
              <label htmlFor="terminal-font" className="settings-label">Font Family</label>
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

            <div className="form-item">
              <label className="settings-label">Font Size</label>
              <div className="font-size-pills">
                {["12px", "13px", "14px", "15px"].map((size) => (
                  <Button
                    key={size}
                    type="button"
                    variant="ghost"
                    className={`font-size-pill ${terminalFontSize === size ? "active" : ""}`}
                    onClick={() => setTerminalFontSize(size)}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-card rounded-[10px] border border-app-border bg-card p-3 shadow-app-card">
        <div className="settings-card-header">
          <Layout className="accent-icon" size={20} />
          <div>
            <h3>Console Settings</h3>
            <p>Manage terminal behavior and stream layouts</p>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="toggle-list flex flex-col gap-3">
            <div className="toggle-item flex items-center justify-between gap-3">
              <div className="toggle-info">
                <h4>Auto-clear logs on command execution</h4>
                <p>Automatically wipe prior stdout/stderr logs whenever a command starts</p>
              </div>
              <Switch checked={autoClearLogs} onCheckedChange={setAutoClearLogs} />
            </div>

            <div className="toggle-item flex items-center justify-between gap-3">
              <div className="toggle-info">
                <h4>Display line timestamps</h4>
                <p>Prepend console logs with their arrival time (e.g. [10:32:01])</p>
              </div>
              <Switch checked={showLogsTimestamp} onCheckedChange={setShowLogsTimestamp} />
            </div>

            <div className="toggle-item flex items-center justify-between gap-3">
              <div className="toggle-info">
                <h4>Show stream identifiers</h4>
                <p>Show stdout / stderr badges alongside outputs</p>
              </div>
              <Switch checked={showStreamName} onCheckedChange={setShowStreamName} />
            </div>
          </div>
        </div>
      </div>

      <div className="settings-card rounded-[10px] border border-app-border bg-card p-3 shadow-app-card">
        <div className="settings-card-header">
          <Info className="accent-icon" size={16} />
          <div>
            <h3>Terminal Render Preview</h3>
            <p>Live preview of logs using selected styles</p>
          </div>
        </div>
        <div className="settings-card-body">
          <div
            className="terminal-live-preview"
            style={{
              fontSize: terminalFontSize,
              fontFamily:
                terminalFontFamily === "System Mono"
                  ? "'Cascadia Mono', 'SF Mono', Consolas, 'Liberation Mono', monospace"
                  : terminalFontFamily === "Consolas"
                    ? "'Consolas', 'Cascadia Mono', monospace"
                    : terminalFontFamily === "SF Mono"
                      ? "'SF Mono', system-ui, monospace"
                      : "monospace",
            }}
          >
            <div className="preview-line input">$ npm run dev</div>
            <div className="preview-line stdout">
              {showLogsTimestamp && <span className="preview-timestamp">[{new Date().toLocaleTimeString()}] </span>}
              {showStreamName && <span className="preview-stream-name">[stdout] </span>}
              Vite server started on port 3000 successfully.
            </div>
            <div className="preview-line stdout">
              {showLogsTimestamp && <span className="preview-timestamp">[{new Date().toLocaleTimeString()}] </span>}
              {showStreamName && <span className="preview-stream-name">[stdout] </span>}
              Watching files in /projects/app-shell...
            </div>
          </div>
        </div>
      </div>
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
    <div className="settings-pane fade-in space-y-3">
      <div className="settings-card brand-details-card">
        <div className="brand-detail-header">
          <img className="welcome-icon" src={appIcon} alt="" />
          <div>
            <h3>{appInfo?.name ?? "Projects Runner"}</h3>
            <p className="system-version-tag">Version {appInfo?.version ?? "0.1.0"}</p>
            <p>Developer dashboard companion to organize, configure and run repeated project command lines synchronously.</p>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-title">Registered Projects</span>
          <strong className="stat-value">{projectCount}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-title">Active Project Commands</span>
          <strong className="stat-value">{commandCount}</strong>
        </div>
      </div>

      <div className="settings-card danger-card">
        <div className="settings-card-header">
          <Trash2 className="danger-icon" size={20} />
          <div>
            <h3>Danger Zone</h3>
            <p>Reset application cache, config preferences, or clear local logs cache</p>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="danger-actions">
            <div>
              <h4>Reset Application Cache</h4>
              <p>Wipe all theme overrides, local preferences and reload projects list</p>
            </div>
            <Button variant="danger" onClick={onResetCache}>
              Reset App Cache
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


