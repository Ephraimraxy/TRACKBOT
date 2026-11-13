"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";
import { NOTIFY_BROWSER_KEY, NOTIFY_SOUND_KEY, playChime } from "@/components/notifications/LiveNotifications";
import { REMINDER_CHOICES } from "@/lib/validations/deliveryUpdates";

const store = {
  get: (key: string) => {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  },
  set: (key: string, on: boolean) => {
    try {
      window.localStorage.setItem(key, on ? "1" : "0");
    } catch {
      // This browser will not keep the choice. It still works until the page is closed.
    }
  },
};

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (on: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="mt-1 h-5 w-5 shrink-0 accent-black" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * How this person wants to be told things, live. Reminders only matter to customers (`showReminders`); the
 * sound, the browser alert and the test button are for everyone who signs in.
 */
export default function DeliveryUpdates({ userId, showReminders = true }: { userId: string; showReminders?: boolean }) {
  const { t } = useI18n();
  const url = `/api/users/${userId}/settings/delivery-updates`;

  const [minutes, setMinutes] = useState(5);
  const [near, setNear] = useState(true);
  const [loaded, setLoaded] = useState(!showReminders);
  const [sound, setSound] = useState(false);
  const [browserAlerts, setBrowserAlerts] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setSound(store.get(NOTIFY_SOUND_KEY));
    setBrowserAlerts(store.get(NOTIFY_BROWSER_KEY));
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  useEffect(() => {
    if (!showReminders) return;
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(({ data }) => {
        if (cancelled) return;
        setMinutes(data.rappelLivraisonMinutes);
        setNear(data.alerteProche);
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [url, showReminders]);

  const save = useCallback(
    async (change: { rappelLivraisonMinutes?: number; alerteProche?: boolean }) => {
      const res = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
      if (res.ok) toast.success(t("Saved"));
      else toast.error(t("Could not save. Please try again."));
      return res.ok;
    },
    [url, t]
  );

  const chooseMinutes = async (value: number) => {
    const before = minutes;
    setMinutes(value);
    if (!(await save({ rappelLivraisonMinutes: value }))) setMinutes(before);
  };

  const toggleNear = async (on: boolean) => {
    setNear(on);
    if (!(await save({ alerteProche: on }))) setNear(!on);
  };

  const toggleSound = (on: boolean) => {
    setSound(on);
    store.set(NOTIFY_SOUND_KEY, on);
    if (on) playChime(); // so they hear what it sounds like
  };

  const toggleBrowser = async (on: boolean) => {
    if (!on) {
      setBrowserAlerts(false);
      store.set(NOTIFY_BROWSER_KEY, false);
      return;
    }
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(result);
    const allowed = result === "granted";
    setBrowserAlerts(allowed);
    store.set(NOTIFY_BROWSER_KEY, allowed);
  };

  const sendTest = async () => {
    const res = await fetch(url, { method: "POST" });
    if (res.status === 429) toast.error(t("Too many tests. Try again in a minute."));
    else if (!res.ok) toast.error(t("Could not send the test. Please try again."));
    // On success the live channel pops it up by itself, within a moment.
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold"><T>Delivery updates</T></h3>
        <p className="text-sm text-gray-500">
          <T>Choose how you are told about your delivery. Alerts appear instantly while this site is open.</T>
        </p>
      </div>

      {showReminders && (
        <section className="space-y-3">
          <div>
            <label htmlFor="reminder-interval" className="block text-sm font-medium">
              <T>While my order is out for delivery, remind me where it is every</T>
            </label>
            <select
              id="reminder-interval"
              disabled={!loaded}
              value={minutes}
              onChange={(e) => void chooseMinutes(Number(e.target.value))}
              className="mt-1 w-full max-w-xs rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {REMINDER_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? t("Never (no reminders)") : t("{n} minutes", { n: m })}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              <T>Each reminder says how far away your delivery person is and how long they will take.</T>
            </p>
          </div>
          <Switch
            checked={near}
            onChange={(on) => void toggleNear(on)}
            label={t("Tell me when my delivery is almost here")}
            hint={t("One alert when the delivery person is a few minutes or a few hundred metres away.")}
          />
        </section>
      )}

      <section className="space-y-3">
        <Switch checked={sound} onChange={toggleSound} label={t("Play a sound for new alerts")} hint={t("A short chime on this device.")} />
        <Switch
          checked={browserAlerts}
          onChange={(on) => void toggleBrowser(on)}
          label={t("Show alerts even when this tab is in the background")}
          hint={
            permission === "denied"
              ? t("Notifications are blocked for this site. Allow them in your browser's site settings, then turn this on.")
              : permission === "unsupported"
              ? t("This browser does not support notifications.")
              : t("Your browser will ask for permission. Alerts stop when the browser is closed.")
          }
        />
      </section>

      <button type="button" onClick={() => void sendTest()} className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800">
        <T>Send me a test alert</T>
      </button>
    </div>
  );
}
