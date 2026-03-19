import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Multer for audio uploads
const upload = multer({ dest: 'uploads/' });

// --- API Routes ---

app.post('/api/upload-recording', upload.single('audio'), (req: any, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  // In a real app, upload to Firebase Storage and return URL
  // For now, we'll return a local path (simulated)
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.originalname });
});

// Serve uploads
app.use('/uploads', express.static('uploads'));

// --- Vite Middleware ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
