/* Jetons de session (JWT) sans état — aucun stockage serveur nécessaire,
   ce qui permet de survivre sans souci à un redémarrage après mise en veille
   (comportement normal du forfait gratuit Render). */
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
if(!SECRET){
  console.warn("ATTENTION : JWT_SECRET n'est pas défini — utilisation d'un secret de développement non sûr.");
}
const EFFECTIVE_SECRET = SECRET || "dev-secret-ne-pas-utiliser-en-production";
const EXPIRES_IN = "12h";

export function signStaffToken(staff){
  return jwt.sign(
    { kind: "staff", staffId: staff.id, role: staff.role, name: staff.name },
    EFFECTIVE_SECRET, { expiresIn: EXPIRES_IN }
  );
}

export function signPlayerToken(card){
  return jwt.sign(
    { kind: "player", cardId: card.id, steamId: card.steamId, playerName: card.playerName },
    EFFECTIVE_SECRET, { expiresIn: EXPIRES_IN }
  );
}

export function verifyToken(token){
  if(!token) return null;
  try{ return jwt.verify(token, EFFECTIVE_SECRET); }
  catch{ return null; }
}

export function isCroupierOrAdmin(session){
  return !!session && session.kind === "staff" && (session.role === "croupier" || session.role === "admin");
}
export function isHoteOrAdmin(session){
  return !!session && session.kind === "staff" && (session.role === "hote" || session.role === "admin");
}
export function isAdmin(session){
  return !!session && session.kind === "staff" && session.role === "admin";
}
export function isStaff(session){
  return !!session && session.kind === "staff";
}
export function isPlayer(session){
  return !!session && session.kind === "player";
}
