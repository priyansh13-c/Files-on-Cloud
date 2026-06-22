const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const FileRecord = require('../models/File');

// Escapes characters that have special meaning in HTML to prevent XSS when
// user-controlled values are interpolated into server-rendered HTML responses.
const escapeHtml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

// Helper function to get client IP
const getClientIP = (req) => {
  return req.ip ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         req.headers['x-forwarded-for']?.split(',')[0] ||
         'unknown';
};

// One-way hash of an IP address for privacy-safe analytics storage.
const hashIP = (ip) => {
  const salt = process.env.IP_SALT;
  if (!salt) {
    console.error('[hashIP] IP_SALT environment variable is not set. IP hashing skipped to avoid storing unsalted hashes.');
    return null;
  }
  return crypto.createHash('sha256').update(ip + salt).digest('hex').slice(0, 16);
};

// SHARED HELPER: Optimized via Streams to handle chunked buffering and backpressure
const serveFile = async (req, res, fileDoc) => {
  const clientIP = getClientIP(req);
  const ipHash = hashIP(clientIP);
  const userAgent = (req.get('User-Agent') || 'unknown').slice(0, 256);

  // 1. Structure the privacy-safe analytics entry
  const analyticsEntry = { userAgent, time: new Date() };
  if (ipHash !== null) {
    analyticsEntry.ip = ipHash;
  }

  // Update Download Analytics asynchronously
  await FileRecord.updateOne(
    { code: fileDoc.code },
    {
      $inc: { downloadCount: 1 },
      $push: {
        downloads: {
          $each: [analyticsEntry],
          $slice: -500
        }
      }
    }
  );

  // 2. Sanitize and structure download filename headers
  const nameToDownload = fileDoc.displayName || fileDoc.originalName;
  const safeDownloadName = path.basename(nameToDownload)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim() || 'download';

  const filePath = path.join(__dirname, '..', '..', 'uploads', fileDoc.filename);

  // 3. Set dynamic chunk-friendly headers for download mapping
  res.setHeader('Content-Type', fileDoc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', fileDoc.size); // Crucial for browser progress bars
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeDownloadName)}"`);

  // 4. Create readable stream to keep V8 heap memory minimal (<2MB footprint)
  const fileStream = fs.createReadStream(filePath);

  // Pipe the file chunks straight into the HTTP response object (Handles backpressure)
  fileStream.pipe(res);

  // 5. Stream Pipeline Resiliency: Clear file handlers instantly on manual client cancellation
  req.on('close', () => {
    if (!res.writableEnded) {
      fileStream.destroy(); // Prevent memory/descriptor leaks
      console.log(`[Stream Aborted]: Active download pipeline killed by client for code: ${fileDoc.code}`);
    }
  });

  // Track and log stream failures safely
  fileStream.on('error', (err) => {
    console.error('[Stream Ingestion Error]:', err);
    if (!res.headersSent) {
      res.status(500).send('<h1>Error occurred during streaming data chunks</h1>');
    }
  });
};

// Download file route handler (GET)
const downloadFile = async (req, res) => {
  try {
    const { code } = req.params;

    if (!/^\d{5}$/.test(code)) {
      return res.status(400).send('<h1>Invalid request: code must be exactly 5 digits.</h1>');
    }

    const fileDoc = await FileRecord.findOne({ code });
    if (!fileDoc) {
      return res.status(404).send('<h1>File not found</h1>');
    }

    if (new Date() > fileDoc.expiresAt) {
      return res.status(410).send('<h1>File has expired and been deleted</h1>');
    }

    const filePath = path.join(__dirname, '..', '..', 'uploads', fileDoc.filename);
    try {
      await fs.promises.access(filePath);
    } catch (error) {
      return res.status(404).send('<h1>File missing from server</h1>');
    }

    if (fileDoc.password) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Password Required</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
            button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
            button:hover { background: #0056b3; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>🔒 Password Protected File</h2>
            <p>This file requires a password to download.</p>
            <p style="color: #666; font-size: 14px;">
              Even if you already entered the password on the previous page, please enter it again to continue the download.
            </p>
            <form method="POST" action="/download/${escapeHtml(code)}/verify">
              <input type="password" name="password" placeholder="Enter password" required>
              <br>
              <button type="submit">Download File</button>
            </form>
          </div>
        </body>
        </html>
      `);
    }

    await serveFile(req, res, fileDoc);
  } catch (error) {
    console.error('Download Error:', error);
    res.status(500).send('<h1>Server Error</h1>');
  }
};

// Password verification route handler (POST)
const verifyPassword = async (req, res) => {
  try {
    const { code } = req.params;
    const { password } = req.body;

    if (!/^\d{5}$/.test(code)) {
      return res.status(400).send('<h1>Invalid request: code must be exactly 5 digits.</h1>');
    }

    const fileDoc = await FileRecord.findOne({ code });
    if (!fileDoc) {
      return res.status(404).send('<h1>File not found</h1>');
    }

    if (new Date() > fileDoc.expiresAt) {
      return res.status(410).send('<h1>File has expired and been deleted</h1>');
    }

    const filePath = path.join(__dirname, '..', '..', 'uploads', fileDoc.filename);
    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(404).send('<h1>File missing from server</h1>');
    }

    if (!fileDoc.password) {
      return res.redirect(`/download/${escapeHtml(code)}`);
    }

    const isValidPassword = await fileDoc.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invalid Password</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .error { color: #dc3545; margin: 20px 0; }
            a { color: #007bff; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Invalid Password</h2>
            <p class="error">The password you entered is incorrect.</p>
            <a href="/download/${escapeHtml(code)}">Try Again</a>
          </div>
        </body>
        </html>
      `);
    }

    await serveFile(req, res, fileDoc);
  } catch (error) {
    console.error('Verify Download Error:', error);
    res.status(500).send('<h1>Server Error</h1>');
  }
};

// Short URL proxy handler
const shortenURL = async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  try {
    const response = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`
    );
    if (!response.ok) throw new Error(`TinyURL returned ${response.status}`);
    const shortUrl = await response.text();
    res.json({ shortUrl: shortUrl.trim() });
  } catch (err) {
    console.error('URL shortener error:', err.message);
    res.status(502).json({ error: 'URL shortener unavailable' });
  }
};

module.exports = { downloadFile, verifyPassword, shortenURL };