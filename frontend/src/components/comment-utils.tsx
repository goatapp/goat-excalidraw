import React from "react";
import { replaceEmojiShortcodes } from "./emoji-shortcodes";

export function displayBody(body: string): string {
  return body.replace(/@\[([^\]]+)\]/g, "@$1");
}

export function encodeMentions(
  text: string,
  userNames: string[]
): string {
  const sorted = [...userNames].sort((a, b) => b.length - a.length);
  let result = text;
  for (const name of sorted) {
    result = result.replaceAll(`@${name}`, `@[${name}]`);
  }
  return result;
}

export function renderBody(body: string): React.ReactNode {
  const resolved = replaceEmojiShortcodes(body, 0).text;
  const parts = resolved.split(/(@\[[^\]]+\])/g);
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
