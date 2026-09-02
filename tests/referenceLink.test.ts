import { describe, it, expect } from 'vitest';
import { classifyLink, classifyPlatform, isBlockedAddress, isPrivateIp, isPrivateIpv4, isPrivateIpv6, MEDIA_EXT_RE } from '../src/lib/referenceGuard';
import { parseTimeRange, parseTimeToken } from '../src/lib/referenceLink';

describe('classifyPlatform', () => {
  it('recognises watch-page hosts', () => {
    expect(classifyPlatform('www.youtube.com')).toBeTruthy();
    expect(classifyPlatform('youtu.be')).toBeTruthy();
    expect(classifyPlatform('vm.tiktok.com')).toBeTruthy();
    expect(classifyPlatform('instagram.com')).toBeTruthy();
    expect(classifyPlatform('vimeo.com')).toBeTruthy();
  });
  it('treats CDN / direct-file hosts as non-platform', () => {
    expect(classifyPlatform('cdn.example.com')).toBeNull();
    expect(classifyPlatform('storage.googleapis.com')).toBeNull();
  });
});

describe('isBlockedAddress (SSRF)', () => {
  it('blocks private/loopback/link-local ranges', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('localhost')).toBe(true);
    expect(isBlockedAddress('10.0.0.5')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('169.254.1.1')).toBe(true);
  });
  it('allows public addresses', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('example.com')).toBe(false);
    expect(isBlockedAddress('172.32.0.1')).toBe(false);   // just outside RFC1918
  });
});

describe('isPrivateIp (DNS-resolved addresses)', () => {
  it('flags private/loopback/link-local IPv4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.255',
                      '169.254.10.10', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1']) {
      expect(isPrivateIpv4(ip)).toBe(true);
    }
  });
  it('passes public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '193.0.0.1']) {
      expect(isPrivateIpv4(ip)).toBe(false);
    }
  });
  it('flags IPv6 loopback/ULA/link-local and mapped v4', () => {
    expect(isPrivateIpv6('::1')).toBe(true);
    expect(isPrivateIpv6('fc00::1')).toBe(true);
    expect(isPrivateIpv6('fd12:3456::9')).toBe(true);
    expect(isPrivateIpv6('fe80::1')).toBe(true);
    expect(isPrivateIpv6('ff02::1')).toBe(true);
    expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);   // mapped loopback
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false);
  });
  it('combined helper matches either family', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('2606:4700::1')).toBe(false);
  });
  it('rebinding name is blocked by address check even when name looks public', () => {
    // 127.0.0.1.nip.io passes the string guard but resolves to 127.0.0.1;
    // the route's isPrivateIp(resolved) is what stops it.
    expect(isBlockedAddress('127.0.0.1.nip.io')).toBe(false); // name alone isn't caught
    expect(isPrivateIp('127.0.0.1')).toBe(true);              // resolved address is
  });
});

describe('classifyLink', () => {
  it('accepts a direct media file URL', () => {
    const c = classifyLink('https://cdn.example.com/clip.mp4');
    expect(c.verdict).toBe('ok');
    expect(c.url?.hostname).toBe('cdn.example.com');
  });
  it('accepts a query-suffixed media URL', () => {
    expect(classifyLink('https://files.test/v.webm?token=abc').verdict).toBe('ok');
  });
  it('declines a platform watch page', () => {
    const c = classifyLink('https://www.youtube.com/watch?v=abc123');
    expect(c.verdict).toBe('platform');
    expect(c.platform).toBeTruthy();
    expect(classifyLink('https://youtu.be/abc123').verdict).toBe('platform');
  });
  it('still fetches a direct media link even from a platform host (e.g. cdn)', () => {
    expect(classifyLink('https://youtube.com/v/clip.mp4').verdict).toBe('ok');
  });
  it('rejects junk and non-http schemes', () => {
    expect(classifyLink('not a link').verdict).toBe('invalid');
    expect(classifyLink('ftp://example.com/a.mp4').verdict).toBe('invalid');
  });
  it('rejects private addresses', () => {
    expect(classifyLink('http://127.0.0.1/a.mp4').verdict).toBe('blocked-address');
  });
});

describe('media extension', () => {
  it('matches common media files', () => {
    expect(MEDIA_EXT_RE.test('/a/b.MOV?x=1')).toBe(true);
    expect(MEDIA_EXT_RE.test('/video.webm')).toBe(true);
    expect(MEDIA_EXT_RE.test('/page.html')).toBe(false);
  });
});

describe('parseTimeToken', () => {
  it('parses seconds, m:ss and h:mm:ss', () => {
    expect(parseTimeToken('12')).toBe(12);
    expect(parseTimeToken('00:12')).toBe(12);
    expect(parseTimeToken('1:04')).toBe(64);
    expect(parseTimeToken('1:01:04')).toBe(3664);
    expect(parseTimeToken('')).toBeNull();
    expect(parseTimeToken('banana')).toBeNull();
  });
});

describe('parseTimeRange', () => {
  it('parses en-dash, hyphen and "to" ranges', () => {
    expect(parseTimeRange('00:12 – 01:04')).toEqual({ startS: 12, endS: 64 });
    expect(parseTimeRange('00:12-01:04')).toEqual({ startS: 12, endS: 64 });
    expect(parseTimeRange('12 to 64')).toEqual({ startS: 12, endS: 64 });
  });
  it('rejects backwards, equal or malformed ranges', () => {
    expect(parseTimeRange('01:04 - 00:12')).toBeNull();
    expect(parseTimeRange('00:12 - 00:12')).toBeNull();
    expect(parseTimeRange('00:12')).toBeNull();
  });
});
