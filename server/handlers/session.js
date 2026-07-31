/* Connexion staff (PIN) et déverrouillage de carte joueur (Steam ID + PIN).
   Le serveur est désormais le seul à voir les PIN — jamais transmis à un
   autre client que leur propriétaire légitime (le joueur lui-même, ou
   l'Hôte qui doit pouvoir le relire pour le transmettre en jeu). */
import { getDb, FieldValue } from "../firebaseAdmin.js";
import { signStaffToken, signPlayerToken, isAdmin } from "../auth.js";
import { serializeStaff, serializeCard } from "../serialize.js";
import { logAction } from "./logs.js";

const PIN_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePin(length){
  let pin = "";
  for(let i = 0; i < length; i++) pin += PIN_CHARS[Math.floor(Math.random() * PIN_CHARS.length)];
  return pin;
}

export function registerSessionHandlers(io, socket){
  socket.on("staff:login", async ({ pin } = {}, cb) => {
    try{
      const db = getDb();
      const snap = await db.collection("staff")
        .where("pin", "==", (pin || "").trim())
        .limit(1).get();
      const doc = snap.docs.find(d => d.data().active !== false);
      if(!doc) return cb?.({ ok: false, error: "Code secret invalide." });
      const staff = { id: doc.id, ...doc.data() };
      socket.session = { kind: "staff", staffId: staff.id, role: staff.role, name: staff.name };
      const token = signStaffToken(staff);
      cb?.({ ok: true, token, staff: serializeStaff(staff.id, staff) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("staff:setPermanentPin", async ({ newPin } = {}, cb) => {
    try{
      if(!socket.session || socket.session.kind !== "staff") return cb?.({ ok: false, error: "Non connecté." });
      const trimmed = (newPin || "").trim();
      if(trimmed.length < 4) return cb?.({ ok: false, error: "Le code doit contenir au moins 4 caractères." });
      const db = getDb();
      await db.collection("staff").doc(socket.session.staffId).update({
        pin: trimmed, pinConfigured: true, pinSetAt: FieldValue.serverTimestamp()
      });
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("staff:add", async ({ name, steamId, role } = {}, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      if(!name || !steamId) return cb?.({ ok: false, error: "Nom et Steam ID requis." });
      if(!["hote", "croupier", "admin"].includes(role)) return cb?.({ ok: false, error: "Rôle invalide." });
      const db = getDb();
      const pin = generatePin(8);
      const ref = await db.collection("staff").add({
        name, steamId, role, pin, active: true, pinConfigured: false, pinSetAt: null,
        createdAt: FieldValue.serverTimestamp()
      });
      await logAction({
        action: "STAFF_AJOUTE", detail: `${name} ajouté comme ${role}`,
        staffId: socket.session.staffId, staffName: socket.session.name
      });
      cb?.({ ok: true, staffId: ref.id, pin });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("staff:resetPin", async ({ staffId } = {}, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const db = getDb();
      const ref = db.collection("staff").doc(staffId);
      const doc = await ref.get();
      if(!doc.exists) return cb?.({ ok: false, error: "Membre introuvable." });
      const tempPin = generatePin(8);
      await ref.update({ pin: tempPin, pinConfigured: false, pinSetAt: null });
      await logAction({
        action: "STAFF_CODE_RESET", detail: `Code réinitialisé pour ${doc.data().name}`,
        staffId: socket.session.staffId, staffName: socket.session.name
      });
      cb?.({ ok: true, pin: tempPin });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("staff:list", async (_payload, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const db = getDb();
      const snap = await db.collection("staff").get();
      cb?.({ ok: true, staff: snap.docs.map(d => serializeStaff(d.id, d.data())) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:unlock", async ({ steamId, pin } = {}, cb) => {
    try{
      const db = getDb();
      const snap = await db.collection("playerCards")
        .where("steamId", "==", (steamId || "").trim()).limit(1).get();
      if(snap.empty) return cb?.({ ok: false, error: "Steam ID ou PIN incorrect." });
      const doc = snap.docs[0];
      const card = { id: doc.id, ...doc.data() };
      if((card.pin || "") !== (pin || "").trim().toUpperCase()){
        return cb?.({ ok: false, error: "Steam ID ou PIN incorrect." });
      }
      socket.session = { kind: "player", cardId: card.id, steamId: card.steamId, playerName: card.playerName };
      const token = signPlayerToken(card);
      cb?.({ ok: true, token, card: serializeCard(card.id, card) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
