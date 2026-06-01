import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a stable function whose identity never changes but which always
 * invokes the latest `callback`. Lets us reference handlers from timers /
 * effects without re-subscribing or capturing stale state.
 */
export function useCallbackRef<A extends unknown[], R>(
  callback: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
