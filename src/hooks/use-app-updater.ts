import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isDesktopRuntime, type AppUpdateInfo } from "../lib/api";

const INITIAL_DELAY_MS = 60_000;
const CHECK_INTERVAL_MS = 5 * 60 * 60 * 1_000;
const RETRY_DELAYS_MS = [20_000, 60_000];
const DISMISSED_VERSION_KEY = "projects-runner.dismissed-update-version";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";
export type ManualUpdateCheckResult = "available" | "up-to-date" | "error";

type DownloadProgress = {
  downloadedBytes: number;
  totalBytes: number;
};

type DownloadEvent =
  | { event: "started"; totalBytes: number }
  | { event: "progress"; downloadedBytes: number; totalBytes: number }
  | { event: "finished"; path: string }
  | { event: "failed"; message: string };

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useAppUpdater() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef<Promise<ManualUpdateCheckResult> | null>(null);
  const updateRef = useRef<AppUpdateInfo | null>(null);

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  const checkNow = useCallback(async (manual: boolean): Promise<ManualUpdateCheckResult> => {
    if (!isDesktopRuntime()) {
      return "up-to-date";
    }
    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    const task = (async () => {
      setStatus("checking");
      setError(null);
      try {
        const result = await api.checkForUpdate();
        if (!result.update) {
          setUpdate(null);
          setStatus("idle");
          return "up-to-date" as const;
        }

        setUpdate(result.update);
        setStatus("available");
        const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
        if (manual || dismissed !== result.update.version) {
          setDialogOpen(true);
        }
        return "available" as const;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setStatus(updateRef.current ? "available" : "error");
        return "error" as const;
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = task;
    return task;
  }, []);

  const checkManually = useCallback(() => checkNow(true), [checkNow]);

  const dismiss = useCallback(() => {
    if (update) {
      localStorage.setItem(DISMISSED_VERSION_KEY, update.version);
    }
    setDialogOpen(false);
  }, [update]);

  const download = useCallback(async () => {
    setStatus("downloading");
    setError(null);
    setProgress(null);
    try {
      await api.downloadUpdate();
      setStatus("downloaded");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("available");
    }
  }, []);

  const installOrReveal = useCallback(async () => {
    if (!update) {
      return;
    }
    setStatus("installing");
    setError(null);
    try {
      if (update.installAction === "install") {
        await api.installDownloadedUpdate();
      } else {
        await api.revealDownloadedUpdate();
        setStatus("downloaded");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("downloaded");
    }
  }, [update]);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }
    let active = true;
    let scheduleId: number | undefined;

    const runAutomaticCheck = async () => {
      let result: ManualUpdateCheckResult = "error";
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        result = await checkNow(false);
        if (result !== "error" || !active) {
          break;
        }
        await sleep(RETRY_DELAYS_MS[attempt] ?? 0);
      }
      if (active) {
        scheduleId = window.setTimeout(runAutomaticCheck, CHECK_INTERVAL_MS);
      }
    };

    scheduleId = window.setTimeout(runAutomaticCheck, INITIAL_DELAY_MS);
    return () => {
      active = false;
      if (scheduleId) {
        window.clearTimeout(scheduleId);
      }
    };
  }, [checkNow]);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }
    let unlisten: (() => void) | undefined;
    void listen<DownloadEvent>("update://download-progress", ({ payload }) => {
      if (payload.event === "started") {
        setProgress({ downloadedBytes: 0, totalBytes: payload.totalBytes });
      } else if (payload.event === "progress") {
        setProgress({ downloadedBytes: payload.downloadedBytes, totalBytes: payload.totalBytes });
      } else if (payload.event === "finished") {
        setStatus("downloaded");
      } else if (payload.event === "failed") {
        setError(payload.message);
        setStatus("available");
      }
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, []);

  return {
    status,
    update,
    dialogOpen,
    setDialogOpen,
    progress,
    error,
    checkManually,
    dismiss,
    download,
    installOrReveal,
  };
}
