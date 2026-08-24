import React from "react";
import { Blocks } from "lucide-react";

const DEVICON_MAP: Record<string, string> = {
  // JavaScript & Web
  node: "devicon-nodejs-plain colored",
  bun: "devicon-bun-plain",
  deno: "devicon-denojs-original",
  vite: "devicon-vitejs-plain colored",
  webpack: "devicon-webpack-plain colored",
  parcel: "devicon-parcel-plain",
  react: "devicon-react-original colored",
  nextjs: "devicon-nextjs-plain",
  remix: "devicon-react-original colored",
  gatsby: "devicon-gatsby-plain colored",
  vue: "devicon-vuejs-plain colored",
  nuxt: "devicon-nuxtjs-plain colored",
  angular: "devicon-angularjs-plain colored",
  svelte: "devicon-svelte-plain colored",
  sveltekit: "devicon-svelte-plain colored",
  astro: "devicon-astro-plain colored",
  solidstart: "devicon-solidjs-plain colored",
  qwik: "devicon-qwik-plain colored",
  ember: "devicon-ember-original-wordmark colored",
  nestjs: "devicon-nestjs-original colored",
  express: "devicon-express-original",
  fastify: "devicon-fastify-plain colored",
  adonisjs: "devicon-adonisjs-original colored",

  // Workspace, Desktop & Mobile
  turborepo: "devicon-turborepo-plain colored",
  nx: "devicon-nx-plain colored",
  lerna: "devicon-lerna-plain colored",
  "js-workspace": "devicon-pnpm-plain colored",
  tauri: "devicon-tauri-plain colored",
  electron: "devicon-electron-original colored",
  wails: "devicon-go-plain colored",
  "react-native": "devicon-react-original colored",
  expo: "devicon-expo-plain",
  "ionic-capacitor": "devicon-ionic-original colored",
  cordova: "devicon-cordova-plain colored",
  nativescript: "devicon-nativescript-plain colored",
  flutter: "devicon-flutter-plain colored",
  "android-gradle": "devicon-android-plain colored",
  "ios-xcode": "devicon-xcode-plain colored",

  // Microsoft & JVM
  dotnet: "devicon-dot-net-plain colored",
  aspnet: "devicon-dot-net-plain colored",
  blazor: "devicon-blazor-original colored",
  winui3: "devicon-windows8-original colored",
  wpf: "devicon-dot-net-plain colored",
  winforms: "devicon-windows8-original colored",
  maui: "devicon-dot-net-plain colored",
  avalonia: "devicon-dot-net-plain colored",
  uno: "devicon-dot-net-plain colored",
  maven: "devicon-maven-plain colored",
  gradle: "devicon-gradle-original",
  java: "devicon-java-plain colored",
  kotlin: "devicon-kotlin-plain colored",
  "spring-boot": "devicon-spring-plain colored",

  // Native & Backend
  rust: "devicon-rust-plain colored",
  go: "devicon-go-original-wordmark colored",
  python: "devicon-python-plain colored",
  uv: "devicon-python-plain colored",
  poetry: "devicon-poetry-plain colored",
  django: "devicon-django-plain colored",
  flask: "devicon-flask-original colored",
  fastapi: "devicon-fastapi-plain colored",
  "php-composer": "devicon-composer-line colored",
  laravel: "devicon-laravel-original colored",
  symfony: "devicon-symfony-original",
  ruby: "devicon-ruby-plain colored",
  rails: "devicon-rails-plain colored",
  elixir: "devicon-elixir-plain colored",
  phoenix: "devicon-phoenix-original colored",
  dart: "devicon-dart-plain colored",
  swiftpm: "devicon-swift-plain colored",
  cmake: "devicon-cmake-plain colored",
  meson: "devicon-cplusplus-plain colored",
  bazel: "devicon-bazel-plain colored",
  make: "devicon-c-plain colored",
  qt: "devicon-qt-original colored",
  zig: "devicon-zig-original colored",

  // Game & Infrastructure
  unity: "devicon-unity-original",
  unreal: "devicon-unrealengine-original",
  godot: "devicon-godot-plain colored",
  docker: "devicon-docker-plain colored",
  terraform: "devicon-terraform-plain colored",
  pulumi: "devicon-pulumi-plain colored",
  serverless: "devicon-serverless-plain colored",
};

export function getDevIconClass(typeId: string): string | null {
  if (!typeId) return null;
  const key = typeId.trim().toLowerCase();
  return DEVICON_MAP[key] ?? null;
}

export function DevIcon({
  typeId,
  className = "text-[14px]",
  fallback,
  style,
}: {
  typeId?: string | null;
  className?: string;
  fallback?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  if (!typeId) {
    return fallback ? <>{fallback}</> : <Blocks size={14} className="text-muted-foreground" style={style} />;
  }

  const iconClass = getDevIconClass(typeId);
  if (!iconClass) {
    return fallback ? <>{fallback}</> : <Blocks size={14} className="text-muted-foreground" style={style} />;
  }

  return <i className={`${iconClass} ${className} inline-flex items-center justify-center`} style={style} aria-hidden="true" />;
}

export type DevIconOption = {
  id: string;
  label: string;
  category: string;
};

export const DEV_ICON_OPTIONS: DevIconOption[] = [
  // JavaScript & Web
  { id: "node", label: "Node.js", category: "JavaScript & Web" },
  { id: "bun", label: "Bun", category: "JavaScript & Web" },
  { id: "deno", label: "Deno", category: "JavaScript & Web" },
  { id: "vite", label: "Vite", category: "JavaScript & Web" },
  { id: "webpack", label: "Webpack", category: "JavaScript & Web" },
  { id: "parcel", label: "Parcel", category: "JavaScript & Web" },
  { id: "react", label: "React", category: "JavaScript & Web" },
  { id: "nextjs", label: "Next.js", category: "JavaScript & Web" },
  { id: "remix", label: "Remix", category: "JavaScript & Web" },
  { id: "gatsby", label: "Gatsby", category: "JavaScript & Web" },
  { id: "vue", label: "Vue.js", category: "JavaScript & Web" },
  { id: "nuxt", label: "Nuxt", category: "JavaScript & Web" },
  { id: "angular", label: "Angular", category: "JavaScript & Web" },
  { id: "svelte", label: "Svelte", category: "JavaScript & Web" },
  { id: "sveltekit", label: "SvelteKit", category: "JavaScript & Web" },
  { id: "astro", label: "Astro", category: "JavaScript & Web" },
  { id: "solidstart", label: "SolidStart", category: "JavaScript & Web" },
  { id: "qwik", label: "Qwik", category: "JavaScript & Web" },
  { id: "ember", label: "Ember.js", category: "JavaScript & Web" },
  { id: "nestjs", label: "NestJS", category: "JavaScript & Web" },
  { id: "express", label: "Express", category: "JavaScript & Web" },
  { id: "fastify", label: "Fastify", category: "JavaScript & Web" },
  { id: "adonisjs", label: "AdonisJS", category: "JavaScript & Web" },

  // Workspace, Desktop & Mobile
  { id: "turborepo", label: "Turborepo", category: "Workspace & Mobile" },
  { id: "nx", label: "Nx", category: "Workspace & Mobile" },
  { id: "lerna", label: "Lerna", category: "Workspace & Mobile" },
  { id: "js-workspace", label: "JS / pnpm Workspace", category: "Workspace & Mobile" },
  { id: "tauri", label: "Tauri", category: "Workspace & Mobile" },
  { id: "electron", label: "Electron", category: "Workspace & Mobile" },
  { id: "wails", label: "Wails", category: "Workspace & Mobile" },
  { id: "react-native", label: "React Native", category: "Workspace & Mobile" },
  { id: "expo", label: "Expo", category: "Workspace & Mobile" },
  { id: "ionic-capacitor", label: "Capacitor / Ionic", category: "Workspace & Mobile" },
  { id: "cordova", label: "Cordova", category: "Workspace & Mobile" },
  { id: "nativescript", label: "NativeScript", category: "Workspace & Mobile" },
  { id: "flutter", label: "Flutter", category: "Workspace & Mobile" },
  { id: "android-gradle", label: "Android (Gradle)", category: "Workspace & Mobile" },
  { id: "ios-xcode", label: "iOS (Xcode)", category: "Workspace & Mobile" },

  // Microsoft & JVM
  { id: "dotnet", label: ".NET", category: "Microsoft & JVM" },
  { id: "aspnet", label: "ASP.NET Core", category: "Microsoft & JVM" },
  { id: "blazor", label: "Blazor", category: "Microsoft & JVM" },
  { id: "winui3", label: "WinUI 3 / Windows App SDK", category: "Microsoft & JVM" },
  { id: "wpf", label: "WPF", category: "Microsoft & JVM" },
  { id: "winforms", label: "Windows Forms", category: "Microsoft & JVM" },
  { id: "maui", label: ".NET MAUI", category: "Microsoft & JVM" },
  { id: "avalonia", label: "Avalonia UI", category: "Microsoft & JVM" },
  { id: "uno", label: "Uno Platform", category: "Microsoft & JVM" },
  { id: "maven", label: "Java (Maven)", category: "Microsoft & JVM" },
  { id: "gradle", label: "Java / Kotlin (Gradle)", category: "Microsoft & JVM" },
  { id: "java", label: "Java", category: "Microsoft & JVM" },
  { id: "kotlin", label: "Kotlin", category: "Microsoft & JVM" },
  { id: "spring-boot", label: "Spring Boot", category: "Microsoft & JVM" },

  // Native & Backend
  { id: "rust", label: "Rust (Cargo)", category: "Native & Backend" },
  { id: "go", label: "Go", category: "Native & Backend" },
  { id: "python", label: "Python", category: "Native & Backend" },
  { id: "uv", label: "Python (uv)", category: "Native & Backend" },
  { id: "poetry", label: "Python (Poetry)", category: "Native & Backend" },
  { id: "django", label: "Django", category: "Native & Backend" },
  { id: "flask", label: "Flask", category: "Native & Backend" },
  { id: "fastapi", label: "FastAPI", category: "Native & Backend" },
  { id: "php-composer", label: "PHP (Composer)", category: "Native & Backend" },
  { id: "laravel", label: "Laravel", category: "Native & Backend" },
  { id: "symfony", label: "Symfony", category: "Native & Backend" },
  { id: "ruby", label: "Ruby", category: "Native & Backend" },
  { id: "rails", label: "Ruby on Rails", category: "Native & Backend" },
  { id: "elixir", label: "Elixir (Mix)", category: "Native & Backend" },
  { id: "phoenix", label: "Phoenix", category: "Native & Backend" },
  { id: "dart", label: "Dart", category: "Native & Backend" },
  { id: "swiftpm", label: "Swift (SwiftPM)", category: "Native & Backend" },
  { id: "cmake", label: "C/C++ (CMake)", category: "Native & Backend" },
  { id: "meson", label: "C/C++ (Meson)", category: "Native & Backend" },
  { id: "bazel", label: "Bazel", category: "Native & Backend" },
  { id: "make", label: "Makefile", category: "Native & Backend" },
  { id: "qt", label: "Qt", category: "Native & Backend" },
  { id: "zig", label: "Zig", category: "Native & Backend" },

  // Game & Infrastructure
  { id: "unity", label: "Unity", category: "Game & DevOps" },
  { id: "unreal", label: "Unreal Engine", category: "Game & DevOps" },
  { id: "godot", label: "Godot", category: "Game & DevOps" },
  { id: "docker", label: "Docker / Compose", category: "Game & DevOps" },
  { id: "terraform", label: "Terraform", category: "Game & DevOps" },
  { id: "pulumi", label: "Pulumi", category: "Game & DevOps" },
  { id: "serverless", label: "Serverless Framework", category: "Game & DevOps" },
];

export function getDevIconOption(id: string | null | undefined): DevIconOption | undefined {
  if (!id) return undefined;
  const cleanId = id.startsWith("devicon:") ? id.slice("devicon:".length) : id;
  return DEV_ICON_OPTIONS.find((opt) => opt.id === cleanId.toLowerCase());
}

const RECENT_PROJECT_DEVICONS_STORAGE_KEY = "projects-runner:recent-project-devicons";
const DEFAULT_SUGGESTED_DEVICONS = [
  "node", "react", "rust", "tauri", "nextjs", "vue", "go", "python",
  "dotnet", "flutter", "docker", "angular", "svelte", "electron", "fastapi", "spring-boot"
];

export function getRecentProjectDeviconIds(): string[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_SUGGESTED_DEVICONS;
  }
  try {
    const raw = window.localStorage.getItem(RECENT_PROJECT_DEVICONS_STORAGE_KEY);
    if (!raw) return DEFAULT_SUGGESTED_DEVICONS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return [...new Set([...parsed, ...DEFAULT_SUGGESTED_DEVICONS])];
    }
  } catch {
    // fallback
  }
  return DEFAULT_SUGGESTED_DEVICONS;
}

export function saveRecentProjectDeviconId(id: string) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getRecentProjectDeviconIds().filter((item) => item !== id);
    const updated = [id, ...current].slice(0, 30);
    window.localStorage.setItem(RECENT_PROJECT_DEVICONS_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}
