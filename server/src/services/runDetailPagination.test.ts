import { describe, expect, it, vi } from 'vitest';
import {
  pageLogLinesFromEnd,
  pageLegacyOutputRows,
  redactLogPage,
} from './runDetailPagination';

describe('pageLogLinesFromEnd', () => {
  it('returns bounded pages from a large log using bounded chunk reads', async () => {
    const log = Array.from({ length: 5_000 }, (_, index) => `line-${index}`).join('\n');
    const readChunk = vi.fn(async (start: number, length: number) => log.slice(start, start + length));

    const first = await pageLogLinesFromEnd({
      end: log.length,
      limit: 25,
      chunkSize: 128,
      readChunk,
    });

    expect(first.lines).toHaveLength(25);
    expect(first.lines[0]).toBe('line-4975');
    expect(first.lines[24]).toBe('line-4999');
    expect(first.nextEnd).not.toBeNull();
    expect(readChunk.mock.calls.every(([, length]) => length <= 128)).toBe(true);
    expect(readChunk).not.toHaveBeenCalledWith(0, log.length);

    const second = await pageLogLinesFromEnd({
      end: first.nextEnd!,
      limit: 25,
      chunkSize: 128,
      readChunk,
    });
    expect(second.lines[0]).toBe('line-4950');
    expect(second.lines[24]).toBe('line-4974');
  });

  it('bounds an unbroken log line and leaves a cursor for the remainder', async () => {
    const log = 'x'.repeat(256 * 1024);
    const readChunk = vi.fn(async (start: number, length: number) => log.slice(start, start + length));

    const page = await pageLogLinesFromEnd({
      end: log.length,
      limit: 25,
      chunkSize: 4 * 1024,
      readChunk,
    });

    expect(page.lines).toHaveLength(1);
    expect(page.lines[0]).toMatch(/^\[truncated\] /);
    expect(page.lines[0].length).toBeLessThanOrEqual(64 * 1024);
    expect(page.nextEnd).toBe(log.length - (64 * 1024 - '[truncated] '.length));
    expect(readChunk).toHaveBeenCalledTimes(16);
  });
});

describe('pageLegacyOutputRows', () => {
  it('returns only the requested slice with stable offset-aware ids', () => {
    const output = {
      scrapeList: {
        jobs: Array.from({ length: 250 }, (_, index) => ({ title: `Job ${index}` })),
      },
    };

    const page = pageLegacyOutputRows(output, undefined, 100, 100);

    expect(page.rows).toHaveLength(100);
    expect(page.rows[0].data).toEqual({ title: 'Job 100' });
    expect(page.rows[99].data).toEqual({ title: 'Job 199' });
    expect(page.rows[0].id).toBe('from-run-output-100');
    expect(page.rows[99].id).toBe('from-run-output-199');
    expect(page.nextOffset).toBe(200);
  });
});

describe('redactLogPage', () => {
  it('redacts per-run runtime secrets without loading the full log', () => {
    const secret = 'runtime-secret-value';
    const run = {
      interpreterSettings: {
        runtimeConfig: {
          destinations: { webhook: { url: secret } },
        },
      },
    };

    expect(redactLogPage([`sending ${secret}`], run, {})).toEqual(['[REDACTED]']);
  });
});
