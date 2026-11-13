"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/LocaleProvider";

/** Per-device choices, kept in this browser (they depend on the device, not the account). */
export const NOTIFY_BROWSER_KEY = "trackbot-notify-browser";
export const NOTIFY_SOUND_KEY = "trackbot-notify-sound";
/** Fired on `window` for each live notification, so any list on screen can refresh itself. */
export const LIVE_NOTIFICATION_EVENT = "trackbot:notification";

export interface LiveNotificationPayload {
  id: string;
  type: string;
  objet: string;
  text: string;
  date: string;
  urlRedirection: string | null;
}

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** A short, soft two-note chime made in the browser (no sound file needed). */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.32);
    });
    setTimeout(() => void ctx.close(), 900);
  } catch {
    // Audio can be blocked until the person has interacted with the page. Nothing to do.
  }
}

/**
 * Keeps one live connection open for the signed-in person (customer, delivery person or admin) and shows each
 * notification the moment it is created: a pop-up, optionally a chime, and optionally a browser notification
 * when the tab is in the background. It renders nothing itself.
 *
 * The browser reconnects by itself after a break and resumes where it left off (see the stream route).
 * Closing the browser stops these alerts: they work while the site is open in a tab.
 */
export default function LiveNotifications() {
  const { data: session } = useSession();
  const router = useRouter();
  const { t } = useI18n();
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId || typeof EventSource === "undefined") return;

    const source = new EventSource("/api/notifications/stream");
    source.addEventListener("notification", (event) => {
      let n: LiveNotificationPayload;
      try {
        n = JSON.parse((event as MessageEvent<string>).data);
      } catch {
        return;
      }

      window.dispatchEvent(new CustomEvent(LIVE_NOTIFICATION_EVENT, { detail: n }));

      // The headline is a fixed sentence we can translate; the detail line carries the numbers.
      const title = t(n.objet);
      toast(title, {
        description: n.text,
        duration: 9000,
        action: n.urlRedirection ? { label: t("View"), onClick: () => router.push(n.urlRedirection!) } : undefined,
      });

      if (read(NOTIFY_SOUND_KEY) === "1") playChime();

      if (read(NOTIFY_BROWSER_KEY) === "1" && "Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
        const shown = new Notification(title, { body: n.text, tag: n.id });
        shown.onclick = () => {
          window.focus();
          if (n.urlRedirection) router.push(n.urlRedirection);
          shown.close();
        };
      }
    });

    return () => source.close();
  }, [userId, router, t]);

  return null;
}
