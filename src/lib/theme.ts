export type AccentColor = "mono" | "violet" | "blue" | "emerald" | "rose" | "amber" | "sky";

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
  violet: {
    primary: "oklch(55% 0.2 290)",
    primaryForeground: "oklch(99% 0 0)",
    gradient: "linear-gradient(180deg, oklch(60% 0.2 290) 0%, oklch(50% 0.18 290) 100%)",
    glow: "oklch(55% 0.2 290 / 0.18)",
    ring: "oklch(55% 0.2 290 / 0.45)",
  },
  blue: {
    primary: "oklch(55% 0.18 255)",
    primaryForeground: "oklch(99% 0 0)",
    gradient: "linear-gradient(180deg, oklch(60% 0.18 255) 0%, oklch(50% 0.16 255) 100%)",
    glow: "oklch(55% 0.18 255 / 0.18)",
    ring: "oklch(55% 0.18 255 / 0.45)",
  },
  emerald: {
    primary: "oklch(56% 0.14 150)",
    primaryForeground: "oklch(99% 0 0)",
    gradient: "linear-gradient(180deg, oklch(62% 0.14 150) 0%, oklch(50% 0.12 150) 100%)",
    glow: "oklch(56% 0.14 150 / 0.18)",
    ring: "oklch(56% 0.14 150 / 0.45)",
  },
  rose: {
    primary: "oklch(58% 0.2 12)",
    primaryForeground: "oklch(99% 0 0)",
    gradient: "linear-gradient(180deg, oklch(62% 0.2 12) 0%, oklch(52% 0.18 12) 100%)",
    glow: "oklch(58% 0.2 12 / 0.18)",
    ring: "oklch(58% 0.2 12 / 0.45)",
  },
  amber: {
    primary: "oklch(74% 0.15 70)",
    primaryForeground: "oklch(20% 0.02 70)",
    gradient: "linear-gradient(180deg, oklch(78% 0.15 70) 0%, oklch(70% 0.14 70) 100%)",
    glow: "oklch(74% 0.15 70 / 0.2)",
    ring: "oklch(74% 0.15 70 / 0.45)",
  },
  sky: {
    primary: "oklch(62% 0.14 230)",
    primaryForeground: "oklch(99% 0 0)",
    gradient: "linear-gradient(180deg, oklch(66% 0.14 230) 0%, oklch(56% 0.13 230) 100%)",
    glow: "oklch(62% 0.14 230 / 0.18)",
    ring: "oklch(62% 0.14 230 / 0.45)",
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
  violet: {
    primary: "oklch(72% 0.16 290)",
    primaryForeground: "oklch(15% 0 0)",
    glow: "oklch(72% 0.16 290 / 0.22)",
    ring: "oklch(72% 0.16 290 / 0.5)",
  },
  blue: {
    primary: "oklch(70% 0.15 255)",
    primaryForeground: "oklch(15% 0 0)",
    glow: "oklch(70% 0.15 255 / 0.22)",
    ring: "oklch(70% 0.15 255 / 0.5)",
  },
  emerald: {
    primary: "oklch(72% 0.15 150)",
    primaryForeground: "oklch(15% 0 0)",
    glow: "oklch(72% 0.15 150 / 0.22)",
    ring: "oklch(72% 0.15 150 / 0.5)",
  },
  rose: {
    primary: "oklch(70% 0.17 12)",
    primaryForeground: "oklch(15% 0 0)",
    glow: "oklch(70% 0.17 12 / 0.22)",
    ring: "oklch(70% 0.17 12 / 0.5)",
  },
  amber: {
    primary: "oklch(80% 0.15 75)",
    primaryForeground: "oklch(18% 0.02 75)",
    glow: "oklch(80% 0.15 75 / 0.22)",
    ring: "oklch(80% 0.15 75 / 0.5)",
  },
  sky: {
    primary: "oklch(74% 0.12 230)",
    primaryForeground: "oklch(15% 0 0)",
    glow: "oklch(74% 0.12 230 / 0.22)",
    ring: "oklch(74% 0.12 230 / 0.5)",
  },
};

export function resolveAccentTheme(accent: AccentColor, mode: "light" | "dark"): AccentTheme {
  const base = ACCENT_THEMES[accent] ?? ACCENT_THEMES.mono;
  if (mode === "dark") {
    return { ...base, ...(DARK_ACCENT_OVERRIDES[accent] ?? {}) };
  }
  return base;
}
