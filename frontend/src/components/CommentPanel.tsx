import React, { useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import * as api from "../api";
import { renderBody } from "./comment-utils";

type ContentProps = {
  comments: api.Comment[];
  onSelectComment: (commentId: string) => void;
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const CommentPanelContent: React.FC<ContentProps> = ({
  comments,
  onSelectComment,
}) => {
  const [sortBy, setSortBy] = useState<"date" | "unresolved">("date");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery.trim()
    ? comments.filter((c) => {
        const q = searchQuery.toLowerCase();
        return (
          c.body.toLowerCase().includes(q) ||
          c.user.name.toLowerCase().includes(q)
        );
      })
    : comments;

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "unresolved") {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="flex flex-col h-full">
      {/* Sort controls */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100 dark:border-neutral-800">
        <button
          onClick={() => setSortBy("date")}
          className={`text-xs px-2 py-1 rounded-md transition-colors ${
            sortBy === "date"
              ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold"
              : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          }`}
        >
          Sort by date
        </button>
        <button
          onClick={() => setSortBy("unresolved")}
          className={`text-xs px-2 py-1 rounded-md transition-colors ${
            sortBy === "unresolved"
              ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold"
              : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          }`}
        >
          Sort by unresolved
        </button>
      </div>

      {/* Search */}
      {comments.length > 0 && (
        <div className="px-4 py-2 border-b border-neutral-100 dark:border-neutral-800">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search comments..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto p-3">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-neutral-400 gap-2">
            <MessageCircle size={32} />
            <span className="text-sm font-medium">No comments yet</span>
            <span className="text-xs text-center">
              Use comment mode to add a comment on the canvas.
            </span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-neutral-400 gap-2">
            <Search size={24} />
            <span className="text-sm font-medium">No matches</span>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((comment) => {
              const initials = comment.user.name
                .split(/\s+/)
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              return (
                <button
                  key={comment.id}
                  onClick={() => onSelectComment(comment.id)}
                  className={`w-full text-left rounded-xl border-2 p-3 transition-all duration-200 hover:border-indigo-300 dark:hover:border-indigo-600 ${
                    comment.resolved
                      ? "border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 opacity-70"
                      : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: "#6366f1" }}
                    >
                      {initials}
                    </div>
                    <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                      {comment.user.name}
                    </span>
                    <span className="text-xs text-neutral-400 dark:text-neutral-500 flex-shrink-0 ml-auto">
                      {timeAgo(comment.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2">
                    {renderBody(comment.body)}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    {comment.replyCount > 0 && (
                      <span className="text-xs text-indigo-500 dark:text-indigo-400 font-medium">
                        {comment.replyCount}{" "}
                        {comment.replyCount === 1 ? "reply" : "replies"}
                      </span>
                    )}
                    {comment.reactions.length > 0 && (
                      <span className="text-xs text-neutral-400">
                        {comment.reactions.map((r) => r.emoji).join("")}
                      </span>
                    )}
                    {comment.resolved && (
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium ml-auto">
                        Resolved
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

