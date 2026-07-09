import { useState } from "react";
import {
  Check,
  Info,
  Layout,
  Moon,
  Palette,
  Settings,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
} from "lucide-react";
import appIcon from "../assets/app-icon.png";
import { Button } from "./ui/button";
import { AppInfo } from "../lib/api";
import { AccentColor, ACCENT_THEMES } from "../lib/theme";

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
        {/* Settings sub-navigation sidebar */}
        <aside className="settings-nav">
          <button
            type="button"
            className={`settings-nav-item ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => setActiveTab("appearance")}
          >
            <Palette size={16} />
            <span>Appearance</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === "terminal" ? "active" : ""}`}
            onClick={() => setActiveTab("terminal")}
          >
            <Terminal size={16} />
            <span>Terminal</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === "system" ? "active" : ""}`}
            onClick={() => setActiveTab("system")}
          >
            <Info size={16} />
            <span>System Details</span>
          </button>
        </aside>

        {/* Settings main content pane */}
        <div className="settings-content">
          {activeTab === "appearance" && (
            <div className="settings-pane fade-in">
              <div className="settings-card">
                <div className="settings-card-header">
                  <Palette className="accent-icon" size={20} />
                  <div>
                    <h3>Visual Theme</h3>
                    <p>Select the color mode for the user interface</p>
                  </div>
                </div>
                <div className="settings-card-body">
                  <div className="theme-grid">
                    <button
                      type="button"
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
                    </button>

                    <button
                      type="button"
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
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-card">
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
                      <button
                        key={col}
                        type="button"
                        className={`accent-bubble-option ${accent === col ? "active" : ""}`}
                        style={{ "--accent-color-color": ACCENT_THEMES[col].primary } as React.CSSProperties}
                        onClick={() => setAccent(col)}
                        title={col.charAt(0).toUpperCase() + col.slice(1)}
                      >
                        <span className="accent-bubble-circle" style={{ backgroundColor: ACCENT_THEMES[col].primary }} />
                        <span className="accent-bubble-text">{col.charAt(0).toUpperCase() + col.slice(1)}</span>
                        {accent === col && <Check size={14} className="accent-check" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "terminal" && (
            <div className="settings-pane fade-in">
              <div className="settings-card">
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
                      <select
                        id="terminal-font"
                        className="settings-select-field"
                        value={terminalFontFamily}
                        onChange={(e) => setTerminalFontFamily(e.target.value)}
                      >
                        <option value="JetBrains Mono">JetBrains Mono</option>
                        <option value="Fira Code">Fira Code</option>
                        <option value="SF Mono">SF Mono</option>
                        <option value="Courier New">Courier New</option>
                      </select>
                    </div>

                    <div className="form-item">
                      <label className="settings-label">Font Size</label>
                      <div className="font-size-pills">
                        {["12px", "14px", "16px", "18px"].map((size) => (
                          <button
                            key={size}
                            type="button"
                            className={`font-size-pill ${terminalFontSize === size ? "active" : ""}`}
                            onClick={() => setTerminalFontSize(size)}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-header">
                  <Layout className="accent-icon" size={20} />
                  <div>
                    <h3>Console Settings</h3>
                    <p>Manage terminal behavior and stream layouts</p>
                  </div>
                </div>
                <div className="settings-card-body">
                  <div className="toggle-list">
                    <div className="toggle-item">
                      <div className="toggle-info">
                        <h4>Auto-clear logs on command execution</h4>
                        <p>Automatically wipe prior stdout/stderr logs whenever a command starts</p>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={autoClearLogs}
                          onChange={(e) => setAutoClearLogs(e.target.checked)}
                        />
                        <span className="slider round" />
                      </label>
                    </div>

                    <div className="toggle-item">
                      <div className="toggle-info">
                        <h4>Display line timestamps</h4>
                        <p>Prepend console logs with their arrival time (e.g. [10:32:01])</p>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={showLogsTimestamp}
                          onChange={(e) => setShowLogsTimestamp(e.target.checked)}
                        />
                        <span className="slider round" />
                      </label>
                    </div>

                    <div className="toggle-item">
                      <div className="toggle-info">
                        <h4>Show stream identifiers</h4>
                        <p>Show stdout / stderr badges alongside outputs</p>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={showStreamName}
                          onChange={(e) => setShowStreamName(e.target.checked)}
                        />
                        <span className="slider round" />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Terminal Preview Card */}
              <div className="settings-card">
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
                        terminalFontFamily === "JetBrains Mono"
                          ? "'JetBrains Mono', monospace"
                          : terminalFontFamily === "Fira Code"
                            ? "'Fira Code', monospace"
                            : terminalFontFamily === "SF Mono"
                              ? "'SF Mono', system-ui, monospace"
                              : "'Courier New', monospace",
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
          )}

          {activeTab === "system" && (
            <div className="settings-pane fade-in">
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
                    <Button variant="danger" onClick={handleResetCache}>
                      Reset App Cache
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
