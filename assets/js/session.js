/* Session staff (Hôte / Croupier / Admin) — passe désormais par le serveur
   Node.js (assets/js/api.js), qui est seul à vérifier les PIN contre
   Firestore. Le navigateur ne voit plus jamais le PIN d'un autre membre. */
import { request, setToken, clearToken } from "./api.js";

const KEY = "sphereIntendanceStaff";

export function getSession(){
  try{ return JSON.parse(localStorage.getItem(KEY)); }catch{ return null; }
}
export function setSession(staff){
  localStorage.setItem(KEY, JSON.stringify(staff));
  localStorage.removeItem("sphereIntendancePlayer"); // une connexion active exclut l'autre
}
export function clearSession(){
  localStorage.removeItem(KEY);
  clearToken();
}

export async function loginWithPin(pin){
  const res = await request("staff:login", { pin }).catch(() => null);
  if(!res?.ok) return null;
  setToken(res.token);
  setSession(res.staff);
  return res.staff;
}

/* Échange le code à usage unique reçu de /auth/steam/return contre un vrai
   token — le JWT ne transite jamais dans une URL. */
export async function loginWithSteamCode(code){
  const res = await request("staff:steamLogin", { code }).catch(() => null);
  if(!res?.ok) return null;
  setToken(res.token);
  setSession(res.staff);
  return res.staff;
}

/* pinConfigured explicitement à false = code temporaire, à remplacer au
   premier login. Les comptes déjà existants sans ce champ sont considérés
   configurés, pour ne pas bloquer le staff déjà actif. */
export function needsPinSetup(staffMember){
  return staffMember?.pinConfigured === false;
}

export async function setPermanentPin(staffId, newPin){
  await request("staff:setPermanentPin", { newPin });
  const current = getSession();
  if(current && current.id === staffId) setSession({ ...current, pinConfigured: true });
}

/* Réinitialisation par l'Admin : le serveur génère lui-même le nouveau code
   temporaire et le renvoie (à transmettre au membre concerné). */
export async function resetStaffPin(staffId){
  const res = await request("staff:resetPin", { staffId });
  return res.pin;
}

export async function createStaff({ name, steamId, role }){
  const res = await request("staff:add", { name, steamId, role });
  return { id: res.staffId, pin: res.pin };
}

export async function listStaff(){
  const res = await request("staff:list");
  return res.staff;
}

const ROLE_LABELS = { hote: "Hôte", croupier: "Croupier", admin: "Intendance" };
export function roleLabel(role){ return ROLE_LABELS[role] || role; }

/* Garde d'accès : redirige vers login.html si pas connecté ou rôle non autorisé.
   allowedRoles ex: ['hote','admin']. admin a toujours accès à tout. */
export function requireRole(allowedRoles){
  const staff = getSession();
  if(!staff || !staff.role){
    location.href = "login.html?next=" + encodeURIComponent(location.pathname.split('/').pop());
    return null;
  }
  if(staff.role !== "admin" && !allowedRoles.includes(staff.role)){
    location.href = "index.html";
    return null;
  }
  return staff;
}

/* Remplit le bloc utilisateur de la sidebar (id: sidebarUser / suName / suRole). */
export function renderStaffBadge(){
  const staff = getSession();
  const nameEl = document.getElementById("suName");
  const roleEl = document.getElementById("suRole");
  if(!staff){ return; }
  if(nameEl) nameEl.textContent = staff.name || staff.steamId || "—";
  if(roleEl) roleEl.textContent = roleLabel(staff.role);
}

export function logout(){
  clearSession();
  location.href = "login.html";
}
window.logout = logout;
