import { useState, useEffect, useCallback } from 'react';
import { MSG } from '../../shared/messages';
import { buildEmptyState, type ExtensionState } from '../../shared/types';

/**
 * Hook that subscribes to extension state changes via chrome.storage.
 */
export function useExtensionState() {
  const [state, setState] = useState<ExtensionState>(buildEmptyState());
  const [loading, setLoading] = useState(true);

  // Load initial state with timeout safety
  useEffect(() => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn('GET_STATE timed out, falling back to empty state');
        setLoading(false);
      }
    }, 2000);

    try {
      chrome.runtime.sendMessage({ type: MSG.GET_STATE }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.warn('GET_STATE error:', chrome.runtime.lastError.message);
        } else if (response?.ok && response.state) {
          setState(response.state);
        }
        setLoading(false);
      });
    } catch (err) {
      settled = true;
      clearTimeout(timeout);
      console.error('sendMessage failed:', err);
      setLoading(false);
    }

    return () => clearTimeout(timeout);
  }, []);

  // Subscribe to storage changes
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.maxunExtensionState) {
        setState(changes.maxunExtensionState.newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return { state, loading };
}

/**
 * Hook for sending messages to the background.
 */
export function useSendMessage() {
  return useCallback((type: string, payload?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          const err: any = new Error(response?.error || 'Request failed');
          if (response?.code) err.code = response.code;
          if (response?.automation) err.automation = response.automation;
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }, []);
}
