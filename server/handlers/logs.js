/* Journal d'audit + classement des plus gros gains — le serveur écrit et
   diffuse en direct (salons Socket.io "audit" / "leaderboard") au lieu de
   laisser chaque navigateur relire l'historique via des écouteurs Firestore. */
import { getDb, newId } from "../db.js";
import { serializeLog } from "../serialize.js";
import { isAdmin } from "../auth.js";

let ioRef = null;
export function initLogs(io){ ioRef = io; }

export async function logAction({ action, detail, steamId, playerName, staffId, staffName, amount, gameId }){
  try{
    const db = await getDb();
    const id = newId();
    const payload = {
      action, detail: detail || "", steamId: steamId || null, playerName: playerName || null,
      staffId: staffId || null, staffName: staffName || null,
      amount: typeof amount === "number" ? amount : null,
      gameId: gameId || null, createdAt: Date.now()
    };
    await db.collection("logs").insertOne({ _id: id, ...payload });
    if(ioRef){
      ioRef.to("audit").emit("audit:entry", serializeLog(id, payload));
    }
  }catch(e){ console.error("logAction a échoué :", e); }
}

/* Requête volontairement simple (tri + limite, sans filtre composé côté
   base) : on filtre le type "gain" côté serveur après lecture. */
export async function computeLeaderboard(limitN = 3){
  const db = await getDb();
  const docs = await db.collection("transactions").find({}).sort({ createdAt: -1 }).limit(800).toArray();
  const totals = new Map();
  docs.forEach(t => {
    if(t.type !== "gain") return;
    const entry = totals.get(t.cardId) || { playerName: t.playerName, total: 0 };
    entry.total += (t.amount || 0);
    entry.playerName = t.playerName;
    totals.set(t.cardId, entry);
  });
  return [...totals.values()].sort((a, b) => b.total - a.total).slice(0, limitN);
}

export async function broadcastLeaderboard(){
  if(!ioRef) return;
  try{
    const top = await computeLeaderboard();
    ioRef.to("leaderboard").emit("leaderboard:update", top);
  }catch(e){ console.error("broadcastLeaderboard a échoué :", e); }
}

export function registerAuditHandlers(io, socket){
  socket.on("audit:subscribe", async (_payload, cb) => {
    if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
    socket.join("audit");
    try{
      const db = await getDb();
      const docs = await db.collection("logs").find({}).sort({ createdAt: -1 }).limit(40).toArray();
      cb?.({ ok: true, logs: docs.map(d => serializeLog(d._id, d)) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("audit:unsubscribe", () => socket.leave("audit"));

  /* Vide le journal d'audit — utile en fin de soirée pour repartir léger.
     N'efface jamais les transactions (l'historique financier des cartes
     reste intact), seulement le journal d'actions lui-même. */
  socket.on("logs:clear", async (_payload, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const db = await getDb();
      await db.collection("logs").deleteMany({});
      if(ioRef) ioRef.to("audit").emit("audit:cleared");
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("leaderboard:subscribe", async (_payload, cb) => {
    socket.join("leaderboard");
    try{
      cb?.({ ok: true, leaderboard: await computeLeaderboard() });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("leaderboard:unsubscribe", () => socket.leave("leaderboard"));
}
