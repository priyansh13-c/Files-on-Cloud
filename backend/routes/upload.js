const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const FileRecord = require('../models/File');
const auth = require('../middleware/auth');

const router = express.Router();

// File storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// File filter to reject dangerous file types
const fileFilter = (req, file, cb) => {
  const dangerousTypes = [
    'application/x-msdownload', // .exe
    'application/x-msdos-program', // .exe
    'application/x-executable', // .exe
    'application/x-shockwave-flash', // .swf
    'application/java-archive', // .jar
    'application/x-ms-installer', // .msi
    'application/vnd.microsoft.portable-executable' // .exe
  ];

  if (dangerousTypes.includes(file.mimetype)) {
    return cb(new Error('File type not allowed for security reasons.'), false);
  }

  cb(null, true);
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: fileFilter
});

// Helper function to generate unique code
const generateCode = async () => {
  let code, exists = true;
  while (exists) {
    code = Math.floor(10000 + Math.random() * 90000).toString();
    exists = await FileRecord.findOne({ code });
  }
  return code;
};

// Helper function to parse expiration time
const parseExpiration = (expiration) => {
  const now = Date.now();
  switch (expiration) {
    case '1h': return new Date(now + 1 * 60 * 60 * 1000);
    case '6h': return new Date(now + 6 * 60 * 60 * 1000);
    case '24h': return new Date(now + 24 * 60 * 60 * 1000);
    case '7d': return new Date(now + 7 * 24 * 60 * 60 * 1000);
    default: return new Date(now + 24 * 60 * 60 * 1000); // Default 24h
  }
};

// Upload file route
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    let { code, password, expiration } = req.body;
    if (code) {
      if (!/^\d{5}$/.test(code)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Code must be exactly 5 digits.' });
      }
      const existingFile = await FileRecord.findOne({ code });
      if (existingFile) {
        fs.unlinkSync(req.file.path);
        return res.status(409).json({ error: 'This code is already in use.' });
      }
    } else {
      code = await generateCode();
    }

    const expiresAt = parseExpiration(expiration);

    const newFileRecord = new FileRecord({
      code,
      originalName: req.file.originalname,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      password: password || undefined, // Only set if provided
      expiresAt,
      uploadedBy: req.user ? req.user._id : null
    });

    await newFileRecord.save();

    // Generate QR code
    const downloadUrl = `${req.protocol}://${req.get('host')}/download/${code}`;
    const qrCodeDataURL = await QRCode.toDataURL(downloadUrl);

    console.log(`File saved to database with code: ${code}`);
    res.status(201).json({
      success: true,
      code,
      message: `File uploaded! Your code is: ${code}`,
      downloadUrl,
      qrCode: qrCodeDataURL,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Upload Error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Server error during file upload.' });
  }
});

// Get file info route
router.get('/info/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const fileDoc = await FileRecord.findOne({ code }).select('-filename -__v -downloads');
    if (!fileDoc) {
      return res.status(404).json({ error: 'File not found with this code.' });
    }

    res.json({
      originalName: fileDoc.originalName,
      size: fileDoc.size,
      uploadDate: fileDoc.uploadDate,
      downloadCount: fileDoc.downloadCount,
      sizeFormatted: (fileDoc.size / (1024 * 1024)).toFixed(2) + ' MB',
      hasPassword: !!fileDoc.password,
      expiresAt: fileDoc.expiresAt
    });
  } catch (error) {
    console.error('Info Error:', error);
    res.status(500).json({ error: 'Failed to retrieve file info.' });
  }
});

// Get analytics route
router.get('/analytics/:code', auth, async (req, res) => {
  try {
    const { code } = req.params;
    const fileDoc = await FileRecord.findOne({ code });

    if (!fileDoc) {
      return res.status(404).json({ error: 'File not found with this code.' });
    }

    // Check if user owns this file
    if (fileDoc.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. You can only view analytics for your own files.' });
    }

    const recentDownloads = fileDoc.downloads
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 10)
      .map(download => ({
        ip: download.ip,
        userAgent: download.userAgent,
        time: download.time
      }));

    res.json({
      totalDownloads: fileDoc.downloadCount,
      recentDownloads
    });
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ error: 'Failed to retrieve analytics.' });
  }
});

module.exports = router;