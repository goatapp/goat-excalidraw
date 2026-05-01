import React, { useEffect, useRef } from "react";

const EMOJI_GROUPS = [
  { label: "Common", emojis: ["👍", "👎", "❤️", "😍", "🎉", "🔥", "💯", "✅"] },
  { label: "Faces", emojis: ["😀", "😂", "🤔", "😮", "😢", "😡", "🙏", "👀"] },
  { label: "Symbols", emojis: ["⭐", "💡", "⚡", "🚀", "🐛", "🎨", "📌", "🏷️"] },
];

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
      className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg p-2 w-64"
    >
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="mb-1">
          <div className="text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider px-1 mb-0.5">
            {group.label}
          </div>
          <div className="flex flex-wrap gap-0.5">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onSelect(emoji)}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-lg transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
