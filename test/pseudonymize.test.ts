import { describe, expect, it } from 'vitest';
import { pseudonymizeIdentity, resolveSalt } from '../src/export/pseudonymize.js';

describe('pseudonymizeIdentity', () => {
  it('is deterministic for the same identity and salt', () => {
    const a = pseudonymizeIdentity('dev@acme-corp.example', 'org-salt-1');
    const b = pseudonymizeIdentity('dev@acme-corp.example', 'org-salt-1');
    expect(a).toBe(b);
  });

  it('produces a different pseudonym under a different salt (so a leaked hash list from one org cannot be matched against another)', () => {
    const a = pseudonymizeIdentity('dev@acme-corp.example', 'org-salt-1');
    const b = pseudonymizeIdentity('dev@acme-corp.example', 'org-salt-2');
    expect(a).not.toBe(b);
  });

  it('never includes the raw identity in its output', () => {
    const result = pseudonymizeIdentity('dev@acme-corp.example', 'org-salt-1');
    expect(result).not.toContain('dev');
    expect(result).not.toContain('acme-corp');
    expect(result).toMatch(/^u_[0-9a-f]{16}$/);
  });
});

describe('resolveSalt', () => {
  it('uses the org-configured salt verbatim when present', () => {
    const result = resolveSalt('the-real-org-salt');
    expect(result).toEqual({ salt: 'the-real-org-salt', isInstallLocalFallback: false });
  });

  it('falls back to a random salt, flagged as install-local, when none is configured', () => {
    const a = resolveSalt(undefined);
    const b = resolveSalt('');
    expect(a.isInstallLocalFallback).toBe(true);
    expect(b.isInstallLocalFallback).toBe(true);
    expect(a.salt).not.toBe(b.salt); // two independent fallbacks must not coincide
    expect(a.salt.length).toBeGreaterThan(16);
  });
});
