const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 10000;

// Connect to MongoDB
mongoose.connect("mongodb+srv://priyanshkr138_db_user:2Lz13vwTfnGeFSUu@cluster0.nn2zrb2.mongodb.net/", {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ Connected to MongoDB Atlas"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// --- Database Model ---
const fileSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, length: 5 },
  originalName: { type: String, required: true },
  filename: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  uploadDate: { type: Date, default: Date.now },
  downloadCount: { type: Number, default: 0 }
});

// FIX: Renamed the model variable to `FileRecord` to avoid any potential conflicts.
const FileRecord = mongoose.model('FileRecord', fileSchema);

// --- Middleware ---
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- File Storage Configuration ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

// --- Helper Function ---
const generateCode = async () => {
  let code, exists = true;
  while (exists) {
    code = Math.floor(10000 + Math.random() * 90000).toString();
    // Use the new model name `FileRecord`
    exists = await FileRecord.findOne({ code });
  }
  return code;
};

// --- API Routes ---

// Upload a file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    let { code } = req.body;
    if (code) {
      if (!/^\d{5}$/.test(code)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Code must be exactly 5 digits.' });
      }
      // Use the new model name `FileRecord`
      const existingFile = await FileRecord.findOne({ code });
      if (existingFile) {
        fs.unlinkSync(req.file.path);
        return res.status(409).json({ error: 'This code is already in use.' });
      }
    } else {
      code = await generateCode();
    }

    // Use the new model name `FileRecord`
    const newFileRecord = new FileRecord({
      code,
      originalName: req.file.originalname,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
    await newFileRecord.save();
    console.log(`File saved to database with code: ${code}`);
    res.status(201).json({ success: true, code, message: `File uploaded! Your code is: ${code}` });
  } catch (error) {
    console.error('Upload Error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Server error during file upload.' });
  }
});

// Get file info
app.get('/api/info/:code', async (req, res) => {
  try {
    const { code } = req.params;
    // Use the new model name `FileRecord`
    const fileDoc = await FileRecord.findOne({ code }).select('-filename -__v');
    if (!fileDoc) return res.status(404).json({ error: 'File not found with this code.' });
    res.json({
      originalName: fileDoc.originalName,
      size: fileDoc.size,
      uploadDate: fileDoc.uploadDate,
      downloadCount: fileDoc.downloadCount,
      sizeFormatted: (fileDoc.size / (1024 * 1024)).toFixed(2) + ' MB'
    });
  } catch (error) {
    console.error('Info Error:', error);
    res.status(500).json({ error: 'Failed to retrieve file info.' });
  }
});

// Download a file
app.get('/api/download/:code', async (req, res) => {
  try {
    const { code } = req.params;
    // Use the new model name `FileRecord`
    const fileDoc = await FileRecord.findOne({ code });
    if (!fileDoc) return res.status(404).send('<h1>File not found</h1>');
    
    const filePath = path.join(__dirname, '..', 'uploads', fileDoc.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('<h1>File missing from server</h1>');
    
    // Use the new model name `FileRecord`
    await FileRecord.updateOne({ code }, { $inc: { downloadCount: 1 } });
    res.download(filePath, fileDoc.originalName);
  } catch (error) {
    console.error('Download Error:', error);
    res.status(500).send('<h1>Server Error</h1>');
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});

