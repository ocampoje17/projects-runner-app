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

const LUCIDE_ICON_PREFIX = "lucide:";

export const iconOptions: Array<{ id: string; label: string; Icon: LucideIcon }> = [
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

export function lucideIconValue(id: string) {
  return `${LUCIDE_ICON_PREFIX}${id}`;
}

export function lucideIconId(value: string | null | undefined) {
  return value?.startsWith(LUCIDE_ICON_PREFIX) ? value.slice(LUCIDE_ICON_PREFIX.length) : null;
}

function lucideIconOption(value: string | null | undefined) {
  const id = lucideIconId(value);
  return iconOptions.find((option) => option.id === id);
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

export function EntityAvatar({ name, path }: { name: string; path?: string | null }) {
  const iconOption = lucideIconOption(path);
  const Icon = iconOption?.Icon;

  return (
    <Avatar>
      <AvatarImage src={avatarSrc(path)} alt="" />
      <AvatarFallback>{Icon ? <Icon size={20} /> : initials(name) || "PR"}</AvatarFallback>
    </Avatar>
  );
}
