/**
 * Pure validation/classification for reference-link fetching. Isomorphic and
 * side-effect free so the policy (what links we will fetch, what is a platform
 * watch page to decline, which addresses are off-limits) is unit-testable.
 */

export const MEDIA_EXT_RE = /\.(mp4|mov|webm|mkv|m4v|avi|ogv|ts|mpg|mpeg|m4a|mp3|wav|aac|opus|ogg)(\?.*)?$/i;
export const MEDIA_CT_RE = /^(video|audio)\//;

/** Hostnames that serve watch pages rather than downloadable media. */
const PLATFORM_HOSTS = [
  'youtube.com', 'youtu.be',
  'tiktok.com',
  'instagram.com', 'instagr.am',
  'vimeo.com',
  'facebook.com', 'fb.watch', 'fb.com',
  'x.com', 'twitter.com', 't.co',
  'dailymotion.com', 'dai.ly',
  'twitch.tv',
  'snapchat.com',
];

/** Return a human platform name for a watch-page host, or null if it isn't one. */
export function classifyPlatform(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  for (const p of PLATFORM_HOSTS) {
    if (h === p || h.endsWith('.' + p)) {
      const label = p.replace(/\.(com|tv|ly|am|ly|watch)$/, '');
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
  }
  return null;
}

/** True if a dotted-quad IPv4 address is private/loopback/link-local/reserved. */
export function isPrivateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some(x => x > 255)) return false;
  const [a, b] = o;
  if (a === 10 || a === 127 || a === 0) return true;            // private / loopback / "this host"
  if (a === 172 && b >= 16 && b <= 31) return true;             // 172.16/12
  if (a === 192 && b === 168) return true;                      // 192.168/16
  if (a === 169 && b === 254) return true;                      // link-local
  if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT 100.64/10
  if (a === 192 && b === 0 && o[2] === 0) return true;          // 192.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;         // benchmarking
  if (a >= 224) return true;                                    // multicast / reserved
  return false;
}

/** True if an IPv6 address (brackets stripped) is loopback/link-local/ULA. */
export function isPrivateIpv6(ip: string): boolean {
  const h = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes(':')) return false;
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true;    // unique local
  if (h.startsWith('ff')) return true;                          // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4
  const mapped = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(h);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/** True if any already-resolved address literal is private/internal. */
export function isPrivateIp(ip: string): boolean {
  return isPrivateIpv4(ip) || isPrivateIpv6(ip);
}

/**
 * Reject hostnames that are obviously private/internal *by name*. This is a
 * cheap first line of defence; the route additionally resolves DNS and checks
 * the actual IPs (see {@link isPrivateIp}) to block rebinding names such as
 * `127.0.0.1.nip.io`.
 */
export function isBlockedAddress(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (isPrivateIpv4(h) || isPrivateIpv6(h)) return true;
  return false;
}

export type LinkVerdict = 'ok' | 'invalid' | 'platform' | 'blocked-address';

export interface ClassifiedLink {
  verdict: LinkVerdict;
  url?: URL;
  platform?: string;
}

/** Validate a pasted reference URL into a verdict + parsed URL. */
export function classifyLink(raw: string): ClassifiedLink {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { verdict: 'invalid' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { verdict: 'invalid' };
  if (isBlockedAddress(u.hostname)) return { verdict: 'blocked-address' };

  const platform = classifyPlatform(u.hostname);
  if (platform && !MEDIA_EXT_RE.test(u.pathname)) {
    return { verdict: 'platform', platform };
  }
  return { verdict: 'ok', url: u };
}
