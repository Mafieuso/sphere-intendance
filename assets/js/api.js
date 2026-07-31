/* Client Socket.io — remplace les appels Firestore directs du navigateur.
   Le navigateur ne parle plus jamais à Firebase : tout passe par ce socket,
   qui parle au serveur Node.js (seul détenteur des identifiants Firebase). */
import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";

const TOKEN_KEY = "sphereIntendanceToken";

export function getToken(){ return localStorage.getItem(TOKEN_KEY); }
export function setToken(token){ localStorage.setItem(TOKEN_KEY, token); }
export function clearToken(){ localStorage.removeItem(TOKEN_KEY); }

let socket = null;
let ready = null; // se résout une fois connecté ET (si un token existe) authentifié
let resolveReady = null;
const reconnectCallbacks = [];

function armReady(){
  ready = new Promise((resolve) => { resolveReady = resolve; });
}

/* Un jeton présent mais rejeté (expiré, invalide) laissait jusqu'ici la
   page tourner indéfiniment : "ready" se résolvait quand même, puis chaque
   requête protégée échouait une à une ("Réservé à l'Intendance.", etc.)
   sans jamais remplacer les indicateurs de chargement. On détecte ce rejet
   explicitement (le serveur renvoie {ok:false} sur auth:token) et on renvoie
   proprement vers la connexion plutôt que de laisser la page dans les limbes. */
function handleExpiredSession(){
  const wasStaff = !!localStorage.getItem("sphereIntendanceStaff");
  const wasPlayer = !!localStorage.getItem("sphereIntendancePlayer");
  clearToken();
  localStorage.removeItem("sphereIntendanceStaff");
  localStorage.removeItem("sphereIntendancePlayer");
  if(wasStaff) location.href = "/login.html?expired=1";
  else if(wasPlayer) location.href = "/carte.html?expired=1";
}

export function getSocket(){
  if(socket) return socket;
  socket = io({ autoConnect: true });
  armReady();
  let first = true;
  socket.on("connect", () => {
    const token = getToken();
    const afterAuth = (ack) => {
      if(token && !ack?.ok){ handleExpiredSession(); return; }
      resolveReady();
      if(first){ first = false; return; }
      reconnectCallbacks.forEach(cb => { try{ cb(); }catch(e){ console.error(e); } });
    };
    if(token) socket.emit("auth:token", token, afterAuth);
    else afterAuth();
  });
  /* Une déconnexion invalide l'authentification de cette socket — toute
     requête émise pendant la coupure doit attendre la prochaine connexion
     et son "auth:token", pas partir immédiatement vers un socket mort. */
  socket.on("disconnect", armReady);
  return socket;
}

/* Appelé après chaque reconnexion (ex: le serveur Render se réveille après
   une mise en veille) pour permettre à une page de rejoindre à nouveau les
   salons dont elle a besoin (l'appartenance à un salon ne survit pas à une
   reconnexion réseau). */
export function onReconnect(callback){
  reconnectCallbacks.push(callback);
}

/* Émission avec accusé de réception, sous forme de promesse. Attend que la
   connexion soit prête (et authentifiée) avant d'émettre, pour ne jamais
   arriver au serveur avant "auth:token" — sinon un appel authentifié fait
   dès le chargement de la page (avant même que la socket soit connectée)
   partirait trop tôt et se ferait rejeter comme non-authentifié. */
export function request(event, payload = {}){
  getSocket();
  return ready.then(() => new Promise((resolve, reject) => {
    socket.emit(event, payload, (res) => {
      if(res && res.ok === false) reject(new Error(res.error || "Erreur serveur."));
      else resolve(res);
    });
  }));
}

export function on(event, handler){ getSocket().on(event, handler); }
export function off(event, handler){ getSocket().off(event, handler); }
