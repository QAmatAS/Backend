const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');

// Files are stored on this server, outside of the database:
//   <project>/uploads/foods/<generated-name>.<ext>
//   <project>/uploads/avatars/avatar_<user_id>_<random>.<ext>
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const uploadDir = path.join(UPLOADS_ROOT, 'foods');
const avatarUploadDir = path.join(UPLOADS_ROOT, 'avatars');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(avatarUploadDir, { recursive: true });

// Public URL prefixes used in photo_urls / avatar_url. Do not include the host,
// so the same value works from localhost, a LAN IP or a localtunnel URL.
const UPLOAD_URL_PREFIX = '/uploads/foods';
const AVATAR_URL_PREFIX = '/uploads/avatars';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file

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
    fileSize: MAX_FILE_SIZE,
    files: 5, // max 5 photos per listing
  },
});

// One avatar per upload, named after the owner so the previous file is easy to
// find and delete. The random suffix busts client-side image caches, which would
// otherwise keep showing the old photo when the URL stayed the same.
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarUploadDir),
  filename: (req, file, cb) => {
    const extension = MIME_EXTENSIONS[file.mimetype];
    const owner = sanitizeId(req.user ? req.user.user_id : 'user');
    cb(null, `avatar_${owner}_${crypto.randomBytes(4).toString('hex')}${extension}`);
  },
});

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

function sanitizeId(value) {
  const cleaned = String(value || '')
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

  const base = `Image_${sanitizeId(foodId)}`;

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

/**
 * True only for a file name this server generated for `userId`:
 * avatar_<user_id>_<8 hex>.<ext>. Matching the whole name (not just a prefix)
 * also stops one user_id from matching files of a longer user_id that happens
 * to start with it.
 */
function isAvatarFileOf(userId, filename) {
  if (typeof filename !== 'string' || !userId) return false;

  const owner = sanitizeId(userId);
  return new RegExp(`^avatar_${owner}_[0-9a-f]{8}\\.(jpg|png|webp|gif)$`).test(filename);
}

/**
 * Removes the avatar files belonging to one user. `keepFilename` protects the
 * file that was just uploaded, so replacing an avatar does not delete itself.
 */
async function removeUserAvatars(userId, keepFilename) {
  let names;
  try {
    names = await fsp.readdir(avatarUploadDir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }

  let removed = 0;

  for (const name of names) {
    if (!isAvatarFileOf(userId, name)) continue;
    if (keepFilename && name === keepFilename) continue;

    await fsp.rm(path.join(avatarUploadDir, name), { force: true });
    removed += 1;
  }

  return removed;
}

/**
 * Removes a single stored avatar, but only if it belongs to `userId`. The URL
 * comes from the profile (a user can type anything into avatar_url), so it is
 * never trusted: external URLs, other folders and other users' files are all
 * ignored, and nothing is deleted when the owner is unknown.
 */
async function removeAvatarFile(url, userId) {
  if (typeof url !== 'string' || !url.startsWith(`${AVATAR_URL_PREFIX}/`)) return false;

  const name = path.basename(url);
  if (!isAvatarFileOf(userId, name)) return false;

  await fsp.rm(path.join(avatarUploadDir, name), { force: true });
  return true;
}

module.exports = {
  uploadFoodPhotos,
  uploadAvatar,
  renameUploadedPhotos,
  sanitizeId,
  removeUserAvatars,
  removeAvatarFile,
  isAvatarFileOf,
  uploadDir,
  avatarUploadDir,
  UPLOAD_URL_PREFIX,
  AVATAR_URL_PREFIX,
};
