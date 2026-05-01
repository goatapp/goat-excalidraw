import React, { useCallback, useRef, useState } from "react";
import { Send, Smile, AtSign } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";

type Props = {
  onSubmit: (body: string) => Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
  users?: { id: string; name: string }[];
};

export const CommentInput: React.FC<Props> = ({
  onSubmit,
  placeholder = "Add a comment...",
  autoFocus = false,
  users,
}) => {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setShowEmoji(false);
      setShowMentions(false);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Auto-resize
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }

    // Check for @mention trigger
    const cursorPos = ta?.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAt = textBeforeCursor.lastIndexOf("@");
    if (lastAt >= 0) {
      const textAfterAt = textBeforeCursor.slice(lastAt + 1);
      if (!/\s/.test(textAfterAt) && textAfterAt.length < 30) {
        setShowMentions(true);
        setMentionFilter(textAfterAt.toLowerCase());
        return;
      }
    }
    setShowMentions(false);
  };

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    setShowEmoji(false);
    textareaRef.current?.focus();
  };

  const insertMention = (user: { id: string; name: string }) => {
    const ta = textareaRef.current;
    const cursorPos = ta?.selectionStart ?? text.length;
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAt = textBeforeCursor.lastIndexOf("@");
    if (lastAt >= 0) {
      const before = text.slice(0, lastAt);
      const after = text.slice(cursorPos);
      setText(`${before}@${user.name} ${after}`);
    }
    setShowMentions(false);
    ta?.focus();
  };

  const filteredUsers = users?.filter((u) =>
    u.name.toLowerCase().includes(mentionFilter)
  );

  return (
    <div className="relative">
      <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 focus-within:border-indigo-400 dark:focus-within:border-indigo-500 transition-colors">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={1}
          className="w-full px-3 py-2 text-sm bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 resize-none outline-none"
        />
        <div className="flex items-center justify-between px-2 pb-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setShowEmoji(!showEmoji);
                setShowMentions(false);
              }}
              className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              <Smile size={16} />
            </button>
            {users && users.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowMentions(!showMentions);
                  setShowEmoji(false);
                  setMentionFilter("");
                }}
                className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
              >
                <AtSign size={16} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="p-1 rounded text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {showEmoji && (
        <div className="absolute bottom-full left-0 mb-2 z-50">
          <EmojiPicker
            onSelect={insertEmoji}
            onClose={() => setShowEmoji(false)}
          />
        </div>
      )}

      {showMentions && filteredUsers && filteredUsers.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-56 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {filteredUsers.map((user) => (
            <button
              key={user.id}
              onClick={() => insertMention(user)}
              className="w-full text-left px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
            >
              @{user.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
