/* Client Socket.io — remplace les appels Firestore directs du navigateur.
   Le navigateur ne parle plus jamais à Firebase : tout passe par ce socket,
   qui parle au serveur Node.js (seul détenteur des identifiants Firebase). */
import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";

const TOKEN_KEY = "sphereIntendanceToken";

export function getToken(){ return localStorage.getItem(TOKEN_KEY); }
export function setToken(token){ localStorage.setItem(TOKEN_KEY, token); }
export function clearToken(){ localStorage.removeItem(TOKEN_KEY); }

let socket = null;
const reconnectCallbacks = [];

export function getSocket(){
  if(socket) return socket;
  socket = io({ autoConnect: true });
  let first = true;
  socket.on("connect", () => {
    const token = getToken();
    const afterAuth = () => {
      if(first){ first = false; return; }
      reconnectCallbacks.forEach(cb => { try{ cb(); }catch(e){ console.error(e); } });
    };
    if(token) socket.emit("auth:token", token, afterAuth);
    else afterAuth();
  });
  return socket;
}

/* Appelé après chaque reconnexion (ex: le serveur Render se réveille après
   une mise en veille) pour permettre à une page de rejoindre à nouveau les
   salons dont elle a besoin (l'appartenance à un salon ne survit pas à une
   reconnexion réseau). */
export function onReconnect(callback){
  reconnectCallbacks.push(callback);
}

/* Émission avec accusé de réception, sous forme de promesse. */
export function request(event, payload = {}){
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (res) => {
      if(res && res.ok === false) reject(new Error(res.error || "Erreur serveur."));
      else resolve(res);
    });
  });
}

export function on(event, handler){ getSocket().on(event, handler); }
export function off(event, handler){ getSocket().off(event, handler); }
