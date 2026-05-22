const express = require('express');
const path = require('path');
const fs = require('fs');
const FileRecord = require('../models/File');

const router = express.Router();

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
              <a href="/download/${code}">Try Again</a>
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

    // Send file
    res.download(filePath, fileDoc.originalName);
  } catch (error) {
    console.error('Download Error:', error);
    res.status(500).send('<h1>Server Error</h1>');
  }
});

module.exports = router;