/* Session staff (Hôte / Croupier / Admin) — stockée en localStorage.
   Authentification simple par code secret (PIN), pas de mot de passe email.
   Cohérent avec le système de liste blanche déjà utilisé sur les autres sites de l'Ordre. */
import { db, collection, doc, updateDoc, query, where, getDocs, serverTimestamp } from "./firebase-init.js";

const KEY = "sphereIntendanceStaff";

export function getSession(){
  try{ return JSON.parse(localStorage.getItem(KEY)); }catch{ return null; }
}
export function setSession(staff){
  localStorage.setItem(KEY, JSON.stringify(staff));
}
export function clearSession(){
  localStorage.removeItem(KEY);
}

/* Cherche un membre du staff par PIN. Retourne le document (avec id) ou null. */
export async function loginWithPin(pin){
  const q = query(collection(db, "staff"), where("pin", "==", pin.trim()), where("active", "==", true));
  const snap = await getDocs(q);
  if(snap.empty) return null;
  const d = snap.docs[0];
  const staff = { id: d.id, ...d.data() };
  setSession(staff);
  return staff;
}

/* Un membre du staff créé avec un code temporaire doit le remplacer par son
   propre code au premier login (pinConfigured explicitement à false — les
   comptes déjà existants sans ce champ sont considérés configurés, pour ne
   pas bloquer le staff déjà actif). */
export function needsPinSetup(staffMember){
  return staffMember?.pinConfigured === false;
}

/* Remplace le code temporaire par le code personnel choisi par le membre. */
export async function setPermanentPin(staffId, newPin){
  const trimmed = (newPin || "").trim();
  if(trimmed.length < 4) throw new Error("Le code doit contenir au moins 4 caractères.");
  await updateDoc(doc(db, "staff", staffId), { pin: trimmed, pinConfigured: true, pinSetAt: serverTimestamp() });
  const current = getSession();
  if(current && current.id === staffId){
    setSession({ ...current, pin: trimmed, pinConfigured: true });
  }
}

/* Réinitialisation par l'Admin : génère un nouveau code temporaire, le membre
   devra en choisir un nouveau à sa prochaine connexion. */
export async function resetStaffPin(staffId, tempPin){
  await updateDoc(doc(db, "staff", staffId), { pin: tempPin, pinConfigured: false, pinSetAt: null });
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
