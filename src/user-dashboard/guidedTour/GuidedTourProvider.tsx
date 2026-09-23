import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ACTIONS,
  EVENTS,
  Joyride,
  STATUS,
  type Controls,
  type EventData,
  type Step,
} from 'react-joyride';
import { useLocation, useNavigate } from 'react-router-dom';
import { scoutXTourConfigs } from './tourConfigs';
import { TourTooltip } from './TourTooltip';
import type { GuidedTourAction, GuidedTourState, ScoutXTourId } from './types';
import { GuidedTourContext } from './useGuidedTour';

const STORAGE_KEY = 'scoutx_guided_tours_completed';

function normalizePath(path: string): string {
  if (!path || path === '/') return path || '/';
  return path.replace(/\/+$/, '') || '/';
}

function isVisible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.offsetParent !== null) return true;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

const loadCompleted = (): ScoutXTourId[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as ScoutXTourId[]) : [];
  } catch {
    return [];
  }
};

const saveCompleted = (completed: ScoutXTourId[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  } catch {
    // ignore
  }
};

const initialState: GuidedTourState = {
  activeTourId: null,
  stepIndex: 0,
  isRunning: false,
  isSelectorOpen: false,
  completedTours: [],
};

function reducer(state: GuidedTourState, action: GuidedTourAction): GuidedTourState {
  switch (action.type) {
    case 'START_TOUR':
      return {
        ...state,
        activeTourId: action.tourId,
        stepIndex: 0,
        isRunning: true,
        isSelectorOpen: false,
      };
    case 'STOP_TOUR':
      return { ...state, activeTourId: null, stepIndex: 0, isRunning: false };
    case 'SET_STEP_INDEX':
      return { ...state, stepIndex: action.index };
    case 'COMPLETE_TOUR': {
      const completed = state.completedTours.includes(action.tourId)
        ? state.completedTours
        : [...state.completedTours, action.tourId];
      saveCompleted(completed);
      return {
        ...state,
        activeTourId: null,
        stepIndex: 0,
        isRunning: false,
        completedTours: completed,
      };
    }
    case 'OPEN_SELECTOR':
      return { ...state, isSelectorOpen: true };
    case 'CLOSE_SELECTOR':
      return { ...state, isSelectorOpen: false };
    case 'RESET_ALL_TOURS':
      saveCompleted([]);
      return { ...state, completedTours: [] };
    case 'LOAD_COMPLETED':
      return { ...state, completedTours: action.completed };
    default:
      return state;
  }
}

function waitForTarget(selector: string, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (isVisible(document.querySelector(selector))) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      window.requestAnimationFrame(tick);
    };
    tick();
  });
}

export function GuidedTourProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const navigate = useNavigate();
  const location = useLocation();
  const pendingTourRef = useRef<ScoutXTourId | null>(null);
  const runIdRef = useRef(0);
  const activeTourIdRef = useRef(state.activeTourId);
  activeTourIdRef.current = state.activeTourId;

  useEffect(() => {
    dispatch({ type: 'LOAD_COMPLETED', completed: loadCompleted() });
  }, []);

  const activeTourConfig = useMemo(
    () => scoutXTourConfigs.find((t) => t.id === state.activeTourId) ?? null,
    [state.activeTourId],
  );

  const beginTour = useCallback(async (tourId: ScoutXTourId) => {
    const config = scoutXTourConfigs.find((t) => t.id === tourId);
    if (!config) return;
    const firstTarget =
      typeof config.steps[0]?.target === 'string' ? config.steps[0].target : null;
    if (firstTarget) {
      await waitForTarget(firstTarget, 3000);
    } else {
      await new Promise((r) => setTimeout(r, 150));
    }
    runIdRef.current += 1;
    dispatch({ type: 'START_TOUR', tourId });
  }, []);

  const startTour = useCallback(
    (tourId: ScoutXTourId) => {
      const config = scoutXTourConfigs.find((t) => t.id === tourId);
      if (!config) return;

      const route = config.route ? normalizePath(config.route) : null;
      const here = normalizePath(location.pathname);

      if (route && here !== route) {
        pendingTourRef.current = tourId;
        navigate(config.route!);
        return;
      }

      pendingTourRef.current = null;
      void beginTour(tourId);
    },
    [beginTour, location.pathname, navigate],
  );

  useEffect(() => {
    const pending = pendingTourRef.current;
    if (!pending) return;
    const config = scoutXTourConfigs.find((t) => t.id === pending);
    if (!config?.route) return;
    if (normalizePath(location.pathname) !== normalizePath(config.route)) return;

    const timer = window.setTimeout(() => {
      pendingTourRef.current = null;
      void beginTour(pending);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [location.pathname, beginTour]);

  const stopTour = useCallback(() => dispatch({ type: 'STOP_TOUR' }), []);
  const openSelector = useCallback(() => dispatch({ type: 'OPEN_SELECTOR' }), []);
  const closeSelector = useCallback(() => dispatch({ type: 'CLOSE_SELECTOR' }), []);
  const resetAllTours = useCallback(() => dispatch({ type: 'RESET_ALL_TOURS' }), []);

  const handleJoyrideEvent = useCallback((data: EventData, _controls: Controls) => {
    const { action, index, status, type } = data;
    const tourId = activeTourIdRef.current;
    const config = tourId ? scoutXTourConfigs.find((t) => t.id === tourId) : null;
    const stepCount = config?.steps.length ?? 0;

    if (status === STATUS.SKIPPED || action === ACTIONS.SKIP) {
      dispatch({ type: 'STOP_TOUR' });
      return;
    }

    if (status === STATUS.FINISHED) {
      if (tourId) dispatch({ type: 'COMPLETE_TOUR', tourId });
      return;
    }

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const delta = action === ACTIONS.PREV ? -1 : 1;
      const nextIndex = index + delta;

      if (nextIndex < 0) {
        dispatch({ type: 'SET_STEP_INDEX', index: 0 });
        return;
      }

      if (nextIndex >= stepCount) {
        if (tourId) dispatch({ type: 'COMPLETE_TOUR', tourId });
        return;
      }

      dispatch({ type: 'SET_STEP_INDEX', index: nextIndex });
    }
  }, []);

  const contextValue = useMemo(
    () => ({ state, startTour, stopTour, openSelector, closeSelector, resetAllTours }),
    [state, startTour, stopTour, openSelector, closeSelector, resetAllTours],
  );

  const resolvedSteps: Step[] = useMemo(() => {
    if (!activeTourConfig) return [];
    return activeTourConfig.steps;
  }, [activeTourConfig]);

  return (
    <GuidedTourContext.Provider value={contextValue}>
      {children}
      {activeTourConfig ? (
        <Joyride
          key={`scoutx-tour-${state.activeTourId}-${runIdRef.current}`}
          steps={resolvedSteps}
          stepIndex={state.stepIndex}
          run={state.isRunning}
          continuous
          scrollToFirstStep
          tooltipComponent={TourTooltip}
          onEvent={handleJoyrideEvent}
          options={{
            zIndex: 15000,
            arrowColor: '#ffffff',
            overlayColor: 'rgba(0, 0, 0, 0.5)',
            primaryColor: '#023345',
            skipBeacon: true,
            overlayClickAction: false,
            scrollOffset: 96,
            closeButtonAction: 'skip',
            targetWaitTimeout: 2500,
            buttons: ['back', 'close', 'primary'],
          }}
          floatingOptions={{
            strategy: 'fixed',
            hideArrow: false,
          }}
        />
      ) : null}
    </GuidedTourContext.Provider>
  );
}
