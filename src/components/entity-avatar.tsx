import * as LucideIcons from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Apple,
  Boxes,
  Braces,
  Code2,
  Cpu,
  Database,
  FolderOpen,
  Globe,
  Laptop,
  LucideIcon,
  Monitor,
  Package,
  Play,
  Rocket,
  Server,
  Settings,
  Smartphone,
  Terminal,
  Wrench,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { cn } from "@/lib/utils";

const LUCIDE_ICON_PREFIX = "lucide:";

export type IconOption = { id: string; label: string; Icon: LucideIcon };

export const iconOptions: IconOption[] = [
  { id: "terminal", label: "Terminal", Icon: Terminal },
  { id: "folder", label: "Folder", Icon: FolderOpen },
  { id: "code", label: "Code", Icon: Code2 },
  { id: "braces", label: "Braces", Icon: Braces },
  { id: "database", label: "Database", Icon: Database },
  { id: "server", label: "Server", Icon: Server },
  { id: "globe", label: "Globe", Icon: Globe },
  { id: "package", label: "Package", Icon: Package },
  { id: "boxes", label: "Boxes", Icon: Boxes },
  { id: "cpu", label: "CPU", Icon: Cpu },
  { id: "wrench", label: "Wrench", Icon: Wrench },
  { id: "settings", label: "Settings", Icon: Settings },
  { id: "rocket", label: "Rocket", Icon: Rocket },
  { id: "play", label: "Play", Icon: Play },
  { id: "ios", label: "iOS", Icon: Smartphone },
  { id: "windows", label: "Windows", Icon: Monitor },
  { id: "linux", label: "Linux", Icon: Terminal },
  { id: "android", label: "Android", Icon: Smartphone },
  { id: "macos", label: "macOS", Icon: Apple },
  { id: "desktop", label: "Desktop", Icon: Laptop },
];

const EXCLUDED_LUCIDE_EXPORTS = new Set([
  "Icon",
  "IconNode",
  "LucideIcon",
  "createLucideIcon",
  "icons",
]);

function isLucideComponent(name: string, value: unknown): value is LucideIcon {
  if (EXCLUDED_LUCIDE_EXPORTS.has(name) || !/^[A-Z]/.test(name)) {
    return false;
  }

  return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
}

function humanizeIconName(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

function canonicalLucideIconName(value: string) {
  return value.replace(/^Lucide/, "").replace(/Icon$/, "").trim();
}

function lucideExportPriority(value: string) {
  const hasPrefix = value.startsWith("Lucide");
  const hasSuffix = value.endsWith("Icon");

  if (!hasPrefix && !hasSuffix) {
    return 0;
  }
  if (!hasPrefix && hasSuffix) {
    return 1;
  }
  if (hasPrefix && !hasSuffix) {
    return 2;
  }
  return 3;
}

const lucideAliasesByCanonicalId = new Map<string, string[]>();
const lucideOptionByCanonicalId = new Map<string, IconOption>();
const lucidePreferredExportNameByCanonicalId = new Map<string, string>();

for (const [name, Icon] of Object.entries(LucideIcons)) {
  if (!isLucideComponent(name, Icon)) {
    continue;
  }

  const canonicalId = canonicalLucideIconName(name);
  const aliases = lucideAliasesByCanonicalId.get(canonicalId) ?? [];
  aliases.push(name);
  lucideAliasesByCanonicalId.set(canonicalId, aliases);

  const nextOption: IconOption = {
    id: canonicalId,
    label: humanizeIconName(canonicalId),
    Icon: Icon as unknown as LucideIcon,
  };
  const currentOption = lucideOptionByCanonicalId.get(canonicalId);

  if (!currentOption) {
    lucideOptionByCanonicalId.set(canonicalId, nextOption);
    lucidePreferredExportNameByCanonicalId.set(canonicalId, name);
    continue;
  }

  const currentPriority = lucideExportPriority(lucidePreferredExportNameByCanonicalId.get(canonicalId) ?? canonicalId);
  const nextPriority = lucideExportPriority(name);
  if (nextPriority < currentPriority) {
    lucideOptionByCanonicalId.set(canonicalId, nextOption);
    lucidePreferredExportNameByCanonicalId.set(canonicalId, name);
  }
}

export const allLucideIconOptions: IconOption[] = Array.from(lucideOptionByCanonicalId.values()).sort((left, right) =>
  left.label.localeCompare(right.label),
);

const lucideIconOptionsById = new Map<string, IconOption>();

for (const option of allLucideIconOptions) {
  lucideIconOptionsById.set(option.id, option);
  lucideIconOptionsById.set(option.id.toLowerCase(), option);
}

for (const [canonicalId, aliases] of lucideAliasesByCanonicalId.entries()) {
  const option = lucideOptionByCanonicalId.get(canonicalId);
  if (!option) {
    continue;
  }

  for (const alias of aliases) {
    lucideIconOptionsById.set(alias, option);
    lucideIconOptionsById.set(alias.toLowerCase(), option);
  }
}

for (const option of iconOptions) {
  lucideIconOptionsById.set(option.id, option);
  lucideIconOptionsById.set(option.id.toLowerCase(), option);
}

export function lucideIconValue(id: string) {
  return `${LUCIDE_ICON_PREFIX}${id}`;
}

export function lucideIconId(value: string | null | undefined) {
  return value?.startsWith(LUCIDE_ICON_PREFIX) ? value.slice(LUCIDE_ICON_PREFIX.length) : null;
}

export function getLucideIconOption(id: string | null | undefined) {
  if (!id) {
    return undefined;
  }
  const cleanId = lucideIconId(id) ?? id;
  return lucideIconOptionsById.get(cleanId) ?? lucideIconOptionsById.get(cleanId.toLowerCase());
}

export const RECENT_ICONS_STORAGE_KEY = "projects-runner:recent-icons";
export const SUGGESTED_ICONS_COUNT = 20;

export function getRecentIconIds(): string[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(RECENT_ICONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  } catch {
    // Ignore corrupted localStorage data
  }
  return [];
}

export function saveRecentIconId(iconId: string): string[] {
  const normalizedId = lucideIconId(iconId) ?? iconId.trim();
  if (!normalizedId) {
    return getRecentIconIds();
  }

  const current = getRecentIconIds();
  const filtered = current.filter((id) => id.toLowerCase() !== normalizedId.toLowerCase());
  const updated = [normalizedId, ...filtered].slice(0, SUGGESTED_ICONS_COUNT);

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(RECENT_ICONS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore quota errors
    }
  }

  return updated;
}

export function buildSuggestedIconOptions(
  recentIds: string[] = getRecentIconIds(),
  limit: number = SUGGESTED_ICONS_COUNT,
): IconOption[] {
  const result: IconOption[] = [];
  const seenIds = new Set<string>();

  // 1. Add recent icons first (most recent first)
  for (const id of recentIds) {
    const option = getLucideIconOption(id);
    if (option && !seenIds.has(option.id)) {
      seenIds.add(option.id);
      result.push(option);
      if (result.length >= limit) {
        return result;
      }
    }
  }

  // 2. Fill remaining slots with default iconOptions
  for (const option of iconOptions) {
    if (!seenIds.has(option.id)) {
      seenIds.add(option.id);
      result.push(option);
      if (result.length >= limit) {
        return result;
      }
    }
  }

  // 3. If still below limit, fill from allLucideIconOptions
  for (const option of allLucideIconOptions) {
    if (!seenIds.has(option.id)) {
      seenIds.add(option.id);
      result.push(option);
      if (result.length >= limit) {
        return result;
      }
    }
  }

  return result;
}

function lucideIconOption(value: string | null | undefined) {
  return getLucideIconOption(lucideIconId(value));
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function avatarSrc(path: string | null | undefined) {
  if (!path || lucideIconId(path)) {
    return undefined;
  }

  return convertFileSrc(path);
}

export function EntityAvatar({
  name,
  path,
  className,
  fallbackClassName,
  iconSize = 20,
}: {
  name: string;
  path?: string | null;
  className?: string;
  fallbackClassName?: string;
  iconSize?: number;
}) {
  const iconOption = lucideIconOption(path);
  const Icon = iconOption?.Icon;

  return (
    <Avatar className={className}>
      <AvatarImage src={avatarSrc(path)} alt="" />
      <AvatarFallback className={cn(fallbackClassName)}>
        {Icon ? <Icon size={iconSize} /> : initials(name) || "PR"}
      </AvatarFallback>
    </Avatar>
  );
}
