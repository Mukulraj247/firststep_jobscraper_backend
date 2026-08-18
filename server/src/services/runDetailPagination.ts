import { AutomationRuntimeConfig, extractRowsFromOutput } from './automation';
import { toPublicRunDto } from './automationConfigView';

type ExtractedRow = {
  id?: string;
  source: string;
  data: Record<string, any>;
};

export const redactLogPage = (lines: string[], run: any, robot: any): string[] => {
  if (lines.length === 0) return [];
  const redacted = toPublicRunDto(
    { ...run, log: lines.join('\n') },
    robot,
    { detail: true }
  );
  return typeof redacted.log === 'string' ? redacted.log.split('\n') : [];
};

type LogPageOptions = {
  end: number;
  limit: number;
  chunkSize?: number;
  readChunk: (start: number, length: number) => Promise<string>;
};

const MAX_LOG_LINE_LENGTH = 64 * 1024;
const TRUNCATED_LINE_PREFIX = '[truncated] ';
const MAX_TRUNCATED_LINE_CONTENT_LENGTH = MAX_LOG_LINE_LENGTH - TRUNCATED_LINE_PREFIX.length;

export const pageLogLinesFromEnd = async (
  options: LogPageOptions
): Promise<{ lines: string[]; nextEnd: number | null }> => {
  const limit = Math.max(1, Math.floor(options.limit));
  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? 64 * 1024));
  let scanEnd = Math.max(0, Math.floor(options.end));
  let pendingReversed: string[] = [];
  const newestFirst: string[] = [];

  const finishLine = () => {
    if (pendingReversed.length === 0) return false;
    newestFirst.push(pendingReversed.reverse().join(''));
    pendingReversed = [];
    return newestFirst.length >= limit;
  };

  while (scanEnd > 0) {
    const start = Math.max(0, scanEnd - chunkSize);
    const chunk = await options.readChunk(start, scanEnd - start);
    const characters = Array.from(chunk);

    for (let index = characters.length - 1; index >= 0; index -= 1) {
      if (characters[index] === '\n') {
        if (finishLine()) {
          return {
            lines: newestFirst.reverse(),
            nextEnd: start + index > 0 ? start + index : null,
          };
        }
      } else {
        pendingReversed.push(characters[index]);
        const nextEnd = start + index;
        if (pendingReversed.length >= MAX_TRUNCATED_LINE_CONTENT_LENGTH && nextEnd > 0) {
          newestFirst.push(`${TRUNCATED_LINE_PREFIX}${pendingReversed.reverse().join('')}`);
          return {
            lines: newestFirst.reverse(),
            nextEnd,
          };
        }
      }
    }

    scanEnd = start;
  }

  finishLine();
  return { lines: newestFirst.reverse(), nextEnd: null };
};

export const pageLegacyOutputRows = (
  serializableOutput: any,
  config: AutomationRuntimeConfig | undefined,
  offset: number,
  limit: number
): { rows: ExtractedRow[]; nextOffset: number | null } => {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(1, Math.floor(limit));
  const page = extractRowsFromOutput(serializableOutput, config).slice(
    safeOffset,
    safeOffset + safeLimit + 1
  );
  const hasMore = page.length > safeLimit;
  const rows = (hasMore ? page.slice(0, safeLimit) : page).map((row, index) => ({
    ...row,
    id: `from-run-output-${safeOffset + index}`,
  }));
  return {
    rows,
    nextOffset: hasMore ? safeOffset + safeLimit : null,
  };
};
