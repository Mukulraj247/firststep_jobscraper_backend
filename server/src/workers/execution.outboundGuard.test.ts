import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('processRunExecution outbound guard disposal', () => {
  it('wraps the post-install path in try/finally so every return disposes the context route', () => {
    const src = fs.readFileSync(path.join(__dirname, 'execution.ts'), 'utf8');
    const installIdx = src.indexOf(
      'disposeOutboundGuard = await installOutboundBrowserContextGuard(currentPage.context())'
    );
    expect(installIdx).toBeGreaterThan(-1);

    const afterInstall = src.slice(installIdx);
    expect(afterInstall).toMatch(
      /disposeOutboundGuard = await installOutboundBrowserContextGuard\(currentPage\.context\(\)\);\s*try \{[\s\S]*?\}\s*finally \{\s*await disposeOutboundGuard\?\.\(\)\.catch\(\(\) => undefined\);\s*\}/
    );

    // Manual dispose on the success path must not remain; finally owns cleanup.
    expect(afterInstall).not.toMatch(
      /await triggerIntegrationUpdates\([^;]+;\s*await disposeOutboundGuard\?\.\(\)/
    );
  });
});
