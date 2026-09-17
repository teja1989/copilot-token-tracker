import { describe, expect, it } from 'vitest';
import { userInfo } from 'node:os';
import { resolveRawIdentity } from '../src/export/identity.js';

describe('resolveRawIdentity', () => {
  it('uses the git email when present', async () => {
    const result = await resolveRawIdentity(async () => 'dev@acme-corp.example\n');
    expect(result).toBe('dev@acme-corp.example');
  });

  it('falls back to the OS username when git has no configured email', async () => {
    const result = await resolveRawIdentity(async () => '');
    expect(result).toBe(userInfo().username);
  });

  it('falls back to the OS username when the git reader throws (git not installed, not configured)', async () => {
    const result = await resolveRawIdentity(async () => {
      throw new Error('git: command not found');
    });
    expect(result).toBe(userInfo().username);
  });
});
