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
    fs.promises.access(uploadDir)
      .then(() => cb(null, uploadDir))
      .catch(async () => {
        try {
          await fs.promises.mkdir(uploadDir, { recursive: true });
          cb(null, uploadDir);
        } catch (error) {
          cb(error);
        }
      });
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

    let { code, password, expiration, customName } = req.body;
    if (code) {
      if (!/^\d{5}$/.test(code)) {
        await fs.promises.unlink(req.file.path);
        return res.status(400).json({ error: 'Code must be exactly 5 digits.' });
      }
      const existingFile = await FileRecord.findOne({ code });
      if (existingFile) {
        await fs.promises.unlink(req.file.path);
        return res.status(409).json({ error: 'This code is already in use.' });
      }
    } else {
      code = await generateCode();
    }

    // Anonymous uploads are capped at 24 hours regardless of the requested
    // expiration. This limits the maximum lifetime of ownerless orphan files
    // to a single cron cycle and prevents disk exhaustion via repeated
    // long-lived anonymous uploads. Authenticated users retain full expiry choice.
    const effectiveExpiration = req.user ? expiration : '24h';
    const expiresAt = parseExpiration(effectiveExpiration);

    // Sanitize the original filename before persisting it.
    // path.basename strips any directory components (path traversal).
    // The regex removes ASCII control characters including CR (0x0d) and LF (0x0a)
    // that would allow HTTP header injection via the Content-Disposition header.
    const safeName = path.basename(req.file.originalname)
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();
    const sanitizedOriginalName = safeName || 'download';

    const originalExt = path.extname(sanitizedOriginalName);
    let displayName = sanitizedOriginalName;
    if (customName && customName.trim()) {
      let cleanedCustomName = path.basename(customName).replace(/[\x00-\x1f\x7f]/g, '').trim();
      if (cleanedCustomName) {
        if (originalExt && !cleanedCustomName.toLowerCase().endsWith(originalExt.toLowerCase())) {
          cleanedCustomName += originalExt;
        }
        displayName = cleanedCustomName;
      }
    }

    const newFileRecord = new FileRecord({
      code,
      originalName: sanitizedOriginalName,
      displayName,
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
    if (req.file) {
      try {
        await fs.promises.access(req.file.path);
        await fs.promises.unlink(req.file.path);
      } catch (cleanupError) {
        console.error('Failed to remove uploaded file after error:', cleanupError);
      }
    }
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
      originalName: fileDoc.displayName || fileDoc.originalName,
      realOriginalName: fileDoc.originalName,
      displayName: fileDoc.displayName || fileDoc.originalName,
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

    // Check if user owns this file.
    // fileDoc.uploadedBy is null for files uploaded anonymously (without a session).
    // Calling .toString() on null throws a TypeError, crashing the route and returning
    // a 500. Guard the null case explicitly and return 403 instead -- anonymous files
    // have no owner, so no authenticated user has access to their analytics.
    if (!fileDoc.uploadedBy || fileDoc.uploadedBy.toString() !== req.user._id.toString()) {
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
// Get all files uploaded by current user
router.get('/files/me', auth, async (req, res) => {
  try {
    const files = await FileRecord.find({ uploadedBy: req.user._id })
      .select('-__v -password') // exclude password hash and version
      .sort({ uploadDate: -1 });
    res.json({ files });
  } catch (error) {
    console.error('Get user files error:', error);
    res.status(500).json({ error: 'Failed to retrieve files.' });
  }
});

// Delete user file manually
router.delete('/files/:code', auth, async (req, res) => {
  try {
    const { code } = req.params;
    const fileDoc = await FileRecord.findOne({ code });

    if (!fileDoc) {
      return res.status(404).json({ error: 'File not found.' });
    }

    if (!fileDoc.uploadedBy || fileDoc.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. You can only delete your own files.' });
    }

    // Delete file from disk
    const filePath = path.join(__dirname, '..', '..', 'uploads', fileDoc.filename);
    try {
      await fs.promises.access(filePath);
      await fs.promises.unlink(filePath);
    } catch (error) {
      console.error('Failed to delete file from disk:', error);
    }

    // Delete from DB
    await FileRecord.deleteOne({ _id: fileDoc._id });

    res.json({ message: 'File deleted successfully.' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file.' });
  }
});

// Rename user file manually
router.put('/files/:code/rename', auth, async (req, res) => {
  try {
    const { code } = req.params;
    const { customName } = req.body;

    if (!customName || !customName.trim()) {
      return res.status(400).json({ error: 'New filename is required.' });
    }

    const fileDoc = await FileRecord.findOne({ code });

    if (!fileDoc) {
      return res.status(404).json({ error: 'File not found.' });
    }

    if (!fileDoc.uploadedBy || fileDoc.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. You can only rename your own files.' });
    }

    const originalExt = path.extname(fileDoc.originalName);
    let cleanedCustomName = path.basename(customName).replace(/[\x00-\x1f\x7f]/g, '').trim();
    
    if (!cleanedCustomName) {
      return res.status(400).json({ error: 'Invalid filename.' });
    }

    // Append the original file extension if missing from the new custom filename
    if (originalExt && !cleanedCustomName.toLowerCase().endsWith(originalExt.toLowerCase())) {
      cleanedCustomName += originalExt;
    }

    fileDoc.displayName = cleanedCustomName;
    await fileDoc.save();

    res.json({ success: true, message: 'File renamed successfully.', displayName: cleanedCustomName });
  } catch (error) {
    console.error('Rename file error:', error);
    res.status(500).json({ error: 'Failed to rename file.' });
  }
});

module.exports = router;