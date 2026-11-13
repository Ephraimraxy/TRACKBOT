"use client";

import { useCallback, useEffect, useState } from "react";

type Faq = {
  id: string;
  question: string;
  answer: string;
  keywords: string | null;
  actif: boolean;
};

const EMPTY = { question: "", answer: "", keywords: "" };

export default function AdminFaqPage() {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/faqs");
      if (!res.ok) throw new Error("Unable to load the FAQ.");
      setFaqs((await res.json()).data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "The operation failed.");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { question: form.question, answer: form.answer, keywords: form.keywords || null };
      if (editingId) await call(`/api/faqs/${editingId}`, "PATCH", payload);
      else await call("/api/faqs", "POST", payload);
      setForm(EMPTY);
      setEditingId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (f: Faq) => {
    try {
      await call(`/api/faqs/${f.id}`, "PATCH", { actif: !f.actif });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (f: Faq) => {
    if (!window.confirm(`Delete “${f.question}”?`)) return;
    try {
      await call(`/api/faqs/${f.id}`, "DELETE");
      if (editingId === f.id) {
        setEditingId(null);
        setForm(EMPTY);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const edit = (f: Faq) => {
    setEditingId(f.id);
    setForm({ question: f.question, answer: f.answer, keywords: f.keywords ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Chatbot FAQ</h1>
      <p className="mb-4 text-sm text-gray-500">
        The chatbot answers questions about delivery, payment, returns and opening hours{" "}
        <strong>only</strong> with these answers. If nothing matches, it invites the customer to contact you. Add keywords (synonyms) to improve matching.
      </p>

      {error && <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <form onSubmit={submit} className="mb-6 grid gap-3 rounded border bg-white p-4">
        <h2 className="font-medium">{editingId ? "Edit entry" : "Add an entry"}</h2>
        <input
          className="rounded border p-2"
          placeholder="Question (e.g. What are your delivery times?)"
          value={form.question}
          maxLength={255}
          required
          minLength={3}
          onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
        />
        <textarea
          className="rounded border p-2"
          placeholder="Reply"
          rows={3}
          maxLength={1000}
          required
          value={form.answer}
          onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
        />
        <input
          className="rounded border p-2"
          placeholder="Keywords / synonyms, separated by commas (optional)"
          value={form.keywords}
          maxLength={255}
          onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
        />
        <div className="flex gap-2">
          <button className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-40" disabled={saving}>
            {saving ? "…" : editingId ? "Save" : "Add"}
          </button>
          {editingId && (
            <button
              type="button"
              className="rounded border px-4 py-2"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && faqs.length === 0 && <p className="text-gray-500">No entries yet.</p>}

      <ul className="grid gap-3">
        {faqs.map((f) => (
          <li key={f.id} className={`rounded border bg-white p-4 ${f.actif ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{f.question}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{f.answer}</p>
                {f.keywords && <p className="mt-1 text-xs text-gray-400">Keywords: {f.keywords}</p>}
              </div>
              <span className={`rounded px-2 py-1 text-xs ${f.actif ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                {f.actif ? "Active" : "Disabled"}
              </span>
            </div>
            <div className="mt-3 flex gap-3 text-sm">
              <button className="text-blue-600 underline" onClick={() => edit(f)}>
                Edit
              </button>
              <button className="text-blue-600 underline" onClick={() => toggle(f)}>
                {f.actif ? "Disable" : "Enable"}
              </button>
              <button className="text-red-600 underline" onClick={() => remove(f)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
