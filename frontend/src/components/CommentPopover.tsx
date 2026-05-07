import React, { useCallback, useEffect, useRef, useState } from "react";
import { renderBody, displayBody, encodeMentions } from "./comment-utils";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  Link2,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Pencil,
  Trash2,
  Smile,
} from "lucide-react";
import * as api from "../api";
import { CommentInput } from "./CommentInput";
import { EmojiPicker } from "./EmojiPicker";

type Props = {
  comment: api.Comment;
  drawingId: string;
  currentUserId: string | null;
  canEdit: boolean;
  isOwner: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onCommentUpdated: (comment: api.Comment) => void;
  onCommentDeleted: (commentId: string) => void;
  onReplyAdded: (parentId: string) => void;
  onNavigate?: (direction: "prev" | "next") => void;
  onCommentMoved?: (commentId: string, anchorX: number, anchorY: number) => void;
  appState?: { scrollX: number; scrollY: number; zoom: { value: number } };
  navIndex?: number;
  navTotal?: number;
  users?: { id: string; name: string }[];
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


export const CommentPopover: React.FC<Props> = ({
  comment,
  drawingId,
  currentUserId,
  canEdit,
  isOwner,
  position,
  onClose,
  onCommentUpdated,
  onCommentDeleted,
  onReplyAdded,
  onNavigate,
  onCommentMoved,
  appState,
  navIndex,
  navTotal,
  users,
}) => {
  const [replies, setReplies] = useState<api.Comment[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(
    null
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const menuBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const reactionBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const rafRef = useRef<number>(0);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    const el = popoverRef.current;
    if (!el) return;
    el.style.willChange = "transform";
    el.style.transition = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    };

    const handleMouseUp = (ev: MouseEvent) => {
      cancelAnimationFrame(rafRef.current);
      if (dragRef.current && onCommentMoved && appState && comment.anchorX != null && comment.anchorY != null) {
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          const zoom = appState.zoom.value;
          onCommentMoved(
            comment.id,
            comment.anchorX + dx / zoom,
            comment.anchorY + dy / zoom
          );
        }
      }
      el.style.transform = "";
      el.style.willChange = "";
      el.style.transition = "";
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [onCommentMoved, appState, comment.id, comment.anchorX, comment.anchorY]);

  const openMenu = (commentId: string) => {
    if (showMenu === commentId) {
      setShowMenu(null);
      setMenuPos(null);
      return;
    }
    const btn = menuBtnRefs.current.get(commentId);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 120 });
    }
    setShowMenu(commentId);
  };

  const menuDropdownRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setShowMenu(null);
    setMenuPos(null);
  };

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      const btn = menuBtnRefs.current.get(showMenu);
      if (btn?.contains(e.target as Node)) return;
      if (menuDropdownRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  const loadReplies = useCallback(async () => {
    if (comment.replyCount === 0) return;
    setLoadingReplies(true);
    try {
      const data = await api.getCommentReplies(drawingId, comment.id);
      setReplies(data.replies);
    } catch {
      // ignore
    } finally {
      setLoadingReplies(false);
    }
  }, [drawingId, comment.id, comment.replyCount]);

  useEffect(() => {
    loadReplies();
  }, [loadReplies]);

  const handleResolve = async () => {
    try {
      const { comment: updated } = await api.resolveComment(
        drawingId,
        comment.id
      );
      onCommentUpdated({ ...comment, resolved: updated.resolved });
    } catch {
      // ignore
    }
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?comment=${comment.id}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleDelete = async (commentId: string) => {
    try {
      await api.deleteComment(drawingId, commentId);
      if (commentId === comment.id) {
        onCommentDeleted(commentId);
      } else {
        setReplies((prev) => prev.filter((r) => r.id !== commentId));
        onReplyAdded(comment.id);
      }
    } catch {
      // ignore
    }
    setShowMenu(null);
  };

  const handleEdit = async (commentId: string, body: string) => {
    if (!body.trim()) return;
    try {
      const { comment: updated } = await api.updateComment(
        drawingId,
        commentId,
        { body: encodeMentions(body.trim(), users?.map((u) => u.name) ?? []) }
      );
      if (commentId === comment.id) {
        onCommentUpdated({ ...comment, body: updated.body });
      } else {
        setReplies((prev) =>
          prev.map((r) => (r.id === commentId ? { ...r, body: updated.body } : r))
        );
      }
    } catch {
      // ignore
    }
    setEditingId(null);
  };

  const handleReply = async (body: string) => {
    try {
      const { comment: newReply } = await api.createComment(drawingId, {
        body,
        parentId: comment.id,
      });
      setReplies((prev) => [...prev, newReply]);
      onReplyAdded(comment.id);
    } catch {
      // ignore
    }
  };

  const handleReaction = async (commentId: string, emoji: string) => {
    try {
      const target =
        commentId === comment.id
          ? comment
          : replies.find((r) => r.id === commentId);
      if (!target) return;

      const existing = target.reactions.find(
        (r) => r.emoji === emoji && r.userReacted
      );

      if (existing) {
        await api.removeReaction(drawingId, commentId, emoji);
      } else {
        await api.addReaction(drawingId, commentId, emoji);
      }

      const updateReactions = (c: api.Comment) => {
        const reactions = [...c.reactions];
        const idx = reactions.findIndex((r) => r.emoji === emoji);
        if (existing) {
          if (idx >= 0) {
            reactions[idx] = {
              ...reactions[idx],
              count: reactions[idx].count - 1,
              userReacted: false,
            };
            if (reactions[idx].count <= 0) reactions.splice(idx, 1);
          }
        } else {
          if (idx >= 0) {
            reactions[idx] = {
              ...reactions[idx],
              count: reactions[idx].count + 1,
              userReacted: true,
            };
          } else {
            reactions.push({ emoji, count: 1, userReacted: true });
          }
        }
        return reactions;
      };

      if (commentId === comment.id) {
        onCommentUpdated({ ...comment, reactions: updateReactions(comment) });
      } else {
        setReplies((prev) =>
          prev.map((r) =>
            r.id === commentId ? { ...r, reactions: updateReactions(r) } : r
          )
        );
      }
    } catch {
      // ignore
    }
    setShowReactionPicker(null);
  };

  const renderComment = (c: api.Comment, isTopLevel: boolean) => {
    const canDeleteThis =
      currentUserId === c.user.id || (isOwner && isTopLevel);
    const canEditThis = currentUserId === c.user.id;

    return (
      <div key={c.id} className={`${isTopLevel ? "" : "pl-0 pt-3 border-t border-neutral-100 dark:border-neutral-700/50"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
              style={{ backgroundColor: "#6366f1" }}
            >
              {c.user.name
                .split(/\s+/)
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {c.user.name}
            </span>
            <span className="text-xs text-neutral-400 dark:text-neutral-500 flex-shrink-0">
              {timeAgo(c.createdAt)}
            </span>
          </div>
          {(canEditThis || canDeleteThis) && (
            <div className="flex-shrink-0">
              <button
                ref={(el) => { if (el) menuBtnRefs.current.set(c.id, el); }}
                onClick={() => openMenu(c.id)}
                className="p-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400 transition-colors"
              >
                <MoreVertical size={14} />
              </button>
              {showMenu === c.id && menuPos && createPortal(
                <div
                  ref={menuDropdownRef}
                  className="fixed z-[200] bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1 min-w-[120px]"
                  style={{ top: menuPos.top, left: menuPos.left }}
                >
                  {canEditThis && (
                    <button
                      onClick={() => {
                        setEditingId(c.id);
                        closeMenu();
                      }}
                      className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300"
                    >
                      <Pencil size={13} /> Edit
                    </button>
                  )}
                  {canDeleteThis && (
                    <button
                      onClick={() => { handleDelete(c.id); closeMenu(); }}
                      className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-red-600 dark:text-red-400"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>,
                document.body
              )}
            </div>
          )}
        </div>

        <div className="mt-1.5 text-sm text-neutral-700 dark:text-neutral-300">
          {editingId === c.id ? (
            <CommentInput
              onSubmit={async (body) => { await handleEdit(c.id, body); }}
              onCancel={() => setEditingId(null)}
              initialValue={displayBody(c.body)}
              autoFocus
              users={users}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words">
              {renderBody(c.body)}
            </p>
          )}
        </div>

        {/* Reactions */}
        {(c.reactions.length > 0 || currentUserId) && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {c.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => handleReaction(c.id, r.emoji)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                  r.userReacted
                    ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
                    : "bg-neutral-50 dark:bg-neutral-700 border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-600"
                }`}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
            {currentUserId && (
              <>
                <button
                  ref={(el) => { if (el) reactionBtnRefs.current.set(c.id, el); }}
                  onClick={() =>
                    setShowReactionPicker(
                      showReactionPicker === c.id ? null : c.id
                    )
                  }
                  className="p-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400 transition-colors"
                >
                  <Smile size={14} />
                </button>
                {showReactionPicker === c.id && createPortal(
                  <div
                    className="fixed z-[300]"
                    style={(() => {
                      const btn = reactionBtnRefs.current.get(c.id);
                      if (!btn) return {};
                      const rect = btn.getBoundingClientRect();
                      return { left: rect.left, bottom: window.innerHeight - rect.top + 4 };
                    })()}
                  >
                    <EmojiPicker
                      onSelect={(emoji) => handleReaction(c.id, emoji)}
                      onClose={() => setShowReactionPicker(null)}
                    />
                  </div>,
                  document.body
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-[80]"
      style={{
        left: position.x + 20,
        top: position.y - 10,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-80 bg-white dark:bg-neutral-900 border-2 border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl">
        {/* Header */}
        <div
          className="flex items-center gap-1 px-3 pt-2 cursor-grab active:cursor-grabbing"
          onMouseDown={handleDragStart}
        >
          {onNavigate && navTotal != null && navTotal > 1 && (
            <div className="flex items-center gap-0.5 mr-auto">
              <button
                onClick={() => onNavigate("prev")}
                className="p-0.5 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                title="Previous comment"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => onNavigate("next")}
                className="p-0.5 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                title="Next comment"
              >
                <ChevronRight size={16} />
              </button>
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500 ml-1 tabular-nums">
                {navIndex != null ? navIndex + 1 : "?"}/{navTotal}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 ml-auto">
          {canEdit && (
            <button
              onClick={handleResolve}
              className={`p-1 rounded transition-colors ${
                comment.resolved
                  ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
                  : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
              title={comment.resolved ? "Unresolve" : "Resolve"}
            >
              <Check size={16} />
            </button>
          )}
          <button
            onClick={handleCopyLink}
            className={`p-1 rounded transition-colors ${
              linkCopied
                ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20"
                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            }`}
            title={linkCopied ? "Copied!" : "Copy link"}
          >
            {linkCopied ? <ClipboardCheck size={16} /> : <Link2 size={16} />}
          </button>
          {(currentUserId === comment.user.id || isOwner) && (
            <button
              onClick={() => handleDelete(comment.id)}
              className="p-1 rounded text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title="Delete comment"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          >
            <X size={16} />
          </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-3 pb-2 max-h-80 overflow-y-auto">
          {renderComment(comment, true)}

          {/* Replies */}
          {loadingReplies && (
            <div className="pt-3 text-xs text-neutral-400">
              Loading replies...
            </div>
          )}
          {replies.map((r) => renderComment(r, false))}
        </div>

        {/* Reply input */}
        {currentUserId && (
          <div className="px-3 pb-3">
            <CommentInput
              onSubmit={handleReply}
              placeholder="Reply, @mention someone..."
              users={users}
            />
          </div>
        )}
      </div>
    </div>
  );
};
