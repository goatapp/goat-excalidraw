import React from "react";
import type { Comment } from "../api";

type AppState = {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
};

type Props = {
  comments: Comment[];
  appState: AppState | null;
  activeCommentId: string | null;
  onPinClick: (commentId: string) => void;
};

function sceneCoordsToViewport(
  sceneX: number,
  sceneY: number,
  appState: AppState
): { x: number; y: number } {
  const zoom = appState.zoom.value;
  return {
    x: (sceneX + appState.scrollX) * zoom,
    y: (sceneY + appState.scrollY) * zoom,
  };
}

export const CommentPinOverlay: React.FC<Props> = ({
  comments,
  appState,
  activeCommentId,
  onPinClick,
}) => {
  if (!appState) return null;

  const anchored = comments.filter(
    (c) => c.anchorX != null && c.anchorY != null && !c.parentId
  );

  if (anchored.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 50 }}
    >
      {anchored.map((comment) => {
        const { x, y } = sceneCoordsToViewport(
          comment.anchorX!,
          comment.anchorY!,
          appState
        );

        const isActive = activeCommentId === comment.id;
        const initials = comment.user.name
          .split(/\s+/)
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();

        return (
          <button
            key={comment.id}
            onClick={(e) => {
              e.stopPropagation();
              onPinClick(comment.id);
            }}
            className={`absolute pointer-events-auto transition-all duration-150 -translate-x-1/2 -translate-y-1/2 ${
              isActive ? "scale-125 z-10" : "hover:scale-110"
            }`}
            style={{ left: x, top: y }}
            title={`${comment.user.name}: ${comment.body.slice(0, 50)}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-md border-2 transition-colors ${
                comment.resolved
                  ? "border-green-400 dark:border-green-500 opacity-60"
                  : isActive
                  ? "border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-300 dark:ring-indigo-600"
                  : "border-white dark:border-neutral-800"
              }`}
              style={{ backgroundColor: "#6366f1" }}
            >
              {initials}
            </div>
          </button>
        );
      })}
    </div>
  );
};
