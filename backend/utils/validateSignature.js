// utils/validateFileSignature.js

const fs = require("fs");
const path = require("path");
const { fileTypeFromBuffer } = require("file-type");

const SIGNATURE_CHECK_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".zip",
  ".rar",
  ".7z",
  ".gz",
  ".mp4",
  ".mp3",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".webm",
  ".flac",
  ".ogg",
  ".tif",
]);

const DETECTED_EXTENSION_ALIASES = {
  ".jpg": new Set(["jpg", "jpeg"]),
  ".jpeg": new Set(["jpg", "jpeg"]),
  ".tif": new Set(["tif", "tiff"]),
  ".tiff": new Set(["tif", "tiff"]),
};

async function validateFileSignature(filePath, originalName) {

  const uploadedExt = path.extname(originalName).toLowerCase();

  // Skip magic-byte validation for text-based files
  if (!SIGNATURE_CHECK_EXTENSIONS.has(uploadedExt)) {
    return {
      valid: true
    };
  }

  const handle = await fs.promises.open(filePath, "r");
  let detectedType;
  try {
    const header = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    detectedType = await fileTypeFromBuffer(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }

  if (!detectedType) {
    return {
      valid: false,
      reason: "Unable to determine file type"
    };
  }

  const allowedDetectedExts =
  DETECTED_EXTENSION_ALIASES[uploadedExt] ??
  new Set([uploadedExt.slice(1)]);

  if (!allowedDetectedExts.has(detectedType.ext)) {
    return {
      valid: false,
      reason: `Extension mismatch. Expected .${detectedType.ext}`
    };
  }

  return {
    valid: true,
    detectedType
  };
}

module.exports = validateFileSignature;