/**
 * Reference by link — fetch a public direct-media URL into a File for the same
 * in-browser style analysis used for uploads. The bytes are reference material
 * (style DNA), never footage to copy. Platform watch pages are declined by the
 * server with a `kind`, which we surface to the user.
 *
 * Also parses the optional "Use: mm:ss – mm:ss" range.
 */

export interface FetchLinkResult {
  ok: boolean;
  file?: File;
  /** Machine reason for failure, from the server route. */
  kind?: 'platform' | 'not-media' | 'unreachable' | 'too-large' | 'invalid' | 'other';
  platform?: string;
  error?: string;
}

export async function fetchReferenceLink(url: string): Promise<FetchLinkResult> {
  let res: Response;
  try {
    res = await fetch('/api/reference/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    });
  } catch {
    return { ok: false, kind: 'other', error: 'Could not reach the server.' };
  }

  if (res.ok) {
    const blob = await res.blob();
    const header = decodeURIComponent(res.headers.get('x-reference-filename') || 'reference.mp4');
    const ctype = res.headers.get('content-type') || blob.type || 'video/mp4';
    return { ok: true, file: new File([blob], header, { type: ctype }) };
  }

  try {
    const data = await res.json() as { ok?: boolean; kind?: FetchLinkResult['kind']; platform?: string; error?: string };
    return { ok: false, kind: data.kind ?? 'other', platform: data.platform, error: data.error ?? 'Could not fetch that link.' };
  } catch {
    return { ok: false, kind: 'other', error: `The link returned status ${res.status}.` };
  }
}

// ── time range parsing ("mm:ss–mm:ss" or seconds) ────────────────────────────

export interface TimeRange { startS: number; endS: number }

/** Parse a single "h:mm:ss" / "m:ss" / "s" timestamp to seconds, or null. */
export function parseTimeToken(tok: string): number | null {
  const t = tok.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(':').map(p => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null;
  let s = 0;
  for (const p of parts) s = s * 60 + Number(p);
  return s;
}

/** Parse "00:12 - 01:04" / "00:12–01:04" / "12..64" into a valid range, or null. */
export function parseTimeRange(text: string): TimeRange | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/\s*(?:–|—|-|\.\.|to)\s*/i);
  if (parts.length !== 2) return null;
  const startS = parseTimeToken(parts[0]);
  const endS = parseTimeToken(parts[1]);
  if (startS == null || endS == null || endS <= startS + 0.5) return null;
  return { startS, endS };
}

export function fmtTimestamp(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
