import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

import { setupConfigRoutes } from './server/routes/config';
import { setupChatRoutes } from './server/routes/chat';
import { setupMemoryRoutes } from './server/routes/memory';
import { setupAudioRoutes } from './server/routes/audio';
import { setupWorkspaceRoutes } from './server/routes/workspace';
import { serverLockbox } from './server/services/lockbox';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Global CORS & Content security for iframe / mobile environments
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Mount modular routes
  setupConfigRoutes(app);
  setupChatRoutes(app);
  setupMemoryRoutes(app);
  setupAudioRoutes(app);
  setupWorkspaceRoutes(app);

  // Vite middleware for development
  if (serverLockbox.config('NODE_ENV') !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
