const express = require('express');
const auth = require('../middleware/auth');

const upload = require("../middleware/upload.js")

const router = express.Router();

const {uploadFile, getFileInfo, getMyFiles, getAnalytics, bulkDeleteFiles, deleteFile ,renameFile} = require("../controller/upload.controller.js");



// Upload file route
router.post('/upload', upload.single('file'), uploadFile);

// Get file info route
router.get('/info/:code',getFileInfo);

// Get analytics route
router.get('/analytics/:code', auth, getAnalytics);

// Get all files uploaded by current user
router.get('/files/me', auth, getMyFiles);


// Bulk Delete API Endpoint
router.delete('/files/bulk', auth, bulkDeleteFiles);

// Delete user file manually
router.delete('/files/:code', auth, deleteFile);

// Rename user file manually
router.put('/files/:code/rename', auth, renameFile);

module.exports = router;