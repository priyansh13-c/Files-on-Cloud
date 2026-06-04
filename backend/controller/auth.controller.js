const jwt = require('jsonwebtoken');
const User = require('../models/User');

const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail"); 

// Signup route
const signup = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    console.log("Signup request body:", req.body);

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(409).json({ error: 'User with this email or username already exists.' });
    }

    // Create new user
    const user = new User({ username, email, password });
    await user.save();

    // Generate JWT token. tv (token version) is embedded so the auth
    // middleware can reject tokens issued before a logout event.
    const token = jwt.sign(
      { userId: user._id, tv: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User created successfully.',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during signup.' });
  }
};

// Login route
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate JWT token including the current token version.
    const token = jwt.sign(
      { userId: user._id, tv: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
};


// Get current user info
const getMyInfo = async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        createdAt: req.user.createdAt
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error getting user info.' });
  }
};


// Logout controller — increments tokenVersion so all previously issued
// tokens for this user are immediately rejected by the auth middleware.
const logout = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
    res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Server error during logout.' });
  }
};


const forgotPassword = async (req, res) => {
  try {
    const brevoConfigured =
      process.env.BREVO_API_KEY &&
      process.env.BREVO_SENDER_EMAIL &&
      process.env.BREVO_SENDER_NAME;

    if (!brevoConfigured) {
      return res.status(503).json({
        success: false,
        message: "Password reset email service is not configured."
      });
    }

    if(!process.env.NODE_ENV){
      return res.status(500).json({ success: false, message: "NODE_ENV is required in .env."});
    }

    if ( process.env.NODE_ENV === "production" && !process.env.PRODUCTION_CLIENT_URL) {
      return res.status(500).json({ success: false, message: "PRODUCTION_CLIENT_URL is required in .env."});
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success : false,
        message: "Email is required"
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase()
    });

    if (user) {
      const resetToken = crypto
        .randomBytes(32)
        .toString("hex");

      const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpire =
        Date.now() + 15 * 60 * 1000; // 15 minutes

      await user.save();

      const finalClientUrl = process.env.NODE_ENV === "production" ? process.env.PRODUCTION_CLIENT_URL : `http://localhost:${process.env.PORT}`;

      const resetUrl =
        `${finalClientUrl}/reset-password.html?token=${resetToken}`;

      await sendEmail({
        toEmail: user.email,
        subject: "Reset Your Password",
        htmlContent: `
          <h2>Password Reset Request</h2>
          <p>Hello ${user.username},</p>

          <p>Click the button below to reset your password:</p>

          <a href="${resetUrl}"
             style="
               background:#2563eb;
               color:white;
               padding:12px 20px;
               text-decoration:none;
               border-radius:6px;
               display:inline-block;
             ">
            Reset Password
          </a>

          <p>This link will expire in 15 minutes.</p>

          <p>If you did not request this reset, please ignore this email.</p>
        `
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "If an account exists with that email, a reset link has been sent."
    });

  } catch (error) {
    console.error("Forgot password error:", error);

    return res.status(500).json({
      success : false,
      message: "Server error"
    });
  }
};


const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success : false,
        message: "Password is required"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success : false,
        message:
          "Password must be at least 6 characters long"
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: {
        $gt: Date.now()
      }
    });

    if (!user) {
      return res.status(400).json({
        success : false,
        message: "Invalid or expired reset token"
      });
    }

    user.password = password;

    user.resetPasswordToken = null;
    user.resetPasswordExpire = null;

    // Optional: invalidate all old JWTs
    user.tokenVersion += 1;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. You will be redirected to login shortly. Please wait....."
    });

  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      success : false,
      message: "Server error"
    });
  }
};

module.exports = {signup, login, getMyInfo, logout, forgotPassword, resetPassword};