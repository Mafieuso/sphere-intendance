/* Journal d'audit + classement des plus gros gains — le serveur écrit et
   diffuse en direct (salons Socket.io "audit" / "leaderboard") au lieu de
   laisser chaque navigateur relire l'historique via des écouteurs Firestore. */
import { getDb, FieldValue } from "../firebaseAdmin.js";
import { serializeLog } from "../serialize.js";

let ioRef = null;
export function initLogs(io){ ioRef = io; }

export async function logAction({ action, detail, steamId, playerName, staffId, staffName, amount, gameId }){
  try{
    const db = getDb();
    const payload = {
      action, detail: detail || "", steamId: steamId || null, playerName: playerName || null,
      staffId: staffId || null, staffName: staffName || null,
      amount: typeof amount === "number" ? amount : null,
      gameId: gameId || null, createdAt: FieldValue.serverTimestamp()
    };
    const ref = await db.collection("logs").add(payload);
    if(ioRef){
      ioRef.to("audit").emit("audit:entry", serializeLog(ref.id, { ...payload, createdAt: Date.now() }));
    }
  }catch(e){ console.error("logAction a échoué :", e); }
}

/* Requête volontairement sans orderBy+where combinés (éviterait de dépendre
   d'un index composite Firestore) : on trie côté serveur après lecture. */
export async function computeLeaderboard(limitN = 3){
  const db = getDb();
  const snap = await db.collection("transactions").orderBy("createdAt", "desc").limit(800).get();
  const totals = new Map();
  snap.docs.forEach(d => {
    const t = d.data();
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
    socket.join("audit");
    try{
      const db = getDb();
      const snap = await db.collection("logs").orderBy("createdAt", "desc").limit(40).get();
      cb?.({ ok: true, logs: snap.docs.map(d => serializeLog(d.id, d.data())) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("audit:unsubscribe", () => socket.leave("audit"));

  socket.on("leaderboard:subscribe", async (_payload, cb) => {
    socket.join("leaderboard");
    try{
      cb?.({ ok: true, leaderboard: await computeLeaderboard() });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("leaderboard:unsubscribe", () => socket.leave("leaderboard"));
}
