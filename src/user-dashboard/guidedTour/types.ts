import type { Step } from 'react-joyride';

export type ScoutXTourId = 'home-overview' | 'browse-clusters' | 'my-feed';

export type ScoutXTourConfig = {
  id: ScoutXTourId;
  label: string;
  description: string;
  /** MUI icon name key resolved in the selector */
  icon: 'home' | 'explore' | 'feed';
  route: string | null;
  steps: Step[];
};

export type GuidedTourState = {
  activeTourId: ScoutXTourId | null;
  stepIndex: number;
  isRunning: boolean;
  isSelectorOpen: boolean;
  completedTours: ScoutXTourId[];
};

export type GuidedTourAction =
  | { type: 'START_TOUR'; tourId: ScoutXTourId }
  | { type: 'STOP_TOUR' }
  | { type: 'SET_STEP_INDEX'; index: number }
  | { type: 'COMPLETE_TOUR'; tourId: ScoutXTourId }
  | { type: 'OPEN_SELECTOR' }
  | { type: 'CLOSE_SELECTOR' }
  | { type: 'RESET_ALL_TOURS' }
  | { type: 'LOAD_COMPLETED'; completed: ScoutXTourId[] };
