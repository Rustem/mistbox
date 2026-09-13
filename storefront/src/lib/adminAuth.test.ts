import { beforeEach, describe, expect, it, vi } from 'vitest';

// The secret has to exist before the module under test reads it at call time.
process.env.ADMIN_SESSION_SECRET = 'test-secret-do-not-use-in-real-life';

import { isAllowedEmail, readSession, signSession } from './adminAuth';

describe('isAllowedEmail', () => {
  it('accepts an address on the domain', () => {
    expect(isAllowedEmail('rustem@mist.box')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAllowedEmail('Rustem@MIST.BOX')).toBe(true);
  });

  it('rejects every other domain', () => {
    expect(isAllowedEmail('rustem@gmail.com')).toBe(false);
    expect(isAllowedEmail('attacker@notmist.box')).toBe(false);
    expect(isAllowedEmail('rustem@mist.box.evil.com')).toBe(false);
  });
});

describe('signSession / readSession', () => {
  it('round-trips a real mist.box address', () => {
    // This is the exact case that broke in production: the domain "mist.box"
    // puts a literal "." in every real email, which broke an earlier version
    // that joined the session's fields with ".". Every session for this
    // project's own domain would have silently failed to read back.
    const token = signSession('rustem@mist.box');
    expect(readSession(token)?.email).toBe('rustem@mist.box');
  });

  it('lowercases the email it signs', () => {
    const token = signSession('Rustem@Mist.Box');
    expect(readSession(token)?.email).toBe('rustem@mist.box');
  });

  it('rejects a missing or empty cookie', () => {
    expect(readSession(undefined)).toBeNull();
    expect(readSession('')).toBeNull();
  });

  it('rejects a tampered email with a signature that no longer matches', () => {
    const token = signSession('rustem@mist.box');
    const [, expires, signature] = token.split('|');
    const forged = `attacker@mist.box|${expires}|${signature}`;
    expect(readSession(forged)).toBeNull();
  });

  it('rejects a tampered expiry', () => {
    const token = signSession('rustem@mist.box');
    const [email, expires, signature] = token.split('|');
    const pushedOut = `${email}|${Number(expires) + 100000}|${signature}`;
    expect(readSession(pushedOut)).toBeNull();
  });

  it('rejects a value that is not three pipe-separated fields', () => {
    expect(readSession('not-a-real-token')).toBeNull();
    expect(readSession('a|b|c|d')).toBeNull();
  });

  it('rejects an expired session even though nothing else was tampered with', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signSession('rustem@mist.box');

    // 14 days plus one second past signing.
    vi.setSystemTime(new Date('2026-01-15T00:00:01Z'));
    expect(readSession(token)).toBeNull();
    vi.useRealTimers();
  });

  it('accepts a session right up to the moment it expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signSession('rustem@mist.box');

    vi.setSystemTime(new Date('2026-01-14T23:59:59Z'));
    expect(readSession(token)?.email).toBe('rustem@mist.box');
    vi.useRealTimers();
  });

  it('never accepts a session for a domain that is not allowed', () => {
    // Defence in depth: even if a future bug or a rotated secret produced a
    // validly-signed token for the wrong domain, the domain check here is a
    // second, independent gate.
    const token = signSession('someone@other-domain.com');
    expect(readSession(token)).toBeNull();
  });
});
