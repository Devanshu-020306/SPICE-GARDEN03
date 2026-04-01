'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
});
app.set('io', io);

// ── Socket manager ────────────────────────────────────────────────────────────
const { initializeSocket } = require('./socket/socketManager');
initializeSocket(io);

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  })
);

// ── Payment routes (mounted BEFORE express.json() so the webhook handler
//    can use express.raw() for HMAC signature verification) ──────────────────
app.use('/api/payment', require('./routes/payment'));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static('public'));

// ── Root redirect ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/start.html'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  if (!dbReady) {
    return res.status(503).json({ error: 'Service temporarily unavailable.' });
  }
  return res.status(200).json({ status: 'ok' });
});

// ── PWA icon endpoint ─────────────────────────────────────────────────────────
app.get('/icons/icon-:size.png', (req, res) => {
  const size = parseInt(req.params.size) || 192;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size*0.2)}" fill="#1A0A00"/>
    <circle cx="${size/2}" cy="${size/2}" r="${size*0.35}" fill="none" stroke="#F5A623" stroke-width="${size*0.015}" opacity="0.4"/>
    <circle cx="${size/2}" cy="${size/2}" r="${size*0.25}" fill="none" stroke="#C8410B" stroke-width="${size*0.012}" opacity="0.5"/>
    <text x="${size/2}" y="${Math.round(size*0.65)}" font-size="${Math.round(size*0.42)}" text-anchor="middle" font-family="serif">🪔</text>
  </svg>`;
  res.set('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// ── Public tables endpoint (for start.html) ───────────────────────────────────
app.get('/api/tables-public', async (_req, res, next) => {
  try {
    const Table = require('./models/Table');
    const tables = await Table.find({}).select('tableNumber capacity location currentSessionId status').sort({ tableNumber: 1 });
    res.json(tables);
  } catch (err) { next(err); }
});

// ── API routes (registered after models are loaded) ───────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/qr', require('./routes/qr'));
app.use('/api/tables', require('./routes/tables'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/analytics', require('./routes/analytics'));

// ── Global error middleware ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error.';
  res.status(status).json({ error: message });
});

// ── MongoDB connection + server start ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

async function start() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`TableQR server running on port ${PORT}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// Only start listening if not on Vercel
if (process.env.VERCEL !== '1') {
  start();
} else {
  // On Vercel: connect to DB lazily on first request
  let dbConnected = false;
  app.use(async (_req, _res, next) => {
    if (!dbConnected && MONGO_URI) {
      try { await mongoose.connect(MONGO_URI); dbConnected = true; } catch {}
    }
    next();
  });
}

module.exports = app;
