import { io } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/game";

export const socket = io<ClientToServerEvents, ServerToClientEvents>({
  autoConnect: true
});
