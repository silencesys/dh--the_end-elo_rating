require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectAndPrepare } = require('./db');

const configRoutes        = require('./routes/config');
const imagesRoutes        = require('./routes/images');
const compareRoutes       = require('./routes/compare');
const sessionRoutes       = require('./routes/sessions');
const downloadRoutes      = require('./routes/download');
const distributionRoutes  = require('./routes/distributions');
const uploadRoutes        = require('./routes/upload');
const bridgeRoutes        = require('./routes/bridge');

const { recomputeAndPersist } = require('./elo');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));

app.use(express.json());

app.use('/images',   express.static(path.join(__dirname, '../images')));
app.use('/previews', express.static(path.join(__dirname, '../previews')));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
}

app.use('/api/config',        configRoutes);
app.use('/api/images',        imagesRoutes);
app.use('/api/compare',       compareRoutes);
app.use('/api/sessions',      sessionRoutes);
app.use('/api/download',      downloadRoutes);
app.use('/api/distributions', distributionRoutes);
app.use('/api/upload-images', uploadRoutes);
app.use('/api/bridge',        bridgeRoutes);

if (process.env.NODE_ENV === 'production') {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

const PORT = parseInt(process.env.PORT || '3001', 10);

connectAndPrepare()
  .then(() => {
    const server = app.listen(PORT, async () => {
      console.log(`Server running at http://localhost:${PORT}`);
      try {
        const K        = parseInt(process.env.ELO_K_FACTOR  || '100', 10);
        const nReplays = parseInt(process.env.ELO_N_REPLAYS || '100', 10);
        await recomputeAndPersist(K, nReplays);
        console.log(`ELO ratings recomputed (K=${K}, n=${nReplays} replays)`);
      } catch (err) {
        console.warn('Startup ELO recompute failed:', err.message);
      }
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `Port ${PORT} is already in use. Stop the other process (e.g. lsof -i :${PORT}) or set PORT in .env.`
        );
        process.exit(1);
      }
      throw err;
    });
  })
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
