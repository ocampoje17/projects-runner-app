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
}

for (const [canonicalId, aliases] of lucideAliasesByCanonicalId.entries()) {
  const option = lucideOptionByCanonicalId.get(canonicalId);
  if (!option) {
    continue;
  }

  for (const alias of aliases) {
    lucideIconOptionsById.set(alias, option);
  }
}

for (const option of iconOptions) {
  lucideIconOptionsById.set(option.id, option);
}

export function lucideIconValue(id: string) {
  return `${LUCIDE_ICON_PREFIX}${id}`;
}

export function lucideIconId(value: string | null | undefined) {
  return value?.startsWith(LUCIDE_ICON_PREFIX) ? value.slice(LUCIDE_ICON_PREFIX.length) : null;
}

export function getLucideIconOption(id: string | null | undefined) {
  return id ? lucideIconOptionsById.get(id) : undefined;
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
