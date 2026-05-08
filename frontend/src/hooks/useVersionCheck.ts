import { useEffect, useRef } from 'react';

const POLL_INTERVAL_MS = 60_000;
const BUILD_VERSION = import.meta.env.VITE_APP_VERSION;

export function useVersionCheck(onNewVersion: () => void) {
  const callbackRef = useRef(onNewVersion);
  callbackRef.current = onNewVersion;

  const hasFiredRef = useRef(false);

  useEffect(() => {
    if (!BUILD_VERSION) return;

    const check = async () => {
      if (hasFiredRef.current) return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (version && version !== BUILD_VERSION) {
          hasFiredRef.current = true;
          callbackRef.current();
        }
      } catch {
        // Network error — will retry next interval
      }
    };

    const interval = setInterval(check, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
