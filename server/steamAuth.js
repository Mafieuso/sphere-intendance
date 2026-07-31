/* Connexion via Steam (OpenID 2.0) pour les rôles Hôte et Admin — remplace
   le PIN pour ces deux rôles : l'accès est lié au compte Steam réellement
   enregistré (steamId déjà stocké en base), impossible à partager ou à
   deviner comme un code PIN. Aucune clé API Steam nécessaire : on vérifie
   uniquement la signature OpenID renvoyée par Steam auprès de Steam
   lui-même ; on ne récupère pas le profil (le nom est déjà en base via le
   formulaire d'ajout de staff). Le Croupier ne touchant pas l'argent,
   il garde le PIN. */
import { getDb } from "./db.js";
import { randomUUID } from "crypto";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
export const STEAM_LOGIN_ROLES = ["hote", "admin"];

// Codes d'échange à usage unique, très courte durée de vie — le pont
// steam-callback.html les échange immédiatement contre un vrai token JWT
// via un socket authentifié, sans jamais faire transiter le JWT dans une URL.
const pendingCodes = new Map();
const CODE_TTL_MS = 30_000;

function realmAndReturnTo(req){
  const origin = `${req.protocol}://${req.get("host")}`;
  return { realm: origin, returnTo: `${origin}/auth/steam/return` };
}

export function registerSteamAuthRoutes(app){
  app.get("/auth/steam", (req, res) => {
    const { realm, returnTo } = realmAndReturnTo(req);
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": returnTo,
      "openid.realm": realm,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
    });
    res.redirect(`${STEAM_OPENID_URL}?${params.toString()}`);
  });

  app.get("/auth/steam/return", async (req, res) => {
    try{
      const rawQuery = req.originalUrl.split("?")[1] || "";
      const query = new URLSearchParams(rawQuery);

      if(query.get("openid.mode") !== "id_res"){
        return res.redirect("/login.html?error=steam");
      }

      // Steam exige qu'on lui repasse exactement les mêmes paramètres pour
      // vérifier la signature — c'est ça qui empêche de forger un SteamID.
      const verifyParams = new URLSearchParams(rawQuery);
      verifyParams.set("openid.mode", "check_authentication");
      const verifyRes = await fetch(STEAM_OPENID_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verifyParams.toString()
      });
      const verifyText = await verifyRes.text();
      if(!/is_valid\s*:\s*true/.test(verifyText)){
        return res.redirect("/login.html?error=steam");
      }

      const claimedId = query.get("openid.claimed_id") || "";
      const match = claimedId.match(/\/openid\/id\/(\d+)$/);
      if(!match) return res.redirect("/login.html?error=steam");
      const steamId = match[1];

      const db = await getDb();
      const staff = await db.collection("staff").findOne({
        steamId, role: { $in: STEAM_LOGIN_ROLES }, active: { $ne: false }
      });
      if(!staff){
        return res.redirect("/login.html?error=steam_unregistered");
      }

      const code = randomUUID();
      pendingCodes.set(code, staff._id);
      setTimeout(() => pendingCodes.delete(code), CODE_TTL_MS);

      res.redirect(`/steam-callback.html?code=${code}`);
    }catch(e){
      console.error("Vérification Steam OpenID échouée :", e);
      res.redirect("/login.html?error=steam");
    }
  });
}

/* Usage unique : la première consommation invalide le code. */
export function exchangeSteamCode(code){
  if(!pendingCodes.has(code)) return null;
  const staffId = pendingCodes.get(code);
  pendingCodes.delete(code);
  return staffId;
}
