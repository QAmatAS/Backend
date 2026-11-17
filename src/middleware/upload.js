const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');

// Files are stored on this server, outside of the database:
// <project>/uploads/foods/<generated-name>.<ext>
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'foods');
fs.mkdirSync(uploadDir, { recursive: true });

// Public URL prefix used in photo_urls. Do not include the host, so the same
// value works from localhost, a LAN IP or a localtunnel URL.
const UPLOAD_URL_PREFIX = '/uploads/foods';

// Only real image types, with the extension decided by us (never by the client).
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const extension = MIME_EXTENSIONS[file.mimetype];
    const name = `food_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${extension}`;
    cb(null, name);
  },
});

function fileFilter(req, file, cb) {
  if (!MIME_EXTENSIONS[file.mimetype]) {
    const error = new Error('Only JPEG, PNG, WEBP or GIF images are allowed');
    error.status = 400;
    return cb(error);
  }

  cb(null, true);
}

const uploadFoodPhotos = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per photo
    files: 5, // max 5 photos per listing
  },
});

function sanitizeFoodId(foodId) {
  const cleaned = String(foodId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  return cleaned || 'unknown';
}

/**
 * Renames freshly uploaded files to Image_<food_id>.<ext> (the format requested
 * by the API contract). Extra photos get _2, _3, ... suffixes so they stay
 * unique. Runs after the request body is parsed, so the food_id is known.
 */
async function renameUploadedPhotos(files, foodId) {
  if (!files || files.length === 0) return files;

  const base = `Image_${sanitizeFoodId(foodId)}`;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const extension = path.extname(file.filename);
    const name = index === 0 ? `${base}${extension}` : `${base}_${index + 1}${extension}`;
    const destination = path.join(uploadDir, name);

    // Replacing a previous upload for the same food_id is allowed.
    await fsp.rm(destination, { force: true });
    await fsp.rename(file.path, destination);

    file.filename = name;
    file.path = destination;
  }

  return files;
}

module.exports = {
  uploadFoodPhotos,
  renameUploadedPhotos,
  uploadDir,
  UPLOAD_URL_PREFIX,
};
