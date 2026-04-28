import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "../generated/client";
import { AuthModeService } from "../auth/authMode";
import { ACCESS_TOKEN_COOKIE_NAME, parseCookieHeader } from "../auth/cookies";
import { BOOTSTRAP_USER_ID } from "../auth/authMode";
import { config } from "../config";
import {
  getDrawingAccess,
  canEditDrawing,
  canViewDrawing,
  type DrawingPrincipal,
} from "../authz/sharing";

interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  socketId: string;
  isActive: boolean;
}

interface WsMessage {
  type: string;
  data?: any;
  ackId?: string;
}

interface SocketState {
  id: string;
  ws: WebSocket;
  principal: DrawingPrincipal | null;
  authenticated: boolean;
  rooms: Set<string>;
  authorizedDrawingAccess: Map<
    string,
    { access: "view" | "edit" | "owner"; checkedAtMs: number }
  >;
  req: IncomingMessage;
}

type RegisterSocketHandlersDeps = {
  wss: WebSocketServer;
  prisma: PrismaClient;
  authModeService: AuthModeService;
  jwtSecret: string;
};

export const registerSocketHandlers = ({
  wss,
  prisma,
  authModeService,
  jwtSecret,
}: RegisterSocketHandlersDeps) => {
  const rooms = new Map<string, Set<WebSocket>>();
  const roomUsers = new Map<string, User[]>();
  const socketStates = new WeakMap<WebSocket, SocketState>();

  const HEARTBEAT_INTERVAL_MS = 30_000;

  const sendTo = (ws: WebSocket, message: WsMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const broadcastToRoom = (
    roomId: string,
    message: WsMessage,
    exclude?: WebSocket
  ) => {
    const members = rooms.get(roomId);
    if (!members) return;
    const payload = JSON.stringify(message);
    for (const ws of members) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  };

  const joinRoom = (ws: WebSocket, roomId: string) => {
    let members = rooms.get(roomId);
    if (!members) {
      members = new Set();
      rooms.set(roomId, members);
    }
    members.add(ws);
    const state = socketStates.get(ws);
    if (state) state.rooms.add(roomId);
  };

  const leaveAllRooms = (ws: WebSocket) => {
    const state = socketStates.get(ws);
    if (!state) return;
    for (const roomId of state.rooms) {
      const members = rooms.get(roomId);
      if (members) {
        members.delete(ws);
        if (members.size === 0) rooms.delete(roomId);
      }
    }
    state.rooms.clear();
  };

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

  const getSocketAuthUserId = async (
    token?: string
  ): Promise<string | null> => {
    const authEnabled = await authModeService.getAuthEnabled();
    if (!authEnabled) {
      return BOOTSTRAP_USER_ID;
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
        select: { id: true, isActive: true },
      });

      if (!user || !user.isActive) return null;
      return user.id;
    } catch {
      return null;
    }
  };

  const ACCESS_CACHE_TTL_MS = 1500;

  const getCachedOrFreshAccess = async (
    state: SocketState,
    drawingId: string
  ): Promise<"view" | "edit" | "owner" | null> => {
    const cached = state.authorizedDrawingAccess.get(drawingId);
    const now = Date.now();
    if (cached && now - cached.checkedAtMs < ACCESS_CACHE_TTL_MS) {
      return cached.access;
    }
    const access = await getDrawingAccess({
      prisma,
      principal: state.principal,
      drawingId,
    });
    if (!canViewDrawing(access)) {
      state.authorizedDrawingAccess.delete(drawingId);
      return null;
    }
    const normalized = access === "owner" ? "owner" : access;
    state.authorizedDrawingAccess.set(drawingId, {
      access: normalized,
      checkedAtMs: now,
    });
    return normalized;
  };

  const resolveProxyUserId = async (
    req: IncomingMessage
  ): Promise<string | null> => {
    const raw = req.headers[config.proxyAuthHeader];
    const email = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
    if (!email) return null;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) return null;
    return user.id;
  };

  const handleAuth = async (state: SocketState, msg: WsMessage) => {
    try {
      if (config.authMode === "proxy") {
        const userId = await resolveProxyUserId(state.req);
        if (userId) {
          state.principal = { kind: "user", userId };
        }
        state.authenticated = true;
        sendTo(state.ws, { type: "auth-ok" });
        return;
      }

      const tokenFromMsg =
        typeof msg.data?.token === "string" && msg.data.token.trim().length > 0
          ? msg.data.token
          : undefined;
      const tokenFromCookie = (() => {
        const cookies = parseCookieHeader(state.req.headers.cookie);
        const value = cookies[ACCESS_TOKEN_COOKIE_NAME];
        return typeof value === "string" && value.trim().length > 0
          ? value
          : undefined;
      })();
      const token = tokenFromMsg || tokenFromCookie;
      const authEnabled = await authModeService.getAuthEnabled();
      const userId = await getSocketAuthUserId(token);

      if (userId) {
        state.principal = { kind: "user", userId };
        state.authenticated = true;
        sendTo(state.ws, { type: "auth-ok" });
        return;
      }

      if (authEnabled) {
        state.authenticated = true;
        sendTo(state.ws, { type: "auth-ok" });
        return;
      }

      sendTo(state.ws, {
        type: "auth-error",
        data: { message: "Authentication required" },
      });
      state.ws.close(1008, "Authentication required");
    } catch {
      sendTo(state.ws, {
        type: "auth-error",
        data: { message: "Authentication failed" },
      });
      state.ws.close(1008, "Authentication failed");
    }
  };

  const handleJoinRoom = async (state: SocketState, msg: WsMessage) => {
    try {
      const { drawingId, user } = msg.data || {};
      if (typeof drawingId !== "string") return;

      const access = await getCachedOrFreshAccess(state, drawingId);
      if (!access) {
        sendTo(state.ws, {
          type: "error",
          data: { message: "You do not have access to this drawing" },
        });
        return;
      }

      const roomId = `drawing_${drawingId}`;
      joinRoom(state.ws, roomId);

      let trustedUserId =
        typeof user?.id === "string" && user.id.trim().length > 0
          ? user.id.trim().slice(0, 200)
          : state.id;
      let trustedName = toPresenceName(user?.name);

      if (!state.principal) {
        trustedUserId = `anon:${state.id}`.slice(0, 200);
      } else if (
        state.principal?.kind === "user" &&
        state.principal.userId !== BOOTSTRAP_USER_ID
      ) {
        const account = await prisma.user.findUnique({
          where: { id: state.principal.userId },
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
        socketId: state.id,
        isActive: true,
      };

      const currentUsers = roomUsers.get(roomId) || [];
      const filteredUsers = currentUsers.filter((u) => u.id !== newUser.id);
      filteredUsers.push(newUser);
      roomUsers.set(roomId, filteredUsers);

      broadcastToRoom(roomId, {
        type: "presence-update",
        data: filteredUsers,
      });

      if (msg.ackId) {
        sendTo(state.ws, {
          type: "ack",
          data: {
            ackId: msg.ackId,
            payload: {
              user: {
                id: newUser.id,
                name: newUser.name,
                initials: newUser.initials,
                color: newUser.color,
              },
            },
          },
        });
      }
    } catch (err) {
      console.error("Error in join-room handler:", err);
      sendTo(state.ws, {
        type: "error",
        data: { message: "Failed to join room" },
      });
    }
  };

  const handleCursorMove = (state: SocketState, msg: WsMessage) => {
    const data = msg.data;
    const drawingId =
      typeof data?.drawingId === "string" ? data.drawingId : null;
    if (!drawingId || !state.authorizedDrawingAccess.has(drawingId)) return;

    const roomId = `drawing_${drawingId}`;
    const users = roomUsers.get(roomId) || [];
    const self = users.find((u) => u.socketId === state.id);
    if (!self) return;

    const outgoing: WsMessage = {
      type: "cursor-move",
      data: {
        ...data,
        drawingId,
        userId: self.id,
        username: self.name,
        color: self.color,
      },
    };
    const payload = JSON.stringify(outgoing);

    const members = rooms.get(roomId);
    if (!members) return;
    for (const peer of members) {
      if (
        peer !== state.ws &&
        peer.readyState === WebSocket.OPEN &&
        peer.bufferedAmount < 65536
      ) {
        peer.send(payload);
      }
    }
  };

  const handleElementUpdate = async (state: SocketState, msg: WsMessage) => {
    const data = msg.data;
    const drawingId =
      typeof data?.drawingId === "string" ? data.drawingId : null;
    if (!drawingId || !state.authorizedDrawingAccess.has(drawingId)) return;

    const joinedAccess = await getCachedOrFreshAccess(state, drawingId);
    if (!joinedAccess || !canEditDrawing(joinedAccess)) {
      sendTo(state.ws, {
        type: "error",
        data: { message: "Read-only access: cannot edit this drawing" },
      });
      return;
    }

    const roomId = `drawing_${drawingId}`;
    broadcastToRoom(
      roomId,
      { type: "element-update", data },
      state.ws
    );
  };

  const handleUserActivity = (state: SocketState, msg: WsMessage) => {
    const { drawingId, isActive } = msg.data || {};
    if (
      typeof drawingId !== "string" ||
      !state.authorizedDrawingAccess.has(drawingId)
    )
      return;

    const roomId = `drawing_${drawingId}`;
    const users = roomUsers.get(roomId);
    if (users) {
      const user = users.find((u) => u.socketId === state.id);
      if (user) {
        user.isActive = isActive;
        broadcastToRoom(roomId, {
          type: "presence-update",
          data: users,
        });
      }
    }
  };

  const handleDisconnect = (state: SocketState) => {
    leaveAllRooms(state.ws);
    roomUsers.forEach((users, roomId) => {
      const index = users.findIndex((u) => u.socketId === state.id);
      if (index !== -1) {
        users.splice(index, 1);
        roomUsers.set(roomId, users);
        broadcastToRoom(roomId, {
          type: "presence-update",
          data: users,
        });
      }
    });
  };

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const state: SocketState = {
      id: randomUUID(),
      ws,
      principal: null,
      authenticated: false,
      rooms: new Set(),
      authorizedDrawingAccess: new Map(),
      req,
    };
    socketStates.set(ws, state);

    let isAlive = true;
    const heartbeat = setInterval(() => {
      if (!isAlive) {
        clearInterval(heartbeat);
        ws.terminate();
        return;
      }
      isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);

    ws.on("pong", () => {
      isAlive = true;
    });

    ws.on("message", async (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Buffer.isBuffer(raw)
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw);
      if (buf.byteLength > 50 * 1024 * 1024) {
        ws.close(1009, "Message too large");
        return;
      }

      let msg: WsMessage;
      try {
        msg = JSON.parse(buf.toString("utf8"));
      } catch {
        return;
      }

      if (!state.authenticated) {
        if (msg.type === "auth") {
          await handleAuth(state, msg);
        }
        return;
      }

      switch (msg.type) {
        case "join-room":
          await handleJoinRoom(state, msg);
          break;
        case "cursor-move":
          handleCursorMove(state, msg);
          break;
        case "element-update":
          await handleElementUpdate(state, msg);
          break;
        case "user-activity":
          handleUserActivity(state, msg);
          break;
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      handleDisconnect(state);
    });

    ws.on("error", () => {
      clearInterval(heartbeat);
      handleDisconnect(state);
    });
  });
};
