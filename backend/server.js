require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 5000;
const BUCKET = process.env.S3_BUCKET_NAME;

if (!process.env.AWS_REGION || !BUCKET) {
  console.warn('WARNING: AWS_REGION or S3_BUCKET_NAME is missing; S3 file operations will fail.');
}

const s3 = new S3Client({ region: process.env.AWS_REGION });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    if (allowed.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, JPG, PNG, TXT, DOC, DOCX.'));
  },
});

app.use(cors());
app.use(express.json());

function safeDownloadName(name) {
  return String(name || 'download').replace(/[\r\n"]/g, '_');
}

async function uploadToS3(file) {
  if (!BUCKET) throw new Error('S3_BUCKET_NAME is not configured');
  const extension = path.extname(file.originalname).toLowerCase();
  const key = `items/${crypto.randomUUID()}${extension}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: file.buffer,
    ContentLength: file.size,
    ContentType: file.mimetype,
    // Keep objects private. Do not set ACL: public-read.
  }));
  return key;
}

async function deleteFromS3(key) {
  if (!key || !BUCKET) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// ---- Health check ----
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});

// ---- READ all ----
app.get('/api/items', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM items ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// ---- READ one ----
app.get('/api/items/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// ---- CREATE (multipart/form-data: title, description, file) ----
app.post('/api/items', upload.single('file'), async (req, res) => {
  const { title, description } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  let uploadedKey = null;
  try {
    if (req.file) uploadedKey = await uploadToS3(req.file);

    const [result] = await pool.query(
      'INSERT INTO items (title, description, file_name, original_name) VALUES (?, ?, ?, ?)',
      [title.trim(), description || '', uploadedKey, req.file ? req.file.originalname : null]
    );
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    if (uploadedKey) {
      try { await deleteFromS3(uploadedKey); } catch (cleanupErr) { console.error('S3 cleanup failed:', cleanupErr); }
    }
    res.status(500).json({ error: 'Failed to create item or upload file' });
  }
});

// ---- UPDATE (file optional; if sent, it replaces the old one) ----
app.put('/api/items/:id', upload.single('file'), async (req, res) => {
  const { title, description } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  let newKey = null;
  try {
    const [existing] = await pool.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Item not found' });

    if (req.file) newKey = await uploadToS3(req.file);

    if (req.file) {
      await pool.query(
        'UPDATE items SET title=?, description=?, file_name=?, original_name=? WHERE id=?',
        [title.trim(), description || '', newKey, req.file.originalname, req.params.id]
      );
      // Delete old S3 object only after the DB points to the replacement.
      if (existing[0].file_name) {
        try { await deleteFromS3(existing[0].file_name); }
        catch (cleanupErr) { console.error('Could not delete replaced S3 object:', cleanupErr); }
      }
    } else {
      await pool.query('UPDATE items SET title=?, description=? WHERE id=?', [
        title.trim(), description || '', req.params.id,
      ]);
    }

    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    if (newKey) {
      try { await deleteFromS3(newKey); } catch (cleanupErr) { console.error('S3 cleanup failed:', cleanupErr); }
    }
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// ---- Download: return a short-lived URL for the private S3 object ----
app.get('/api/files/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT file_name, original_name FROM items WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length || !rows[0].file_name) {
      return res.status(404).json({ error: 'File not found' });
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: rows[0].file_name,
      ResponseContentDisposition: `attachment; filename="${safeDownloadName(rows[0].original_name)}"`,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 300 });
    res.redirect(302, url);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create download link' });
  }
});

// ---- DELETE ----
app.delete('/api/items/:id', async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Item not found' });

    await pool.query('DELETE FROM items WHERE id = ?', [req.params.id]);
    if (existing[0].file_name) {
      try { await deleteFromS3(existing[0].file_name); }
      catch (s3Err) { console.error('Could not delete S3 object:', s3Err); }
    }
    res.json({ message: 'Item deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ---- Error handler ----
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10 MB)' : err.message
    });
  }
  if (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Invalid request' });
  }
  next();
});

// ---- Create table if missing, then start ----
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(150) NOT NULL,
      description TEXT,
      file_name VARCHAR(255) NULL,
      original_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    console.log('Database connected');
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));
})();
