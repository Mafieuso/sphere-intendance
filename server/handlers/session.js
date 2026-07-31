/* Connexion staff (PIN) et déverrouillage de carte joueur (Steam ID + PIN).
   Le serveur est désormais le seul à voir les PIN — jamais transmis à un
   autre client que leur propriétaire légitime (le joueur lui-même, ou
   l'Hôte qui doit pouvoir le relire pour le transmettre en jeu). */
import { getDb, newId } from "../db.js";
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
      const db = await getDb();
      const doc = await db.collection("staff").findOne({ pin: (pin || "").trim(), active: { $ne: false } });
      if(!doc) return cb?.({ ok: false, error: "Code secret invalide." });
      const staff = { ...doc, id: doc._id };
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
      const db = await getDb();
      await db.collection("staff").updateOne(
        { _id: socket.session.staffId },
        { $set: { pin: trimmed, pinConfigured: true, pinSetAt: Date.now() } }
      );
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("staff:add", async ({ name, steamId, role } = {}, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      if(!name || !steamId) return cb?.({ ok: false, error: "Nom et Steam ID requis." });
      if(!["hote", "croupier", "admin"].includes(role)) return cb?.({ ok: false, error: "Rôle invalide." });
      const db = await getDb();
      const pin = generatePin(8);
      const id = newId();
      await db.collection("staff").insertOne({
        _id: id, name, steamId, role, pin, active: true, pinConfigured: false, pinSetAt: null,
        createdAt: Date.now()
      });
      await logAction({
        action: "STAFF_AJOUTE", detail: `${name} ajouté comme ${role}`,
        staffId: socket.session.staffId, staffName: socket.session.name
      });
      cb?.({ ok: true, staffId: id, pin });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("staff:resetPin", async ({ staffId } = {}, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const db = await getDb();
      const staff = db.collection("staff");
      const doc = await staff.findOne({ _id: staffId });
      if(!doc) return cb?.({ ok: false, error: "Membre introuvable." });
      const tempPin = generatePin(8);
      await staff.updateOne({ _id: staffId }, { $set: { pin: tempPin, pinConfigured: false, pinSetAt: null } });
      await logAction({
        action: "STAFF_CODE_RESET", detail: `Code réinitialisé pour ${doc.name}`,
        staffId: socket.session.staffId, staffName: socket.session.name
      });
      cb?.({ ok: true, pin: tempPin });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("staff:list", async (_payload, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const db = await getDb();
      const docs = await db.collection("staff").find({}).toArray();
      cb?.({ ok: true, staff: docs.map(d => serializeStaff(d._id, d)) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:unlock", async ({ steamId, pin } = {}, cb) => {
    try{
      const db = await getDb();
      const doc = await db.collection("playerCards").findOne({ steamId: (steamId || "").trim() });
      if(!doc) return cb?.({ ok: false, error: "Steam ID ou PIN incorrect." });
      const card = { ...doc, id: doc._id };
      if((card.pin || "") !== (pin || "").trim().toUpperCase()){
        return cb?.({ ok: false, error: "Steam ID ou PIN incorrect." });
      }
      socket.session = { kind: "player", cardId: card.id, steamId: card.steamId, playerName: card.playerName };
      const token = signPlayerToken(card);
      cb?.({ ok: true, token, card: serializeCard(card.id, card) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
