const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const downloadSchema = new mongoose.Schema({
  ip: { type: String, required: true },
  userAgent: { type: String, required: true },
  time: { type: Date, default: Date.now }
});

const fileSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, length: 5 },
  originalName: { type: String, required: true },
  displayName: { type: String },
  filename: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  uploadDate: { type: Date, default: Date.now },
  downloadCount: { type: Number, default: 0 },
  downloads: [downloadSchema],
  password: { type: String }, // Hashed password for protected files
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }, // 24 hours default
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } // Optional: track who uploaded
});

// Hash password before saving if provided
fileSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
fileSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return true; // No password set
  return bcrypt.compare(candidatePassword, this.password);
};

// Index for auto-deletion
fileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('FileRecord', fileSchema);