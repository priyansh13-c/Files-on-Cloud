const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");


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

// Allowlist of file extensions that may be uploaded.
// Client-supplied MIME types are not trusted for security decisions because
// the Content-Type header is fully attacker-controlled. Extension-based
// allowlisting is the primary gate; a magic-byte check can be layered on
// top as defence-in-depth if needed in the future.
const ALLOWED_EXTENSIONS = new Set([
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.md', '.rtf', '.odt', '.ods', '.odp',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff',
  // Audio / Video
  '.mp4', '.mp3', '.wav', '.avi', '.mov', '.mkv', '.flac', '.ogg', '.webm',
  // Archives
  '.zip', '.tar', '.gz', '.7z', '.rar',
  // Data / Config (non-executable)
  '.json', '.xml', '.yaml', '.yml', '.toml', '.ini',
]);

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type "${ext || '(none)'}" is not permitted.`), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: fileFilter
});


module.exports = upload;