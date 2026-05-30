const express = require('express');
const auth = require('../middleware/auth');

const {signup, login, getMyInfo, logout} = require("../controller/auth.controller.js");

const router = express.Router();

// Signup route
router.post('/signup', signup);

// Login route
router.post('/login', login);


// Get current user info
router.get('/me', auth, getMyInfo);

// Logout route — increments tokenVersion so all previously issued tokens
// for this user are immediately rejected by the auth middleware.
router.post('/logout', auth, logout);


module.exports = router;