import { WorkflowFile } from 'maxun-core';
import { decrypt } from './auth';
import logger from '../logger';

/** Deep-clone plain JSON-compatible values without the stringify round-trip cost when possible. */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through for values structuredClone cannot handle.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Adds a generated flag action for possible pausing during interpretation.
 */
export function addGeneratedFlags(workflow: WorkflowFile): WorkflowFile {
  const copy = deepClone(workflow);
  for (let i = 0; i < workflow.workflow.length; i++) {
    copy.workflow[i].what.unshift({
      action: 'flag',
      args: ['generated'],
    });
  }
  return copy;
}

/** @deprecated Prefer addGeneratedFlags — kept as alias for call sites using PascalCase. */
export const AddGeneratedFlags = addGeneratedFlags;

/**
 * Decrypts encrypted type/press inputs. Optionally caps scrapeList limit to 5.
 */
export function processWorkflowActions(workflowPairs: any[], checkLimit: boolean = false): any[] {
  const processedWorkflow = deepClone(workflowPairs);

  processedWorkflow.forEach((pair: any) => {
    if (!pair?.what) return;
    pair.what.forEach((action: any) => {
      if (action.action === 'scrapeList' && checkLimit && Array.isArray(action.args) && action.args.length > 0) {
        const scrapeConfig = action.args[0];
        if (scrapeConfig && typeof scrapeConfig === 'object' && 'limit' in scrapeConfig) {
          if (typeof scrapeConfig.limit === 'number' && scrapeConfig.limit > 5) {
            scrapeConfig.limit = 5;
          }
        }
      }

      if ((action.action === 'type' || action.action === 'press') && Array.isArray(action.args) && action.args.length > 1) {
        try {
          const encryptedValue = action.args[1];
          if (typeof encryptedValue === 'string') {
            action.args[1] = decrypt(encryptedValue);
          } else {
            logger.log('error', 'Encrypted value is not a string');
            action.args[1] = '';
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.log('error', `Failed to decrypt input value: ${errorMessage}`);
          action.args[1] = '';
        }
      }
    });
  });

  return processedWorkflow;
}

export function processWorkflowFile(workflow: WorkflowFile, checkLimit: boolean = false): WorkflowFile {
  return {
    ...workflow,
    workflow: processWorkflowActions(workflow.workflow as any[], checkLimit),
  };
}
