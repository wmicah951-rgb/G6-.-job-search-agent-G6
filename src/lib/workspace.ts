// WHO IS USING THE APP, WITHOUT A LOGIN.
//
// The site is public and has no accounts on purpose (the assignment does not ask for auth, and
// a sign-up wall would only get in a grader's way). But several people do use it at once — the
// team, the instructor, a classmate — and before this every visitor shared one global "active
// profile" flag, so switching résumé in one browser silently changed what everyone else's runs
// were scored against.
//
// So each browser gets a workspace: a random id in an http-only cookie. Profiles, postings,
// evaluations and harness settings all belong to a workspace, and nothing crosses between
// them. It is an account without a password: private enough that two people cannot disturb
// each other, and it costs the visitor nothing. It is NOT a security boundary — anyone holding
// the cookie value is that workspace — which is why the app only ever holds fictional résumés.

import { cookies } from "next/headers";
import { nanoid } from "nanoid";

export const WORKSPACE_COOKIE = "g6_workspace";
const VALID = /^[A-Za-z0-9_-]{8,40}$/;

/**
 * The current browser's workspace id, creating (and setting) one if this is a first visit.
 * Safe to call from any route handler; in a context where cookies cannot be written the id is
 * still returned so the request can be served.
 */
export async function currentWorkspace(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(WORKSPACE_COOKIE)?.value;
  if (existing && VALID.test(existing)) return existing;
  const id = nanoid(16);
  try {
    jar.set(WORKSPACE_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    // Read-only cookie context (e.g. a prerender). The caller still gets a usable id; the
    // browser will be given one on its next mutating request.
  }
  return id;
}
