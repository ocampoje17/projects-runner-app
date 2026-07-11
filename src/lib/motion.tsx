import { createContext, useContext, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";

export type MotionLevel = "full" | "reduced" | "off";

const MotionLevelContext = createContext<MotionLevel>("full");

export function MotionLevelProvider({
  level,
  children,
}: {
  level: MotionLevel;
  children: ReactNode;
}) {
  return <MotionLevelContext.Provider value={level}>{children}</MotionLevelContext.Provider>;
}

export function useMotionLevel() {
  return useContext(MotionLevelContext);
}

export function useMotionPreferences() {
  const level = useMotionLevel();
  const systemReducedMotion = useReducedMotion() ?? false;
  const allowRichMotion = level === "full" && !systemReducedMotion;
  const allowBasicMotion = level !== "off";

  return {
    level,
    systemReducedMotion,
    allowRichMotion,
    allowBasicMotion,
  };
}
