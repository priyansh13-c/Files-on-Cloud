const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;


// Connect to MongoDB

mongoose.connect("mongodb+srv://priyanshkr138_db_user:2Lz13vwTfnGeFSUu@cluster0.nn2zrb2.mongodb.net/", {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ Connected to MongoDB Atlas"))
.catch(err => console.error("❌ MongoDB connection error:", err));


// File Schema
const fileSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, length: 5 },
  originalName: { type: String, required: true },
  filename: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  uploadDate: { type: Date, default: Date.now },
  downloadCount: { type: Number, default: 0 }
});

const File = mongoose.model('File', fileSchema);

// Middleware - ORDER MATTERS!
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow all file types but could add restrictions here
    cb(null, true);
  }
});

// Generate unique 5-digit code
const generateCode = async () => {
  let code;
  let exists = true;
  
  while (exists) {
    code = Math.floor(10000 + Math.random() * 90000).toString();
    const existingFile = await File.findOne({ code });
    exists = !!existingFile;
  }
  
  return code;
};

// API Routes - Define BEFORE static middleware
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('Upload request received');
    console.log('File:', req.file);
    console.log('Body:', req.body);
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let code = req.body.code;
    
    // If user provided a code, validate it
    if (code) {
      if (!/^\d{5}$/.test(code)) {
        // Clean up uploaded file
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: 'Code must be exactly 5 digits' });
      }
      
      // Check if code already exists
      const existingFile = await File.findOne({ code });
      if (existingFile) {
        // Delete the uploaded file since we can't use this code
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(409).json({ error: 'Code already exists. Please choose a different code.' });
      }
    } else {
      // Generate a unique code
      code = await generateCode();
    }

    // Save file info to database
    const fileDoc = new File({
      code,
      originalName: req.file.originalname,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    await fileDoc.save();
    console.log('File saved to database:', code);

    res.json({
      success: true,
      code,
      message: `File uploaded successfully! Share code: ${code}`
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up uploaded file if there was an error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

app.get('/api/download/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    if (!/^\d{5}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid code format' });
    }

    const fileDoc = await File.findOne({ code });
    if (!fileDoc) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(__dirname, 'uploads', fileDoc.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    // Increment download count
    await File.updateOne({ code }, { $inc: { downloadCount: 1 } });

    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${fileDoc.originalName}"`);
    res.setHeader('Content-Type', fileDoc.mimetype);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Get file info without downloading
app.get('/api/info/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    if (!/^\d{5}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid code format' });
    }

    const fileDoc = await File.findOne({ code }).select('-filename'); // Don't expose internal filename
    if (!fileDoc) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({
      originalName: fileDoc.originalName,
      size: fileDoc.size,
      uploadDate: fileDoc.uploadDate,
      downloadCount: fileDoc.downloadCount,
      sizeFormatted: (fileDoc.size / (1024 * 1024)).toFixed(2) + ' MB'
    });

  } catch (error) {
    console.error('Info error:', error);
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

// Test endpoint to verify server is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!', timestamp: new Date().toISOString() });
});

// Static file serving - AFTER API routes
app.use(express.static('public'));

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST /api/upload - Upload a file');
  console.log('  GET  /api/download/:code - Download a file');
  console.log('  GET  /api/info/:code - Get file info');
  console.log('  GET  /api/test - Test endpoint');
});