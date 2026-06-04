const express = require('express');
const rateLimit = require('express-rate-limit');
const { shortenURL, verifyPassword, downloadFile } = require('../controller/download.controller.js');

const router = express.Router();

// Dedicated rate limiter for password-verify attempts.
// Only failed attempts count against the limit (skipSuccessfulRequests: true)
// so legitimate users who know the password are not penalised.
// 5 attempts per 15 minutes per IP matches the authLimiter semantics in server.js.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password attempts, please try again later.' },
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});




// Download file route (GET) -- shows password form for protected files,
// streams file directly for unprotected ones.
router.get('/download/:code', downloadFile);

// Password verification route (POST) -- receives the password in the request
// body (never in the URL) and streams the file if the password is correct.
// verifyLimiter restricts each IP to 5 failed attempts per 15-minute window,
// preventing brute-force attacks against protected-file passwords.
router.post('/download/:code/verify', verifyLimiter, verifyPassword);

// Short URL proxy — calls TinyURL server-side so the browser avoids CORS issues
router.get('/api/shorten', shortenURL);

module.exports = router;