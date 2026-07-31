/* Conversion des documents Firestore (Timestamps) en JSON transmissible par
   Socket.io, et retrait systématique des champs sensibles (PIN) sauf usage
   explicitement autorisé (ex: l'Hôte doit pouvoir relire le PIN d'une carte
   pour le transmettre au joueur). */
function millis(ts){
  if(!ts) return null;
  if(typeof ts.toMillis === "function") return ts.toMillis();
  return ts;
}

export function serializeStaff(id, data, { includePin = false } = {}){
  return {
    id, name: data.name, steamId: data.steamId, role: data.role, active: data.active,
    pinConfigured: data.pinConfigured !== false,
    pinSetAt: millis(data.pinSetAt),
    createdAt: millis(data.createdAt),
    ...(includePin ? { pin: data.pin } : {})
  };
}

export function serializeCard(id, data, { includePin = false } = {}){
  return {
    id, steamId: data.steamId, playerName: data.playerName, balance: data.balance || 0,
    status: data.status || "active",
    createdAt: millis(data.createdAt), lastTransactionAt: millis(data.lastTransactionAt),
    ...(includePin ? { pin: data.pin } : {})
  };
}

export function serializeTransaction(id, data){
  return {
    id, cardId: data.cardId, steamId: data.steamId, playerName: data.playerName,
    type: data.type, amount: data.amount, balanceAfter: data.balanceAfter,
    staffName: data.staffName || null, gameId: data.gameId || null, note: data.note || "",
    createdAt: millis(data.createdAt)
  };
}

export function serializeLog(id, data){
  return {
    id, action: data.action, detail: data.detail || "",
    steamId: data.steamId || null, playerName: data.playerName || null,
    staffId: data.staffId || null, staffName: data.staffName || null,
    amount: data.amount ?? null, gameId: data.gameId || null,
    createdAt: millis(data.createdAt)
  };
}
