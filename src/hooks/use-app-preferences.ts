import { useEffect, useState } from "react";
import { resolveAccentTheme, type AccentColor, type ResolvedTheme, type ThemePreference } from "../lib/theme";
import type { MotionLevel } from "../lib/motion";
import { isDateFormatPreference, type DateFormatPreference } from "../lib/date-time";

const SYSTEM_MONO_FAMILY = '"Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace';
const ACCENT_VALUES: AccentColor[] = ["mono", "blue"];

function isAccentColor(value: string | null): value is AccentColor {
  return ACCENT_VALUES.includes(value as AccentColor);
}

export function resolveTerminalFontFamilyValue(terminalFontFamily: string) {
  return terminalFontFamily === "System Mono" || terminalFontFamily === "JetBrains Mono" || terminalFontFamily === "Fira Code"
    ? SYSTEM_MONO_FAMILY
    : terminalFontFamily === "Consolas"
      ? '"Consolas", "Cascadia Mono", monospace'
      : terminalFontFamily === "SF Mono"
        ? '"SF Mono", Menlo, Monaco, monospace'
        : "monospace";
}

export function useAppPreferences() {
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem("theme");
    return saved === "dark" || saved === "light" || saved === "system" ? saved : "dark";
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

  const [accent, setAccent] = useState<AccentColor>(() => {
    const saved = localStorage.getItem("accent");
    if (isAccentColor(saved)) return saved;
    return "mono";
  });

  const [terminalFontSize, setTerminalFontSize] = useState(() => localStorage.getItem("terminalFontSize") || "13px");
  const [dateFormat, setDateFormat] = useState<DateFormatPreference>(() => {
    const saved = localStorage.getItem("dateFormat");
    return isDateFormatPreference(saved) ? saved : "dd/mm/yyyy";
  });

  const [terminalFontFamily, setTerminalFontFamily] = useState(() => {
    const saved = localStorage.getItem("terminalFontFamily");
    if (saved === "System Mono" || saved === "Consolas" || saved === "SF Mono" || saved === "Monospace") {
      return saved;
    }

    return "Consolas";
  });

  const [autoClearLogs, setAutoClearLogs] = useState(() => {
    const saved = localStorage.getItem("autoClearLogs");
    return saved === null ? true : saved === "true";
  });

  const [showLogsTimestamp, setShowLogsTimestamp] = useState(() => localStorage.getItem("showLogsTimestamp") === "true");

  const [showStreamName, setShowStreamName] = useState(() => {
    const saved = localStorage.getItem("showStreamName");
    return saved === null ? true : saved === "true";
  });
  const [motionLevel, setMotionLevel] = useState<MotionLevel>("off");

  useEffect(() => {
    localStorage.setItem("theme", theme);
    const root = document.documentElement;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (nextTheme: ResolvedTheme) => {
      setResolvedTheme(nextTheme);
      root.dataset.theme = nextTheme;
      if (nextTheme === "light") {
        root.classList.add("theme-light");
        root.classList.remove("theme-dark");
      } else {
        root.classList.add("theme-dark");
        root.classList.remove("theme-light");
      }
    };

    if (theme === "system") {
      applyTheme(mediaQuery.matches ? "dark" : "light");
      const handleChange = (event: MediaQueryListEvent) => applyTheme(event.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "light") {
      root.classList.add("theme-light");
      root.classList.remove("theme-dark");
    } else {
      root.classList.add("theme-dark");
      root.classList.remove("theme-light");
    }
  }, [resolvedTheme]);

  useEffect(() => {
    localStorage.setItem("accent", accent);
    const root = document.documentElement;
    const colors = resolveAccentTheme(accent, resolvedTheme);
    root.style.setProperty("--primary-color", colors.primary);
    root.style.setProperty("--primary-foreground-color", colors.primaryForeground);
    root.style.setProperty("--primary-gradient", colors.gradient);
    root.style.setProperty("--primary-glow", colors.glow);
    root.style.setProperty("--ring", colors.ring);
  }, [accent, resolvedTheme]);

  useEffect(() => {
    localStorage.setItem("terminalFontSize", terminalFontSize);
    document.documentElement.style.setProperty("--terminal-font-size", terminalFontSize);
  }, [terminalFontSize]);

  useEffect(() => {
    localStorage.setItem("dateFormat", dateFormat);
    document.documentElement.dataset.dateFormat = dateFormat;
  }, [dateFormat]);

  useEffect(() => {
    localStorage.setItem("terminalFontFamily", terminalFontFamily);
    const fontValue = resolveTerminalFontFamilyValue(terminalFontFamily);
    document.documentElement.style.setProperty("--terminal-font-family", fontValue);
  }, [terminalFontFamily]);

  useEffect(() => {
    localStorage.setItem("autoClearLogs", String(autoClearLogs));
  }, [autoClearLogs]);

  useEffect(() => {
    localStorage.setItem("showLogsTimestamp", String(showLogsTimestamp));
  }, [showLogsTimestamp]);

  useEffect(() => {
    localStorage.setItem("showStreamName", String(showStreamName));
  }, [showStreamName]);

  useEffect(() => {
    localStorage.setItem("motionLevel", "off");
    document.documentElement.dataset.motion = "off";
    if (motionLevel !== "off") {
      setMotionLevel("off");
    }
  }, [motionLevel]);

  return {
    theme,
    setTheme,
    resolvedTheme,
    accent,
    setAccent,
    terminalFontSize,
    setTerminalFontSize,
    dateFormat,
    setDateFormat,
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
  };
}
