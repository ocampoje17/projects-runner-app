import type { TwofaAccountSummary, SortOrderSetting } from "@/lib/api";

// Utility functions for 2FA UI

export function formatTotpCode(code: string): string {
  const digits = code.replace(/\s+/g, "");
  if (digits.length === 6) {
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  }
  if (digits.length === 8) {
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  }
  return digits;
}

export function parseOtpauthUri(uri: string): {
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
} | null {
  try {
    const trimmed = uri.trim();
    if (!trimmed.toLowerCase().startsWith("otpauth://")) return null;
    const url = new URL(trimmed);
    const label = decodeURIComponent(url.pathname.replace(/^\/\/?/, ""));
    let issuer = url.searchParams.get("issuer") || "";
    let accountName = label;
    if (label.includes(":")) {
      const parts = label.split(":");
      issuer = issuer || parts[0].trim();
      accountName = parts.slice(1).join(":").trim();
    }
    const secret = url.searchParams.get("secret")?.replace(/\s+/g, "").toUpperCase() || "";
    const rawAlgo = (url.searchParams.get("algorithm") || "SHA1").toUpperCase();
    const algorithm = (rawAlgo === "SHA256" ? "SHA256" : rawAlgo === "SHA512" ? "SHA512" : "SHA1") as "SHA1" | "SHA256" | "SHA512";
    const digits = Number.parseInt(url.searchParams.get("digits") || "6", 10) === 8 ? 8 : 6;
    const period = Number.parseInt(url.searchParams.get("period") || "30", 10) || 30;

    return {
      issuer,
      accountName,
      secret,
      algorithm,
      digits,
      period,
    };
  } catch {
    return null;
  }
}

// Generate consistent background color and initials for issuer
export function getIssuerVisual(issuer: string, accountName?: string): {
  initials: string;
  bgColor: string;
  textColor: string;
} {
  const name = (issuer || accountName || "2FA").trim();
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "2F";

  const lower = name.toLowerCase();

  // Known brand palette highlights
  if (lower.includes("github")) {
    return { initials, bgColor: "#24292e", textColor: "#ffffff" };
  }
  if (lower.includes("google")) {
    return { initials, bgColor: "#4285f4", textColor: "#ffffff" };
  }
  if (lower.includes("aws") || lower.includes("amazon")) {
    return { initials, bgColor: "#ff9900", textColor: "#232f3e" };
  }
  if (lower.includes("discord")) {
    return { initials, bgColor: "#5865f2", textColor: "#ffffff" };
  }
  if (lower.includes("gitlab")) {
    return { initials, bgColor: "#fc6d26", textColor: "#ffffff" };
  }
  if (lower.includes("microsoft") || lower.includes("azure")) {
    return { initials, bgColor: "#00a4ef", textColor: "#ffffff" };
  }
  if (lower.includes("cloudflare")) {
    return { initials, bgColor: "#f38020", textColor: "#ffffff" };
  }
  if (lower.includes("slack")) {
    return { initials, bgColor: "#4a154b", textColor: "#ffffff" };
  }
  if (lower.includes("docker")) {
    return { initials, bgColor: "#0db7ed", textColor: "#ffffff" };
  }
  if (lower.includes("apple")) {
    return { initials, bgColor: "#555555", textColor: "#ffffff" };
  }

  // Deterministic HSL color for other issuers
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return {
    initials,
    bgColor: `hsl(${hue}, 55%, 38%)`,
    textColor: "#ffffff",
  };
}

let clipboardClearTimeout: ReturnType<typeof setTimeout> | null = null;

export async function copyToClipboardWithAutoClear(
  text: string,
  timeoutSecs: number = 30,
): Promise<void> {
  await navigator.clipboard.writeText(text);

  if (clipboardClearTimeout) {
    clearTimeout(clipboardClearTimeout);
    clipboardClearTimeout = null;
  }

  if (timeoutSecs > 0) {
    clipboardClearTimeout = setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === text) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // Ignore clipboard permission errors on clear
      }
    }, timeoutSecs * 1000);
  }
}

export function sortTwofaAccounts(accounts: TwofaAccountSummary[], order: SortOrderSetting): TwofaAccountSummary[] {
  return [...accounts].sort((a, b) => {
    switch (order) {
      case "ISSUER_DESC": return (b.issuer || b.account || "").localeCompare(a.issuer || a.account || "");
      case "CREATED_DESC": return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case "CREATED_ASC": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      default: return (a.issuer || a.account || "").localeCompare(b.issuer || b.account || "");
    }
  });
}
