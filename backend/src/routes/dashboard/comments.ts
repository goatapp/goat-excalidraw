import express from "express";
import { z } from "zod";
import { DashboardRouteDeps } from "./types.js";
import {
  canEditDrawing,
  canViewDrawing,
  getDrawingAccess,
  isOwnerAccess,
  type DrawingPrincipal,
} from "../../authz/sharing.js";

const commentCreateSchema = z.object({
  body: z.string().min(1).max(2000),
  parentId: z.string().uuid().optional(),
  anchorX: z.number().optional(),
  anchorY: z.number().optional(),
});

const commentUpdateSchema = z.object({
  body: z.string().min(1).max(2000),
});

const reactionSchema = z.object({
  emoji: z.string().min(1).max(8),
});

export const registerCommentRoutes = (
  app: express.Express,
  deps: DashboardRouteDeps
) => {
  const { prisma, optionalAuth, asyncHandler, sanitizeText, io } = deps;

  const getRequestPrincipal = async (
    req: express.Request
  ): Promise<DrawingPrincipal | null> => {
    if (req.user?.id) {
      return { kind: "user", userId: req.user.id };
    }
    return null;
  };

  const respondWithAuthErrorIfPresent = (
    req: express.Request,
    res: express.Response
  ): boolean => {
    if (!req.authError) return false;
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired token",
    });
    return true;
  };

  // GET /drawings/:id/comments — list top-level comments
  app.get(
    "/drawings/:id/comments",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      const limit = Math.min(
        parseInt(req.query.limit as string) || 50,
        200
      );
      const offset = parseInt(req.query.offset as string) || 0;

      const [comments, totalCount] = await Promise.all([
        prisma.comment.findMany({
          where: { drawingId, parentId: null },
          include: {
            user: { select: { id: true, name: true, email: true } },
            reactions: {
              select: { emoji: true, userId: true },
            },
            _count: { select: { replies: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.comment.count({
          where: { drawingId, parentId: null },
        }),
      ]);

      const currentUserId = principal?.kind === "user" ? principal.userId : null;

      const mapped = comments.map((c) => {
        const reactionMap = new Map<
          string,
          { count: number; userReacted: boolean }
        >();
        for (const r of c.reactions) {
          const existing = reactionMap.get(r.emoji);
          if (existing) {
            existing.count++;
            if (r.userId === currentUserId) existing.userReacted = true;
          } else {
            reactionMap.set(r.emoji, {
              count: 1,
              userReacted: r.userId === currentUserId,
            });
          }
        }

        return {
          id: c.id,
          body: c.body,
          anchorX: c.anchorX,
          anchorY: c.anchorY,
          resolved: c.resolved,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          user: c.user,
          replyCount: c._count.replies,
          reactions: Array.from(reactionMap.entries()).map(
            ([emoji, data]) => ({
              emoji,
              count: data.count,
              userReacted: data.userReacted,
            })
          ),
        };
      });

      return res.json({ comments: mapped, totalCount });
    })
  );

  // GET /drawings/:id/comments/:commentId/replies
  app.get(
    "/drawings/:id/comments/:commentId/replies",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const commentId = req.params.commentId as string;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      const parent = await prisma.comment.findFirst({
        where: { id: commentId, drawingId, parentId: null },
      });
      if (!parent) {
        return res.status(404).json({ error: "Comment not found" });
      }

      const currentUserId =
        principal?.kind === "user" ? principal.userId : null;

      const replies = await prisma.comment.findMany({
        where: { parentId: commentId },
        include: {
          user: { select: { id: true, name: true, email: true } },
          reactions: {
            select: { emoji: true, userId: true },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const mapped = replies.map((r) => {
        const reactionMap = new Map<
          string,
          { count: number; userReacted: boolean }
        >();
        for (const reaction of r.reactions) {
          const existing = reactionMap.get(reaction.emoji);
          if (existing) {
            existing.count++;
            if (reaction.userId === currentUserId) existing.userReacted = true;
          } else {
            reactionMap.set(reaction.emoji, {
              count: 1,
              userReacted: reaction.userId === currentUserId,
            });
          }
        }

        return {
          id: r.id,
          body: r.body,
          parentId: r.parentId,
          resolved: r.resolved,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          user: r.user,
          reactions: Array.from(reactionMap.entries()).map(
            ([emoji, data]) => ({
              emoji,
              count: data.count,
              userReacted: data.userReacted,
            })
          ),
        };
      });

      return res.json({ replies: mapped });
    })
  );

  // POST /drawings/:id/comments — create comment or reply
  app.post(
    "/drawings/:id/comments",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      if (!principal || principal.kind !== "user") {
        return res
          .status(401)
          .json({ error: "Authentication required to comment" });
      }

      const parsed = commentCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid input", details: parsed.error.issues });
      }

      const { parentId, anchorX, anchorY } = parsed.data;
      const body = sanitizeText(parsed.data.body, 2000);

      if (parentId) {
        const parent = await prisma.comment.findFirst({
          where: { id: parentId, drawingId, parentId: null },
        });
        if (!parent) {
          return res
            .status(404)
            .json({ error: "Parent comment not found" });
        }
      }

      const comment = await prisma.comment.create({
        data: {
          drawingId,
          userId: principal.userId,
          parentId: parentId ?? null,
          body,
          anchorX: parentId ? null : (anchorX ?? null),
          anchorY: parentId ? null : (anchorY ?? null),
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      const responseComment = {
        ...comment,
        replyCount: 0,
        reactions: [],
      };

      io?.to(`drawing_${drawingId}`).emit("comment-added", {
        comment: responseComment,
      });

      return res.status(201).json({ comment: responseComment });
    })
  );

  // PUT /drawings/:id/comments/:commentId — edit comment body
  app.put(
    "/drawings/:id/comments/:commentId",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const commentId = req.params.commentId as string;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      const comment = await prisma.comment.findFirst({
        where: { id: commentId, drawingId },
      });
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      if (
        !principal ||
        principal.kind !== "user" ||
        principal.userId !== comment.userId
      ) {
        return res
          .status(403)
          .json({ error: "Only the author can edit this comment" });
      }

      const parsed = commentUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid input", details: parsed.error.issues });
      }

      const body = sanitizeText(parsed.data.body, 2000);

      const updated = await prisma.comment.update({
        where: { id: commentId },
        data: { body },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      io?.to(`drawing_${drawingId}`).emit("comment-updated", {
        comment: updated,
      });

      return res.json({ comment: updated });
    })
  );

  // DELETE /drawings/:id/comments/:commentId
  app.delete(
    "/drawings/:id/comments/:commentId",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const commentId = req.params.commentId as string;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      const comment = await prisma.comment.findFirst({
        where: { id: commentId, drawingId },
      });
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      const isAuthor =
        principal?.kind === "user" &&
        principal.userId === comment.userId;
      if (!isAuthor && !isOwnerAccess(access)) {
        return res
          .status(403)
          .json({ error: "Only the author or drawing owner can delete" });
      }

      await prisma.comment.delete({ where: { id: commentId } });

      io?.to(`drawing_${drawingId}`).emit("comment-deleted", {
        commentId,
        parentId: comment.parentId,
      });

      return res.json({ success: true });
    })
  );

  // PATCH /drawings/:id/comments/:commentId/resolve
  app.patch(
    "/drawings/:id/comments/:commentId/resolve",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const commentId = req.params.commentId as string;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canEditDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      const comment = await prisma.comment.findFirst({
        where: { id: commentId, drawingId, parentId: null },
      });
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      const updated = await prisma.comment.update({
        where: { id: commentId },
        data: { resolved: !comment.resolved },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      io?.to(`drawing_${drawingId}`).emit("comment-resolved", {
        commentId,
        resolved: updated.resolved,
      });

      return res.json({ comment: updated });
    })
  );

  // PATCH /drawings/:id/comments/:commentId/move
  const commentMoveSchema = z.object({
    anchorX: z.number(),
    anchorY: z.number(),
  });

  app.patch(
    "/drawings/:id/comments/:commentId/move",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const commentId = req.params.commentId as string;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canEditDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      const parsed = commentMoveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid position" });
      }

      const comment = await prisma.comment.findFirst({
        where: { id: commentId, drawingId, parentId: null },
      });
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      const updated = await prisma.comment.update({
        where: { id: commentId },
        data: { anchorX: parsed.data.anchorX, anchorY: parsed.data.anchorY },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      io?.to(`drawing_${drawingId}`).emit("comment-moved", {
        commentId,
        anchorX: updated.anchorX,
        anchorY: updated.anchorY,
      });

      return res.json({ comment: updated });
    })
  );

  // POST /drawings/:id/comments/:commentId/reactions — add reaction
  app.post(
    "/drawings/:id/comments/:commentId/reactions",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const commentId = req.params.commentId as string;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      if (!principal || principal.kind !== "user") {
        return res
          .status(401)
          .json({ error: "Authentication required to react" });
      }

      const parsed = reactionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid input", details: parsed.error.issues });
      }

      const comment = await prisma.comment.findFirst({
        where: { id: commentId, drawingId },
      });
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      const reaction = await prisma.commentReaction.upsert({
        where: {
          commentId_userId_emoji: {
            commentId,
            userId: principal.userId,
            emoji: parsed.data.emoji,
          },
        },
        create: {
          commentId,
          userId: principal.userId,
          emoji: parsed.data.emoji,
        },
        update: {},
      });

      io?.to(`drawing_${drawingId}`).emit("comment-reacted", {
        commentId,
        emoji: parsed.data.emoji,
        userId: principal.userId,
        action: "add",
      });

      return res.status(201).json({ reaction });
    })
  );

  // DELETE /drawings/:id/comments/:commentId/reactions/:emoji — remove reaction
  app.delete(
    "/drawings/:id/comments/:commentId/reactions/:emoji",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const commentId = req.params.commentId as string;
      const emoji = decodeURIComponent(req.params.emoji as string);
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
      });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      if (!principal || principal.kind !== "user") {
        return res
          .status(401)
          .json({ error: "Authentication required" });
      }

      await prisma.commentReaction
        .delete({
          where: {
            commentId_userId_emoji: {
              commentId,
              userId: principal.userId,
              emoji,
            },
          },
        })
        .catch(() => {
          // Reaction didn't exist — that's fine
        });

      io?.to(`drawing_${drawingId}`).emit("comment-reacted", {
        commentId,
        emoji,
        userId: principal.userId,
        action: "remove",
      });

      return res.json({ success: true });
    })
  );

  // GET /drawings/:id/collaborators — list mentionable users
  app.get(
    "/drawings/:id/collaborators",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const drawingId = req.params.id as string;
      const access = await getDrawingAccess({ prisma, principal, drawingId });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({ error: "Drawing not found" });
      }

      const currentUserId =
        principal?.kind === "user" ? principal.userId : null;

      const drawing = await prisma.drawing.findUnique({
        where: { id: drawingId },
        select: {
          userId: true,
          user: { select: { id: true, name: true } },
        },
      });
      if (!drawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      const permissions = await prisma.drawingPermission.findMany({
        where: { drawingId },
        select: {
          granteeUser: { select: { id: true, name: true } },
        },
      });

      const seen = new Set<string>();
      const users: { id: string; name: string }[] = [];

      const addUser = (u: { id: string; name: string }) => {
        if (u.id === currentUserId || seen.has(u.id)) return;
        seen.add(u.id);
        users.push(u);
      };

      addUser(drawing.user);
      for (const p of permissions) {
        addUser(p.granteeUser);
      }

      return res.json({ users });
    })
  );
};
