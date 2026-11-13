"use client";

import { FormEvent, useState } from "react";
import { UserPlus, Trash2 } from "lucide-react";

import { PasswordInput } from "@/components/ui/input";

export type TeamMember = { id: string; nom: string; prenom: string; tel: string | null; email?: string };

const field = "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black";

/**
 * The delivery team: register a delivery person and remove one who has left. The owner chooses a
 * starting password and gives it to the person, who signs in at the normal login page.
 */
export default function DeliveryTeam({ drivers, onChanged }: { drivers: TeamMember[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", tel: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string } | null>(null);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/drivers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, tel: form.tel || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(json.data) ? json.data.map((d: { message: string }) => d.message).join(" ") : "";
        throw new Error(detail || json.error || "Could not register this person.");
      }
      setCreated({ name: `${form.prenom} ${form.nom}`, email: form.email.toLowerCase() });
      setForm({ prenom: "", nom: "", email: "", tel: "", password: "" });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: TeamMember) => {
    if (!window.confirm(`Remove ${d.prenom} ${d.nom} from the delivery team?`)) return;
    setError(null);
    const res = await fetch(`/api/drivers/${d.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Could not remove this person.");
      return;
    }
    onChanged();
  };

  return (
    <section className="mb-6 rounded border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Delivery team</h2>
          <p className="text-sm text-gray-500">
            People who deliver orders. They sign in at the normal login page and see only the orders assigned to them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded bg-black px-3 py-2 text-sm text-white"
        >
          <UserPlus size={16} /> {open ? "Close" : "Add delivery person"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            First name
            <input className={field} value={form.prenom} onChange={update("prenom")} required minLength={2} />
          </label>
          <label className="text-sm">
            Last name
            <input className={field} value={form.nom} onChange={update("nom")} required minLength={2} />
          </label>
          <label className="text-sm">
            Email
            <input className={field} type="email" value={form.email} onChange={update("email")} required />
          </label>
          <label className="text-sm">
            Phone (optional)
            <input className={field} type="tel" value={form.tel} onChange={update("tel")} placeholder="08012345678" />
          </label>
          <label className="text-sm sm:col-span-2">
            Starting password (at least 6 characters)
            <PasswordInput
              className={field}
              value={form.password}
              onChange={update("password")}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">
              {busy ? "Registering…" : "Register delivery person"}
            </button>
          </div>
        </form>
      )}

      {created && (
        <p className="mt-3 rounded bg-green-50 p-3 text-sm text-green-800">
          {created.name} is registered. Give them this email ({created.email}) and the password you chose. They sign in at the
          normal login page and can change the password in their settings.
        </p>
      )}
      {error && <p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <ul className="mt-4 divide-y text-sm">
        {drivers.length === 0 && <li className="py-2 text-gray-500">Nobody yet. Add your first delivery person above.</li>}
        {drivers.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className="font-medium">
                {d.prenom} {d.nom}
              </span>
              <span className="ml-2 text-gray-500">{[d.tel, d.email].filter(Boolean).join(" · ")}</span>
            </span>
            <button
              type="button"
              onClick={() => remove(d)}
              className="flex items-center gap-1 text-red-600 hover:text-red-800"
              aria-label={`Remove ${d.prenom} ${d.nom}`}
            >
              <Trash2 size={15} /> Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
