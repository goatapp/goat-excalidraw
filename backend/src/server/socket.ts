import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { PrismaClient } from "../generated/client/client.js";
import { AuthModeService } from "../auth/authMode.js";
import { ACCESS_TOKEN_COOKIE_NAME, parseCookieHeader } from "../auth/cookies.js";
import { BOOTSTRAP_USER_ID } from "../auth/authMode.js";
import { config } from "../config.js";
import {
  getDrawingAccess,
  canEditDrawing,
  canViewDrawing,
  type DrawingPrincipal,
} from "../authz/sharing.js";
import { logger } from "../utils/logger.js";

interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  socketId: string;
  isActive: boolean;
}

type RegisterSocketHandlersDeps = {
  io: Server;
  prisma: PrismaClient;
  authModeService: AuthModeService;
  jwtSecret: string;
};

export const registerSocketHandlers = ({
  io,
  prisma,
  authModeService,
  jwtSecret,
}: RegisterSocketHandlersDeps) => {
  const roomUsers = new Map<string, User[]>();
  const socketPrincipalMap = new Map<string, DrawingPrincipal & { role?: string }>();

  const toPresenceName = (value: unknown): string => {
    if (typeof value !== "string") return "User";
    const trimmed = value.trim().slice(0, 120);
    return trimmed.length > 0 ? trimmed : "User";
  };

  const toPresenceInitials = (name: string): string => {
    const trimmed = name.trim();
    if (!trimmed) return "U";
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  };

  const toPresenceColor = (value: unknown): string => {
    if (typeof value !== "string") return "#4f46e5";
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
      return trimmed;
    }
    return "#4f46e5";
  };

  const getSocketAuthUser = async (token?: string): Promise<{ id: string; role: string } | null> => {
    const authEnabled = await authModeService.getAuthEnabled();
    if (!authEnabled) {
      return { id: BOOTSTRAP_USER_ID, role: "ADMIN" };
    }

    if (!token) return null;

    try {
      const decoded = jwt.verify(token, jwtSecret) as Record<string, unknown>;
      if (
        typeof decoded.userId !== "string" ||
        typeof decoded.email !== "string" ||
        decoded.type !== "access"
      ) {
        return null;
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, isActive: true, role: true },
      });

      if (!user || !user.isActive) return null;
      return { id: user.id, role: user.role };
    } catch {
      return null;
    }
  };

  io.use(async (socket, next) => {
    try {
      if (config.authMode === "proxy") {
        const raw = socket.request.headers[config.proxyAuthHeader];
        const email = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
        if (email) {
          const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, isActive: true, role: true },
          });
          if (user?.isActive) {
            socketPrincipalMap.set(socket.id, { kind: "user", userId: user.id, role: user.role });
          }
        }
        return next();
      }

      const tokenFromAuth = socket.handshake.auth?.token as string | undefined;
      const tokenFromCookie = (() => {
        const cookies = parseCookieHeader(socket.handshake.headers.cookie);
        const value = cookies[ACCESS_TOKEN_COOKIE_NAME];
        return typeof value === "string" && value.trim().length > 0 ? value : undefined;
      })();
      const token = tokenFromAuth || tokenFromCookie;
      const authEnabled = await authModeService.getAuthEnabled();
      const authUser = await getSocketAuthUser(token);

      if (authUser) {
        socketPrincipalMap.set(socket.id, { kind: "user", userId: authUser.id, role: authUser.role });
        return next();
      }

      if (authEnabled) return next();

      return next(new Error("Authentication required"));
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const principal = socketPrincipalMap.get(socket.id) || null;
    const authorizedDrawingAccess = new Map<
      string,
      { access: "view" | "edit" | "owner"; checkedAtMs: number }
    >();
    const ACCESS_CACHE_TTL_MS = 1500;

    const getAdminOverrideForSocket = async (): Promise<boolean> => {
      if (!principal || principal.role !== "ADMIN") return false;
      const sc = await authModeService.ensureSystemConfig();
      return sc.adminFullAccess;
    };

    const getCachedOrFreshAccess = async (
      drawingId: string
    ): Promise<"view" | "edit" | "owner" | null> => {
      const cached = authorizedDrawingAccess.get(drawingId);
      const now = Date.now();
      if (cached && now - cached.checkedAtMs < ACCESS_CACHE_TTL_MS) {
        return cached.access;
      }
      const isAdminOverride = await getAdminOverrideForSocket();
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId,
        isAdminOverride,
      });
      if (!canViewDrawing(access)) {
        authorizedDrawingAccess.delete(drawingId);
        return null;
      }
      const normalized = access === "owner" ? "owner" : access;
      authorizedDrawingAccess.set(drawingId, { access: normalized, checkedAtMs: now });
      return normalized;
    };

    socket.on(
      "join-room",
      async (
        {
          drawingId,
          user,
        }: {
          drawingId: string;
          user: Omit<User, "socketId" | "isActive">;
        },
        ack?: (payload: { user: Omit<User, "socketId" | "isActive"> }) => void
      ) => {
        try {
          const access = await getCachedOrFreshAccess(drawingId);
          if (!access) {
            socket.emit("error", { message: "You do not have access to this drawing" });
            return;
          }

          const roomId = `drawing_${drawingId}`;
          socket.join(roomId);

          let trustedUserId =
            typeof user?.id === "string" && user.id.trim().length > 0
              ? user.id.trim().slice(0, 200)
              : socket.id;
          let trustedName = toPresenceName(user?.name);

          if (!principal) {
            trustedUserId = `anon:${socket.id}`.slice(0, 200);
          } else if (principal?.kind === "user" && principal.userId !== BOOTSTRAP_USER_ID) {
            const account = await prisma.user.findUnique({
              where: { id: principal.userId },
              select: { id: true, name: true },
            });
            if (account) {
              trustedUserId = account.id;
              trustedName = toPresenceName(account.name);
            }
          }

          const newUser: User = {
            id: trustedUserId,
            name: trustedName,
            initials: toPresenceInitials(trustedName),
            color: toPresenceColor(user?.color),
            socketId: socket.id,
            isActive: true,
          };

          const currentUsers = roomUsers.get(roomId) || [];
          const filteredUsers = currentUsers.filter((u) => u.id !== newUser.id);
          filteredUsers.push(newUser);
          roomUsers.set(roomId, filteredUsers);

          io.to(roomId).emit("presence-update", filteredUsers);
          if (typeof ack === "function") {
            ack({
              user: {
                id: newUser.id,
                name: newUser.name,
                initials: newUser.initials,
                color: newUser.color,
              },
            });
          }
        } catch (err) {
          logger.error({ err }, "Error in join-room handler");
          socket.emit("error", { message: "Failed to join room" });
        }
      }
    );

    socket.on("cursor-move", (data) => {
      const drawingId = typeof data?.drawingId === "string" ? data.drawingId : null;
      if (!drawingId || !authorizedDrawingAccess.has(drawingId)) {
        return;
      }
      const roomId = `drawing_${drawingId}`;
      const users = roomUsers.get(roomId) || [];
      const self = users.find((u) => u.socketId === socket.id);
      if (!self) return;
      socket.volatile.to(roomId).emit("cursor-move", {
        ...data,
        drawingId,
        userId: self.id,
        username: self.name,
        color: self.color,
      });
    });

    socket.on("element-update", async (data) => {
      const drawingId = typeof data?.drawingId === "string" ? data.drawingId : null;
      if (!drawingId || !authorizedDrawingAccess.has(drawingId)) {
        return;
      }

      const joinedAccess = await getCachedOrFreshAccess(drawingId);
      if (!joinedAccess || !canEditDrawing(joinedAccess)) {
        socket.emit("error", { message: "Read-only access: cannot edit this drawing" });
        return;
      }

      const roomId = `drawing_${drawingId}`;
      socket.to(roomId).emit("element-update", data);
    });

    socket.on(
      "user-activity",
      ({ drawingId, isActive }: { drawingId: string; isActive: boolean }) => {
        if (!authorizedDrawingAccess.has(drawingId)) {
          return;
        }
        const roomId = `drawing_${drawingId}`;
        const users = roomUsers.get(roomId);
        if (users) {
          const user = users.find((u) => u.socketId === socket.id);
          if (user) {
            user.isActive = isActive;
            io.to(roomId).emit("presence-update", users);
          }
        }
      }
    );

    socket.on("disconnect", () => {
      socketPrincipalMap.delete(socket.id);
      roomUsers.forEach((users, roomId) => {
        const index = users.findIndex((u) => u.socketId === socket.id);
        if (index !== -1) {
          users.splice(index, 1);
          roomUsers.set(roomId, users);
          io.to(roomId).emit("presence-update", users);
        }
      });
    });
  });
};
