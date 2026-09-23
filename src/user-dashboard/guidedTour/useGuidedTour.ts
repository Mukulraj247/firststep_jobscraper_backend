import { createContext, useContext } from 'react';
import type { GuidedTourState, ScoutXTourId } from './types';

export type GuidedTourContextType = {
  state: GuidedTourState;
  startTour: (tourId: ScoutXTourId) => void;
  stopTour: () => void;
  openSelector: () => void;
  closeSelector: () => void;
  resetAllTours: () => void;
};

export const GuidedTourContext = createContext<GuidedTourContextType | undefined>(undefined);

export function useGuidedTour(): GuidedTourContextType {
  const ctx = useContext(GuidedTourContext);
  if (!ctx) {
    throw new Error('useGuidedTour must be used within GuidedTourProvider');
  }
  return ctx;
}
