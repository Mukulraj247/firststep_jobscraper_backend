import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import { afterEach, expect } from 'vitest';

// vitest-axe 0.1.x only augments the legacy `Vi` global namespace, which Vitest 2
// no longer reads, so `toHaveNoViolations` needs re-declaring on the module type.
declare module 'vitest' {
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

expect.extend(axeMatchers);

afterEach(() => {
  cleanup();
});
