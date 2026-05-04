import React, { useEffect, useRef } from "react";
import { SHORTCODES } from "./emoji-shortcodes";

const EMOJI_GROUPS = [
  { label: "Faces", emojis: ["😀", "😂", "😊", "😍", "😉", "😛", "🤔", "😮", "😢", "😡"] },
  { label: "Gestures", emojis: ["👍", "👎", "🙏", "👀"] },
  { label: "Reactions", emojis: ["❤️", "🎉", "🔥", "💯", "✅"] },
  { label: "Objects", emojis: ["⭐", "💡", "⚡", "🚀", "🐛", "🎨", "📌", "🐐"] },
];

const emojiToShortcode: Record<string, string> = {};
for (const [code, emoji] of Object.entries(SHORTCODES)) {
  if (!emojiToShortcode[emoji]) {
    emojiToShortcode[emoji] = code;
  }
}

type Props = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

export const EmojiPicker: React.FC<Props> = ({ onSelect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg p-2 pb-4 w-64 overflow-visible"
    >
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="mb-1">
          <div className="text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider px-1 mb-0.5">
            {group.label}
          </div>
          <div className="flex flex-wrap gap-0.5 overflow-visible">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onSelect(emoji)}
                title={emojiToShortcode[emoji] ?? undefined}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-lg transition-colors relative group/emoji"
              >
                {emoji}
                {emojiToShortcode[emoji] && (
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[9px] font-mono bg-neutral-800 dark:bg-neutral-600 text-white rounded opacity-0 group-hover/emoji:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    {emojiToShortcode[emoji]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
