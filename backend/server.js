const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
require("dotenv").config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 10002;

// CORS
app.use(cors());
// Import routes
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const downloadRoutes = require('./routes/download');

// Import models
const FileRecord = require('./models/File');

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 5 auth attempts per windowMs
  message: 'Too many authentication attempts, please try again later.',
});

app.use(limiter);
app.use('/api/auth', authLimiter);


// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
.then(() => console.log("✅ Connected to MongoDB Atlas"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// Middleware
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', uploadRoutes);
app.use('/', downloadRoutes);
app.use('/api',downloadRoutes);

// Legacy routes for backward compatibility (remove after frontend update)
app.get('/api/info/:code', uploadRoutes);
app.get('/api/download/:code', downloadRoutes);

// Auto cleanup expired files - runs every hour
cron.schedule('0 * * * *', async () => {
  try {
    console.log('🧹 Running auto cleanup...');

    const expiredFiles = await FileRecord.find({
      expiresAt: { $lt: new Date() }
    });

    for (const file of expiredFiles) {
      // Delete file from filesystem
      const filePath = path.join(__dirname, '..', 'uploads', file.filename);
      try {
        await fs.promises.access(filePath);
        await fs.promises.unlink(filePath);
        console.log(`Deleted expired file: ${file.filename}`);
      } catch (error) {
        console.error(`Failed to delete expired file: ${file.filename}`, error);
      }

      // Delete from database
      await FileRecord.deleteOne({ _id: file._id });
    }

    if (expiredFiles.length > 0) {
      console.log(`✅ Cleaned up ${expiredFiles.length} expired files`);
    } else {
      console.log('✅ No expired files to clean up');
    }
  } catch (error) {
    console.error('❌ Auto cleanup error:', error);
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Exception:', err.stack);
  res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected error occurred.' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
  console.log('🧹 Auto cleanup scheduled to run every hour');
});

