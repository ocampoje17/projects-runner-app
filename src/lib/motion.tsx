import { createContext, useContext, type ReactNode } from "react";

export type MotionLevel = "full" | "reduced" | "off";

const MotionLevelContext = createContext<MotionLevel>("off");

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
  const systemReducedMotion = true;
  const allowRichMotion = false;
  const allowBasicMotion = false;

  return {
    level,
    systemReducedMotion,
    allowRichMotion,
    allowBasicMotion,
  };
}
