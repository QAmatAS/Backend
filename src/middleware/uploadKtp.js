const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');

// KTP photos are identity documents, so they live OUTSIDE the public /uploads
// folder (which Express serves to everybody without a login):
//   <project>/private_uploads/ktp/ktp_<user_id>_<8 hex>.<ext>
// The only way to read one is GET /api/volunteers/:id/ktp, which checks the
// caller first. The folder is created on the first upload, not at boot.
const PRIVATE_ROOT = path.join(__dirname, '..', '..', 'private_uploads');
const ktpDir = path.join(PRIVATE_ROOT, 'ktp');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Only real image types, with the extension decided by us (never by the client).
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// The exact shape of every file name this server generates. Anything else read
// from the database is treated as untrusted and never touches the disk.
const KTP_FILENAME_PATTERN = /^ktp_[A-Za-z0-9_-]{1,64}_[0-9a-f]{8}\.(jpg|png|webp)$/;

function sanitizeId(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);

  return cleaned || 'unknown';
}

function isKtpFilename(name) {
  return typeof name === 'string' && KTP_FILENAME_PATTERN.test(name);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(ktpDir, { recursive: true }, (err) => cb(err, ktpDir));
  },
  filename: (req, file, cb) => {
    const extension = MIME_EXTENSIONS[file.mimetype];
    const owner = sanitizeId(req.user ? req.user.user_id : 'user');
    cb(null, `ktp_${owner}_${crypto.randomBytes(4).toString('hex')}${extension}`);
  },
});

function fileFilter(req, file, cb) {
  if (!MIME_EXTENSIONS[file.mimetype]) {
    const error = new Error('KTP must be a JPEG, PNG or WEBP image');
    error.status = 400;
    return cb(error);
  }

  cb(null, true);
}

// One KTP photo per application (multipart field name: ktp).
const uploadKtp = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

/**
 * Removes a stored KTP file, but only when the name is one this server generated.
 * Returns true when a file name was valid (whether or not the file still existed).
 */
async function removeKtpFile(name) {
  if (!isKtpFilename(name)) return false;

  await fsp.rm(path.join(ktpDir, name), { force: true });
  return true;
}

module.exports = {
  uploadKtp,
  removeKtpFile,
  isKtpFilename,
  sanitizeId,
  ktpDir,
  MIME_EXTENSIONS,
  KTP_FILENAME_PATTERN,
};
