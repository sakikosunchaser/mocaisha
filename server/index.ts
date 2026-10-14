import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Server, type Socket } from "socket.io";
import type {
  ActionResponse,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData
} from "../shared/game.js";
import { RoomManager, type GameRoom } from "./roomManager.js";

const app = express();
const httpServer = createServer(app);
const socketOptions = process.env.CLIENT_ORIGIN
  ? { cors: { origin: process.env.CLIENT_ORIGIN } }
  : {};
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  socketOptions
);
const rooms = new RoomManager();
const port = Number(process.env.PORT ?? 3001);

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

const clientBuild = join(process.cwd(), "dist");
if (existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(join(clientBuild, "index.html"));
  });
}

io.on("connection", (socket) => {
  socket.on("room:create", (rawName, callback) => {
    const name = validateName(rawName);
    if (!name) {
      callback({ ok: false, error: "昵称需为 1–20 个字符。" });
      return;
    }
    const { room, player } = rooms.createRoom(name, socket.id);
    attachPlayer(socket, room.code, player.id);
    callback({ ok: true, code: room.code, playerId: player.id });
    broadcastRoom(room);
  });

  socket.on("room:join", (request, callback) => {
    const name = validateName(request?.name);
    const code = validateCode(request?.code);
    if (!name || !code) {
      callback({ ok: false, error: "请填写有效的昵称和 5 位房间码。" });
      return;
    }
    try {
      const { room, player } = rooms.joinRoom(code, name, socket.id);
      attachPlayer(socket, room.code, player.id);
      callback({ ok: true, code: room.code, playerId: player.id });
      broadcastRoom(room);
    } catch (error) {
      callback({ ok: false, error: errorMessage(error) });
    }
  });

  socket.on("room:reconnect", (request, callback) => {
    const code = validateCode(request?.code);
    const playerId = typeof request?.playerId === "string" ? request.playerId : "";
    if (!code || !playerId) {
      callback({ ok: false, error: "保存的房间信息无效，请重新加入房间。" });
      return;
    }
    try {
      const { room, player } = rooms.reconnect(code, playerId, socket.id);
      attachPlayer(socket, room.code, player.id);
      callback({ ok: true, code: room.code, playerId: player.id });
      broadcastRoom(room);
    } catch (error) {
      callback({ ok: false, error: errorMessage(error) });
    }
  });

  socket.on("room:leave", (callback) => {
    const result = rooms.leaveRoom(socket.data.roomCode, socket.data.playerId);
    callback(result);
    if (!result.ok) return;

    const roomCode = socket.data.roomCode;
    delete socket.data.roomCode;
    delete socket.data.playerId;
    if (roomCode) void socket.leave(roomCode);
    if (result.room) broadcastRoom(result.room);
  });

  socket.on("game:start", (callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.startGame(membership.room, membership.player);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:select-team", (playerIds, callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.selectTeam(membership.room, membership.player, playerIds);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:vote-team", (approve, callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.voteTeam(membership.room, membership.player, approve);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:mission-action", (action, callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.missionAction(membership.room, membership.player, action);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:continue", (callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.continueAfterResult(membership.room, membership.player);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:invade", (targetPlayerId, callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.invade(membership.room, membership.player, targetPlayerId);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:magic-candidacy", (isCandidate, callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.declareMagicCandidacy(membership.room, membership.player, isCandidate);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:magic-vote", (candidateId, callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.voteMagic(membership.room, membership.player, candidateId);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:use-magic", (action, callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.useMagic(membership.room, membership.player, action);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("game:resolve-magic", (action, callback) => {
    const membership = getMembership(socket);
    if (!membership) {
      callback({ ok: false, error: "请先加入房间。" });
      return;
    }
    const result = rooms.resolveMagic(membership.room, membership.player, action);
    replyAndBroadcast(result, callback, membership.room);
  });

  socket.on("disconnect", () => {
    const room = rooms.disconnect(socket.data.roomCode, socket.data.playerId);
    if (room) broadcastRoom(room);
  });
});

httpServer.listen(port, () => {
  console.log(`Mosaica server listening on http://localhost:${port}`);
});

function attachPlayer(socket: GameSocket, roomCode: string, playerId: string): void {
  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
  void socket.join(roomCode);
}

function getMembership(socket: GameSocket) {
  const room = socket.data.roomCode ? rooms.getRoom(socket.data.roomCode) : undefined;
  const player = room?.players.find((entry) => entry.id === socket.data.playerId);
  if (!room || !player || player.socketId !== socket.id) return undefined;
  return { room, player };
}

function broadcastRoom(room: GameRoom): void {
  for (const player of room.players) {
    if (!player.connected) continue;
    io.to(player.socketId).emit("game:update", rooms.createUpdate(room, player));
  }
}

function replyAndBroadcast(
  result: { ok: boolean; error?: string },
  callback: (response: ActionResponse) => void,
  room: GameRoom
): void {
  callback(result);
  if (result.ok) broadcastRoom(room);
}

function validateName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= 20 ? name : undefined;
}

function validateCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{5}$/.test(code) ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
