import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  formatContext,
  formatMemoryDate,
  truncateText,
  isManagedSddAgent,
  isSddFallbackAgent,
  isPrimarySddAgent,
  isFallbackEligibleSddAgent,
  isEditablePrimaryAgent,
  isCatalogVisibleAgent,
  isPersistibleAgentKey,
  isRuntimeSyncEligibleAgent,
  resolveModelInfo,
  parseActiveProfileFromRaw,
  resolveSessionActiveModel,
  withFileLock,
} from './utils';

describe('utils logic', () => {
  describe('formatContext', () => {
    it('should handle null or non-number', () => {
      expect(formatContext(null)).toBe('ctx: N/A');
      expect(formatContext('128000' as any)).toBe('ctx: N/A');
    });

    it('should format millions', () => {
      expect(formatContext(1000000)).toBe('1M ctx');
      expect(formatContext(1500000)).toBe('1.5M ctx');
      expect(formatContext(2000000)).toBe('2M ctx');
    });

    it('should format thousands', () => {
      expect(formatContext(128000)).toBe('128k ctx');
      expect(formatContext(8192)).toBe('8k ctx');
    });

    it('should format small numbers', () => {
      expect(formatContext(512)).toBe('512 ctx');
    });
  });

  describe('formatMemoryDate', () => {
    it('should handle undefined', () => {
      expect(formatMemoryDate(undefined)).toBe('No date');
    });

    it('should handle invalid dates', () => {
      expect(formatMemoryDate('not-a-date')).toBe('not-a-date');
    });

    it('should format valid dates', () => {
      const iso = '2023-01-01T12:00:00Z';
      const formatted = formatMemoryDate(iso);
      expect(formatted).not.toBe(iso);
      expect(formatted).not.toBe('No date');
      // toLocaleString varies by environment, so we just check it's not the raw string
    });
  });

  describe('truncateText', () => {
    it('should handle empty or null', () => {
      expect(truncateText('')).toBe('');
      expect(truncateText(null as any)).toBe('');
    });

    it('should not truncate short text', () => {
      expect(truncateText('short', 10)).toBe('short');
    });

    it('should truncate long text', () => {
      expect(truncateText('this is a very long text', 10)).toBe('this is a…');
    });

    it('should use default max', () => {
      const long = 'a'.repeat(121);
      const truncated = truncateText(long);
      expect(truncated.length).toBe(120);
      expect(truncated.endsWith('…')).toBe(true);
    });
  });

  describe('agent naming utils', () => {
    it('isManagedSddAgent', () => {
      expect(isManagedSddAgent('sdd-test')).toBe(true);
      expect(isManagedSddAgent('review-risk')).toBe(true);
      expect(isManagedSddAgent('jd-judge-a')).toBe(true);
      expect(isManagedSddAgent('gentle-orchestrator')).toBe(true);
      expect(isManagedSddAgent('model-audit')).toBe(true);
      expect(isManagedSddAgent('other-test')).toBe(false);
    });

    it('isSddFallbackAgent', () => {
      expect(isSddFallbackAgent('sdd-test-fallback')).toBe(true);
      expect(isSddFallbackAgent('review-risk-fallback')).toBe(true);
      expect(isSddFallbackAgent('jd-judge-a-fallback')).toBe(true);
      expect(isSddFallbackAgent('sdd-test')).toBe(false);
      expect(isSddFallbackAgent('model-audit')).toBe(false);
      expect(isSddFallbackAgent('other-fallback')).toBe(false);
    });

    it('isPrimarySddAgent', () => {
      expect(isPrimarySddAgent('sdd-test')).toBe(true);
      expect(isPrimarySddAgent('review-risk')).toBe(true);
      expect(isPrimarySddAgent('jd-judge-a')).toBe(true);
      expect(isPrimarySddAgent('gentle-orchestrator')).toBe(true);
      expect(isPrimarySddAgent('model-audit')).toBe(true);
      expect(isPrimarySddAgent('sdd-test-fallback')).toBe(false);
      expect(isPrimarySddAgent('other-test')).toBe(false);
    });

    it('isFallbackEligibleSddAgent', () => {
      expect(isFallbackEligibleSddAgent('sdd-test')).toBe(true);
      expect(isFallbackEligibleSddAgent('review-risk')).toBe(true);
      expect(isFallbackEligibleSddAgent('jd-judge-a')).toBe(true);
      expect(isFallbackEligibleSddAgent('sdd-orchestrator')).toBe(false);
      expect(isFallbackEligibleSddAgent('gentle-orchestrator')).toBe(false);
      expect(isFallbackEligibleSddAgent('model-audit')).toBe(false);
      expect(isFallbackEligibleSddAgent('review-risk-fallback')).toBe(false);
      expect(isFallbackEligibleSddAgent('sdd-test-fallback')).toBe(false);
      expect(isFallbackEligibleSddAgent('other-test')).toBe(false);
    });

    it('isEditablePrimaryAgent accepts runtime custom primaries and rejects reserved/fallback names', () => {
      expect(isEditablePrimaryAgent('security-scanner')).toBe(true);
      expect(isEditablePrimaryAgent('model-audit')).toBe(true);
      expect(isEditablePrimaryAgent('gentle-ai-windows-validator')).toBe(true);
      expect(isEditablePrimaryAgent('tester-fallback')).toBe(false);
      expect(isEditablePrimaryAgent('sdd-orchestrator')).toBe(false);
      expect(isEditablePrimaryAgent('build')).toBe(false);
    });

    it('keeps catalog visibility, persistence, and runtime sync as separate boundaries', () => {
      expect(isCatalogVisibleAgent('sdd-ORCHETATOR')).toBe(true);
      expect(isPersistibleAgentKey('sdd-ORCHETATOR')).toBe(true);
      expect(isPersistibleAgentKey('─────────────')).toBe(false);

      expect(isRuntimeSyncEligibleAgent('sdd-apply')).toBe(true);
      expect(isRuntimeSyncEligibleAgent('gentle-ai-windows-validator')).toBe(true);
      expect(isRuntimeSyncEligibleAgent('sdd-ORCHETATOR')).toBe(false);
      expect(isRuntimeSyncEligibleAgent('compaction')).toBe(false);
      expect(isRuntimeSyncEligibleAgent('summary')).toBe(false);
      expect(isRuntimeSyncEligibleAgent('title')).toBe(false);
    });
  });

  describe('resolveModelInfo', () => {
    it('should handle unassigned model', () => {
      expect(resolveModelInfo({}, '')).toBe('Unassigned');
    });

    it('should resolve model info with context', () => {
      const api = {
        state: {
          provider: [
            {
              id: 'openai',
              models: {
                'gpt-4': {
                  limit: { context: 128000 }
                }
              }
            }
          ]
        }
      };
      expect(resolveModelInfo(api, 'openai/gpt-4')).toBe('openai/gpt-4 (128k ctx)');
    });

    it('should resolve model info without context', () => {
      const api = {
        state: {
          provider: [
            {
              id: 'openai',
              models: {
                'gpt-4': {}
              }
            }
          ]
        }
      };
      expect(resolveModelInfo(api, 'openai/gpt-4')).toBe('openai/gpt-4');
    });
  });

  describe('parseActiveProfileFromRaw', () => {
    const mockApi = {
      state: {
        provider: [
          {
            id: 'openai',
            name: 'OpenAI',
            models: {
              'gpt-4': { name: 'GPT-4', limit: { context: 128000 } }
            }
          }
        ]
      }
    };

    it('should return null for invalid JSON', () => {
      expect(parseActiveProfileFromRaw('invalid', mockApi)).toBe(null);
    });

    it('should return null if no agents/models found', () => {
      expect(parseActiveProfileFromRaw('{}', mockApi)).toBe(null);
    });

    it('should parse valid agent config', () => {
      const raw = JSON.stringify({
        agent: {
          'sdd-test': { model: 'openai/gpt-4', reasoningEffort: 'high' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result).toEqual({
        modelId: 'openai/gpt-4',
        modelName: 'GPT-4',
        providerName: 'OpenAI',
        contextLimit: 128000,
        reasoningEffort: 'high'
      });
    });

    it('should omit reasoning effort when not present', () => {
      const raw = JSON.stringify({
        agent: {
          'sdd-test': { model: 'openai/gpt-4' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result).toEqual({
        modelId: 'openai/gpt-4',
        modelName: 'GPT-4',
        providerName: 'OpenAI',
        contextLimit: 128000,
      });
      expect(result).not.toHaveProperty('reasoningEffort');
    });

    it('should fallback to "model" key if "agent" is missing', () => {
      const raw = JSON.stringify({
        model: {
          'sdd-test': { model: 'openai/gpt-4' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result?.modelId).toBe('openai/gpt-4');
    });

    it('should handle missing provider gracefully', () => {
      const raw = JSON.stringify({
        agent: {
          'sdd-test': { model: 'anthropic/claude' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result).toEqual({
        modelId: 'anthropic/claude',
        modelName: 'claude',
        providerName: 'anthropic',
        contextLimit: null
      });
    });

    it('should prioritize managed SDD agents', () => {
      const raw = JSON.stringify({
        agent: {
          'other-agent': { model: 'openai/gpt-3.5' },
          'sdd-agent': { model: 'openai/gpt-4' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result?.modelId).toBe('openai/gpt-4');
    });

    it('should keep gentle-orchestrator model from migrated profile payloads', () => {
      const raw = JSON.stringify({
        agent: {
          'other-agent': { model: 'openai/gpt-3.5' },
          'gentle-orchestrator': { model: 'openai/gpt-4' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result?.modelId).toBe('openai/gpt-4');
    });

    it('should return null if agent has no model', () => {
        const raw = JSON.stringify({
          agent: {
            'sdd-test': {}
          }
      });
      expect(parseActiveProfileFromRaw(raw, mockApi)).toBe(null);
      });
  });

  describe('resolveSessionActiveModel', () => {
    it('should include reasoning effort from active user agent config', () => {
      const api = {
        state: {
          provider: [
            {
              id: 'openai',
              name: 'OpenAI',
              models: {
                'gpt-4': { name: 'GPT-4', limit: { context: 128000 } }
              }
            }
          ],
          config: {
            agent: {
              'sdd-orchestrator': {
                model: 'openai/gpt-4',
                reasoningEffort: 'medium',
              }
            }
          },
          session: {
            messages: vi.fn().mockReturnValue([
              { role: 'user', agent: 'sdd-orchestrator' }
            ])
          }
        }
      };

      expect(resolveSessionActiveModel(api, 'session-1')).toEqual({
        modelId: 'openai/gpt-4',
        modelName: 'GPT-4',
        providerName: 'OpenAI',
        contextLimit: 128000,
        reasoningEffort: 'medium',
      });
    });
  });

  describe('withFileLock', () => {
    it('executes callback and releases lock file on completion', () => {
      const testFile = path.join(os.tmpdir(), `test-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      const lockFile = `${path.resolve(testFile)}.lock`;

      const result = withFileLock(testFile, () => {
        expect(fs.existsSync(lockFile)).toBe(true);
        return 'executed';
      });

      expect(result).toBe('executed');
      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('does not execute callback and throws timeout when active lock cannot be acquired', () => {
      const testFile = path.join(os.tmpdir(), `test-active-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      const lockFile = `${path.resolve(testFile)}.lock`;
      fs.writeFileSync(lockFile, '999999:1000:active-token', 'utf8');

      const callbackSpy = vi.fn();
      expect(() => {
        withFileLock(
          testFile,
          callbackSpy,
          {
            maxRetries: 3,
            retryDelayMs: 0,
            sleepFn: () => {},
            isPidAlive: () => true,
          }
        );
      }).toThrow(/Failed to acquire file lock/);

      expect(callbackSpy).not.toHaveBeenCalled();
      expect(fs.existsSync(lockFile)).toBe(true);
      fs.unlinkSync(lockFile);
    });

    it('recovers orphan lock when owner PID is dead', () => {
      const testFile = path.join(os.tmpdir(), `test-dead-pid-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      const lockFile = `${path.resolve(testFile)}.lock`;
      fs.writeFileSync(lockFile, '999999:1000:dead-token', 'utf8');

      const result = withFileLock(
        testFile,
        () => 'orphan-recovered',
        {
          maxRetries: 5,
          retryDelayMs: 0,
          sleepFn: () => {},
          isPidAlive: () => false,
        }
      );

      expect(result).toBe('orphan-recovered');
      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('handles reentrancy without deadlock when called recursively on the same file', () => {
      const testFile = path.join(os.tmpdir(), `test-reentrancy-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

      const executionOrder: string[] = [];
      const result = withFileLock(testFile, () => {
        executionOrder.push('outer-start');
        const innerResult = withFileLock(testFile, () => {
          executionOrder.push('inner');
          return 'inner-result';
        });
        executionOrder.push('outer-end');
        return innerResult;
      });

      expect(result).toBe('inner-result');
      expect(executionOrder).toEqual(['outer-start', 'inner', 'outer-end']);
    });

    it('releases lock even if callback throws an error', () => {
      const testFile = path.join(os.tmpdir(), `test-throw-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      const lockFile = `${path.resolve(testFile)}.lock`;

      expect(() => {
        withFileLock(testFile, () => {
          throw new Error('callback-failure');
        });
      }).toThrow('callback-failure');

      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('cleans up stale lock file if older than threshold when PID is unparseable', () => {
      const testFile = path.join(os.tmpdir(), `test-stale-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      const lockFile = `${path.resolve(testFile)}.lock`;

      // Create a stale lock file with unparseable content and an old mtime
      fs.writeFileSync(lockFile, 'invalid-content', 'utf8');
      const pastTime = (Date.now() - 10000) / 1000;
      fs.utimesSync(lockFile, pastTime, pastTime);

      const result = withFileLock(testFile, () => 'recovered', {
        staleAgeMs: 5000,
        retryDelayMs: 0,
        sleepFn: () => {},
      });
      expect(result).toBe('recovered');
      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('does not delete lock file if ownership was replaced by another owner', () => {
      const testFile = path.join(os.tmpdir(), `test-replaced-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      const lockFile = `${path.resolve(testFile)}.lock`;

      withFileLock(testFile, () => {
        expect(fs.existsSync(lockFile)).toBe(true);
        // Simulate another owner replacing the lock file
        fs.writeFileSync(lockFile, '888888:9999:other-owner-token', 'utf8');
        return 'done';
      });

      expect(fs.existsSync(lockFile)).toBe(true);
      const content = fs.readFileSync(lockFile, 'utf8');
      expect(content).toBe('888888:9999:other-owner-token');
      fs.unlinkSync(lockFile);
    });
  });
});
