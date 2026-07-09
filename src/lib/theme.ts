export type AccentColor = "indigo" | "emerald" | "rose" | "amber" | "sky";

export const ACCENT_THEMES: Record<AccentColor, { primary: string; gradient: string; glow: string }> = {
  indigo: {
    primary: "#6366f1",
    gradient: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    glow: "rgba(99, 102, 241, 0.15)",
  },
  emerald: {
    primary: "#10b981",
    gradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    glow: "rgba(16, 185, 129, 0.15)",
  },
  rose: {
    primary: "#f43f5e",
    gradient: "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)",
    glow: "rgba(244, 63, 94, 0.15)",
  },
  amber: {
    primary: "#f59e0b",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    glow: "rgba(245, 158, 11, 0.15)",
  },
  sky: {
    primary: "#0ea5e9",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
    glow: "rgba(14, 165, 233, 0.15)",
  },
};
