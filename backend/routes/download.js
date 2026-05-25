const express = require('express');
const path = require('path');
const fs = require('fs');
const FileRecord = require('../models/File');

const router = express.Router();

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

// Download file route
router.get('/download/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { password } = req.query;

    // Validate code format before using it in any DB query or HTML response.
    // Codes are always exactly 5 digits; anything else is rejected immediately
    // to prevent reflected XSS via malformed code values in server-rendered HTML.
    if (!/^\d{5}$/.test(code)) {
      return res.status(400).send('<h1>Invalid request: code must be exactly 5 digits.</h1>');
    }

    const fileDoc = await FileRecord.findOne({ code });
    if (!fileDoc) {
      return res.status(404).send('<h1>File not found</h1>');
    }

    // Check if file has expired
    if (new Date() > fileDoc.expiresAt) {
      return res.status(410).send('<h1>File has expired and been deleted</h1>');
    }

    const filePath = path.join(__dirname, '..', '..', 'uploads', fileDoc.filename);
    try {
      await fs.promises.access(filePath);
    } catch (error) {
      return res.status(404).send('<h1>File missing from server</h1>');
    }

    // Check password if file is protected
    if (fileDoc.password) {
      if (!password) {
        // Return password prompt page
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Password Required</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
              .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
              button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
              button:hover { background: #0056b3; }
            </style>
          </head>
          <body>
            <div class="container">
              <h2>🔒 Password Protected File</h2>
              <p>This file requires a password to download.</p>
              <form method="GET">
                <input type="password" name="password" placeholder="Enter password" required>
                <br>
                <button type="submit">Download File</button>
              </form>
            </div>
          </body>
          </html>
        `);
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
              <h2>❌ Invalid Password</h2>
              <p class="error">The password you entered is incorrect.</p>
              <a href="/download/${escapeHtml(code)}">Try Again</a>
            </div>
          </body>
          </html>
        `);
      }
    }

    // Record download analytics
    const clientIP = getClientIP(req);
    const userAgent = req.get('User-Agent') || 'unknown';

    await FileRecord.updateOne(
      { code },
      {
        $inc: { downloadCount: 1 },
        $push: {
          downloads: {
            ip: clientIP,
            userAgent: userAgent,
            time: new Date()
          }
        }
      }
    );

    // Send file.
    // Apply a second-layer sanitization of displayName (or originalName) at download time even
    // though it is already sanitized at upload time. This guards against any
    // records that existed in the database before this fix was deployed.
    const nameToDownload = fileDoc.displayName || fileDoc.originalName;
    const safeDownloadName = path.basename(nameToDownload)
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim() || 'download';

    res.download(filePath, safeDownloadName);
  } catch (error) {
    console.error('Download Error:', error);
    res.status(500).send('<h1>Server Error</h1>');
  }
});

module.exports = router;