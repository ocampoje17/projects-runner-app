export type AccentColor = "mono" | "blue";

export type AccentTheme = {
  primary: string;
  primaryForeground: string;
  gradient: string;
  glow: string;
  ring: string;
};

export const ACCENT_THEMES: Record<AccentColor, AccentTheme> = {
  mono: {
    primary: "oklch(15% 0 0)",
    primaryForeground: "oklch(99% 0 0)",
    gradient: "linear-gradient(180deg, oklch(22% 0 0) 0%, oklch(15% 0 0) 100%)",
    glow: "oklch(15% 0 0 / 0.12)",
    ring: "oklch(15% 0 0 / 0.18)",
  },
  blue: {
    primary: "oklch(55% 0.18 255)",
    primaryForeground: "oklch(99% 0 0)",
    gradient: "linear-gradient(180deg, oklch(60% 0.18 255) 0%, oklch(50% 0.16 255) 100%)",
    glow: "oklch(55% 0.18 255 / 0.18)",
    ring: "oklch(55% 0.18 255 / 0.45)",
  },
};

export const DARK_ACCENT_OVERRIDES: Partial<Record<AccentColor, Partial<AccentTheme>>> = {
  mono: {
    primary: "oklch(96% 0 0)",
    primaryForeground: "#151515",
    gradient: "linear-gradient(180deg, oklch(98% 0 0) 0%, oklch(92% 0 0) 100%)",
    glow: "oklch(96% 0 0 / 0.14)",
    ring: "oklch(96% 0 0 / 0.28)",
  },
  blue: {
    primary: "oklch(70% 0.15 255)",
    primaryForeground: "oklch(15% 0 0)",
    glow: "oklch(70% 0.15 255 / 0.22)",
    ring: "oklch(70% 0.15 255 / 0.5)",
  },
};

export function resolveAccentTheme(accent: AccentColor, mode: "light" | "dark"): AccentTheme {
  const base = ACCENT_THEMES[accent] ?? ACCENT_THEMES.mono;
  if (mode === "dark") {
    return { ...base, ...(DARK_ACCENT_OVERRIDES[accent] ?? {}) };
  }
  return base;
}
