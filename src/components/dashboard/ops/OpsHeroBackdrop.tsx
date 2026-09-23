import React from 'react';

/** Decorative backdrop disabled — keep First Step–style plain headers. */
export function OpsHeroBackdrop({ children }: { children?: React.ReactNode }) {
  return <>{children ?? null}</>;
}
