import React from 'react';

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Loading chunk') ||
    error.message.includes('Loading CSS chunk') ||
    error.message.includes('Unable to preload CSS')
  );
}

function ChunkLoadErrorFallback() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-neutral-950 flex items-center justify-center">
      <div className="text-center space-y-4 p-6">
        <p className="text-lg text-slate-700 dark:text-slate-300">
          A new version has been deployed. Please reload to continue.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return React.lazy(() =>
    factory().catch((error) => {
      if (isChunkLoadError(error)) {
        window.dispatchEvent(new CustomEvent('chunk-load-error'));
        return { default: ChunkLoadErrorFallback as unknown as T };
      }
      throw error;
    })
  );
}
