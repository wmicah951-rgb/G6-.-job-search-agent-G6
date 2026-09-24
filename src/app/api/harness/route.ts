import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import {
  ensureSchema,
  getActiveProfile,
  loadHarnessOverrides,
  saveHarnessOverrides,
  resetHarnessOverride,
} from "@/lib/db";
import {
  DEFAULT_SETTINGS,
  modifiedKeys,
  resolveSettings,
  validateSettings,
} from "@/lib/harnessSettings";

// Per-profile harness settings. The database holds ONLY overrides, so the shipped
// defaults stay the single source of truth and Reset is a DELETE, never a copy.

export async function GET() {
  await ensureSchema();
  const profile = await getActiveProfile(await currentWorkspace());
  const overrides = await loadHarnessOverrides(profile.id);
  return NextResponse.json({
    profileId: profile.id,
    profileName: profile.name,
    defaults: DEFAULT_SETTINGS,
    effective: resolveSettings(overrides),
    modified: modifiedKeys(overrides),
  });
}

export async function PUT(req: NextRequest) {
  await ensureSchema();
  const profile = await getActiveProfile(await currentWorkspace());
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { sanitized, errors, warnings } = validateSettings(body.settings);
  if (errors.length > 0) {
    // Refused outright, nothing written — the previous settings still apply, so a bad
    // edit cannot leave the harness in a broken state.
    return NextResponse.json({ errors, warnings }, { status: 400 });
  }

  await saveHarnessOverrides(profile.id, sanitized);
  const overrides = await loadHarnessOverrides(profile.id);
  return NextResponse.json({
    ok: true,
    warnings,
    effective: resolveSettings(overrides),
    modified: modifiedKeys(overrides),
  });
}

export async function DELETE(req: NextRequest) {
  await ensureSchema();
  const profile = await getActiveProfile(await currentWorkspace());
  const key = new URL(req.url).searchParams.get("key") ?? undefined;
  await resetHarnessOverride(profile.id, key);
  const overrides = await loadHarnessOverrides(profile.id);
  return NextResponse.json({
    ok: true,
    effective: resolveSettings(overrides),
    modified: modifiedKeys(overrides),
  });
}
