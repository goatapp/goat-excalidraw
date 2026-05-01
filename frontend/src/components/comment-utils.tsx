import React from "react";

export function renderBody(body: string): React.ReactNode {
  const parts = body.split(/(@\[[^\]]+\])/g);
  return parts.map((part, i) =>
    part.startsWith("@[") ? (
      <span
        key={i}
        className="text-indigo-500 dark:text-indigo-400 font-medium bg-indigo-50 dark:bg-indigo-900/30 px-0.5 rounded"
      >
        @{part.slice(2, -1)}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
