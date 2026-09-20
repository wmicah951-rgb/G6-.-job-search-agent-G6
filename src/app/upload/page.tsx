"use client";

import QuickKnobs from "@/components/QuickKnobs";

import { useEffect, useState } from "react";

type ProfileSummary = {
  id: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
};

export default function UploadPage() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [preferencesText, setPreferencesText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProfiles(selectAfter?: string) {
    const res = await fetch("/api/profiles");
    const data = await res.json();
    const list: ProfileSummary[] = data.profiles ?? [];
    setProfiles(list);
    const toSelect = selectAfter ?? list.find((p) => p.isActive)?.id ?? list[0]?.id ?? null;
    if (toSelect) await loadProfile(toSelect);
  }

  async function loadProfile(id: string) {
    const res = await fetch(`/api/profiles/${id}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load that profile.");
      return;
    }
    setSelectedId(id);
    setResumeText(data.resumeText ?? "");
    setPreferencesText(data.preferencesText ?? "");
    setSaved(false);
    setError(null);
  }

  useEffect(() => {
    setLoading(true);
    loadProfiles().finally(() => setLoading(false));
  }, []);

  async function handleSelect(id: string) {
    setBusy(true);
    await loadProfile(id);
    setBusy(false);
  }

  async function handleSave() {
    if (!selectedId) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText, preferencesText }),
      });
      if (res.ok) {
        setSaved(true);
        await loadProfiles(selectedId);
      } else {
        const data = await res.json();
        setError(data.error ?? "Save failed.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleMakeActive() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setActive: true }),
      });
      if (res.ok) {
        await loadProfiles(selectedId);
      } else {
        const data = await res.json();
        setError(data.error ?? "Could not activate that profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      // New profiles start as a copy of whatever is currently on screen, so you
      // can fork a variant (e.g. a resume tuned for a different track) instead
      // of retyping everything from scratch.
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, resumeText, preferencesText, setActive: false }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewName("");
        await loadProfiles(data.id);
      } else {
        setError(data.error ?? "Could not create profile.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!selectedId) return;
    const profile = profiles.find((p) => p.id === selectedId);
    if (!profile) return;
    if (!window.confirm(`Delete profile "${profile.name}"? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${selectedId}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        await loadProfiles();
      } else {
        setError(data.error ?? "Could not delete profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-neutral-500">Loading…</p>;

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">Resume &amp; preferences</h1>
      <p className="text-sm text-neutral-500 mb-4">
        This is the ONLY source of facts the agent is allowed to use when drafting
        application material — it will never invent a skill or a year of experience
        that isn&apos;t written here. Preferences hold your hard constraints (years,
        clearance, remote/hybrid). New postings are always evaluated against
        whichever profile is marked <span className="font-medium">active</span>.
      </p>

      <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2 mb-4">
        This site is public and shared by the whole group. Use <b>fictional</b> info only —
        no real phone number, address or email. You can set the fit bar in preferences
        with a line like <code>Minimum fit: 60%</code>.
      </p>

      <div className="border border-neutral-200 bg-white rounded-lg p-3 mb-4">
        <label className="block text-xs font-medium text-neutral-500 mb-1">Profile</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedId ?? ""}
            onChange={(e) => handleSelect(e.target.value)}
            disabled={busy}
            className="border border-neutral-300 rounded-md px-2 py-1.5 text-sm bg-white text-neutral-900"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>

          {selectedProfile && !selectedProfile.isActive && (
            <button
              onClick={handleMakeActive}
              disabled={busy}
              className="text-xs bg-blue-700 text-white px-2 py-1.5 rounded-md disabled:opacity-50"
            >
              Make active
            </button>
          )}
          {selectedProfile?.isActive && (
            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium">
              active
            </span>
          )}

          <button
            onClick={handleDelete}
            disabled={busy || profiles.length <= 1}
            title={profiles.length <= 1 ? "Can't delete the only profile" : "Delete this profile"}
            className="text-xs text-red-700 border border-red-200 px-2 py-1.5 rounded-md disabled:opacity-40 ml-auto"
          >
            Delete profile
          </button>
        </div>

        {/* flex-wrap + min-w-0: an <input>'s intrinsic width (~20 chars by default) doesn't
            shrink below that on its own, so on a narrow screen it was pushing the button off
            the right edge of the page instead of giving way to it. */}
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-neutral-100">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New profile name (e.g. Profile 2 — PM track)"
            className="flex-1 min-w-0 border border-neutral-300 rounded-md px-3 py-1.5 text-sm bg-white text-neutral-900 placeholder:text-neutral-400"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="text-sm bg-neutral-900 text-white px-3 py-1.5 rounded-md disabled:opacity-50 whitespace-nowrap"
          >
            {creating ? "Creating…" : "+ New profile (copy current)"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <QuickKnobs preferencesText={preferencesText} onChange={setPreferencesText} />

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">resume.md</label>
        <textarea
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          rows={16}
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono bg-white text-neutral-900"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">preferences.md</label>
        <textarea
          value={preferencesText}
          onChange={(e) => setPreferencesText(e.target.value)}
          rows={10}
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono bg-white text-neutral-900"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="text-sm bg-neutral-900 text-white px-4 py-2 rounded-md disabled:opacity-50"
      >
        {saving ? "Saving…" : `Save changes to "${selectedProfile?.name ?? "profile"}"`}
      </button>
      {saved && <span className="ml-3 text-sm text-green-700">Saved.</span>}
    </div>
  );
}
