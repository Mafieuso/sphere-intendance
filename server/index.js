import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

import { verifyToken } from "./auth.js";
import { registerSteamAuthRoutes } from "./steamAuth.js";
import { registerSessionHandlers } from "./handlers/session.js";
import { registerCardHandlers, initCards } from "./handlers/cards.js";
import { registerAuditHandlers, initLogs } from "./handlers/logs.js";
import { registerCoinflipHandlers } from "./handlers/games/coinflip.js";
import { registerDiceHandlers } from "./handlers/games/dice.js";
import { registerRouletteHandlers, initRoulette } from "./handlers/games/roulette.js";
import { registerBlackjackHandlers, initBlackjack } from "./handlers/games/blackjack.js";
import { registerCrashHandlers, initCrash } from "./handlers/games/crash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const app = express();
app.set("trust proxy", 1); // Render est derrière un proxy HTTPS — nécessaire pour que req.protocol soit correct (realm/return_to Steam)
const server = http.createServer(app);
const io = new Server(server);

registerSteamAuthRoutes(app);
app.use(express.static(ROOT, { extensions: ["html"] }));

initLogs(io);
initCards(io);
initRoulette(io);
initBlackjack(io);
initCrash(io);

io.on("connection", (socket) => {
  socket.session = null;

  socket.on("auth:token", (token, cb) => {
    socket.session = verifyToken(token);
    cb?.({ ok: !!socket.session });
  });
  socket.on("auth:logout", () => { socket.session = null; });

  registerSessionHandlers(io, socket);
  registerCardHandlers(io, socket);
  registerAuditHandlers(io, socket);
  registerCoinflipHandlers(io, socket);
  registerDiceHandlers(io, socket);
  registerRouletteHandlers(io, socket);
  registerBlackjackHandlers(io, socket);
  registerCrashHandlers(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sphère de l'Intendance — serveur en écoute sur le port ${PORT}`);
});
