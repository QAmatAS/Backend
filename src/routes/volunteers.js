const express = require('express');

const Volunteer = require('../models/Volunteer');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadKtp, removeKtpFile, isKtpFilename, ktpDir } = require('../middleware/uploadKtp');
const { httpError, parseEnumParam, parseBoundedInt } = require('../utils/validation');

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_REASON_LENGTH = 500;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns the ways people type an Indonesian WhatsApp number into one canonical
 * form (+62...). Returns null when the result is not a plausible number.
 *   "0812-3456-7890" -> "+6281234567890"      "62812..." -> "+62812..."
 *   "+62 812 3456 7890" -> "+6281234567890"   "0062812..." -> "+62812..."
 */
function normalizeWhatsapp(raw) {
  const compact = String(raw).replace(/[\s().-]/g, '');
  let normalized = compact;

  if (/^00[0-9]+$/.test(compact)) normalized = `+${compact.slice(2)}`;
  else if (/^0[0-9]+$/.test(compact)) normalized = `+62${compact.slice(1)}`;
  else if (/^62[0-9]+$/.test(compact)) normalized = `+${compact}`;

  return PHONE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * The application travels as multipart: the fields as JSON in `data` (same idea
 * as POST /api/foods) next to the `ktp` file. Plain form fields are accepted too,
 * which keeps curl/PowerShell tests short.
 */
function parseApplicationBody(req) {
  const body = req.body || {};

  if (!isPresent(body.data)) return body;

  if (typeof body.data !== 'string') {
    throw httpError(400, '`data` must be a JSON string');
  }

  try {
    return JSON.parse(body.data);
  } catch {
    throw httpError(400, '`data` must be valid JSON');
  }
}

/**
 * Validates and normalises the three text fields. Every field must be a string:
 * a JSON number or object is a 400, never a crash further down.
 */
function validateApplication(source) {
  if (!isPlainObject(source)) {
    throw httpError(400, 'full_name, whatsapp and email are required');
  }

  for (const field of ['full_name', 'whatsapp', 'email']) {
    if (!isPresent(source[field])) {
      throw httpError(400, `${field} is required`);
    }

    if (typeof source[field] !== 'string') {
      throw httpError(400, `${field} must be a string`);
    }
  }

  const fullName = source.full_name.trim();
  if (fullName.length < 2 || fullName.length > 100) {
    throw httpError(400, 'full_name must be between 2 and 100 characters');
  }

  const email = source.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw httpError(400, 'email is invalid');
  }

  const whatsapp = normalizeWhatsapp(source.whatsapp);
  if (!whatsapp) {
    throw httpError(
      400,
      'whatsapp must be a valid phone number (8-15 digits, e.g. +6281234567890)'
    );
  }

  return { full_name: fullName, whatsapp, email };
}

/**
 * Counts per status for the admin header. Independent of the active filter, so
 * the badges stay put while the list is filtered.
 */
async function summarize() {
  const rows = await Volunteer.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const summary = { total: 0, pending: 0, approved: 0, rejected: 0 };

  for (const row of rows) {
    if (Volunteer.STATUSES.includes(row._id)) summary[row._id] = row.count;
    summary.total += row.count;
  }

  return summary;
}

// POST /api/volunteers  (multipart: `data` JSON + `ktp` image)
// authenticate runs before the upload, so nobody can write files without a token.
router.post('/', authenticate, uploadKtp.single('ktp'), async (req, res, next) => {
  const uploaded = req.file;
  let saved = false;

  try {
    if (req.user.role === 'admin') {
      throw httpError(403, 'Admins cannot apply as volunteers');
    }

    const fields = validateApplication(parseApplicationBody(req));

    if (!uploaded) {
      throw httpError(400, 'ktp file is required (multipart field name: ktp)');
    }

    const existing = await Volunteer.findOne({ user_id: req.user.user_id });
    let volunteer;
    let oldKtpFile = null;

    if (!existing) {
      volunteer = await Volunteer.create({
        ...fields,
        user_id: req.user.user_id,
        ktp_file: uploaded.filename,
      });
    } else if (existing.status === 'rejected') {
      // Applying again after a rejection: the same document goes back to
      // pending. The status condition keeps two quick taps from both winning.
      volunteer = await Volunteer.findOneAndUpdate(
        { _id: existing._id, status: 'rejected' },
        {
          $set: {
            ...fields,
            ktp_file: uploaded.filename,
            status: 'pending',
            review: { reviewed_by: null, reviewed_at: null, rejection_reason: null },
            submitted_at: new Date(),
          },
        },
        { returnDocument: 'after', runValidators: true }
      );

      if (!volunteer) {
        throw httpError(409, 'Your application changed, please reload and try again');
      }

      oldKtpFile = existing.ktp_file;
    } else {
      throw httpError(409, `You already have an application (${existing.status})`);
    }

    saved = true;

    // The previous photo is only removed after the new state is stored, so a
    // failed save never leaves the application without its KTP.
    if (oldKtpFile && oldKtpFile !== uploaded.filename) {
      await removeKtpFile(oldKtpFile).catch((err) => {
        console.error('Failed to remove old KTP file:', err.message);
      });
    }

    res.status(201).json({ data: volunteer.toPublic() });
  } catch (err) {
    // Never leave an orphaned identity document behind when the request fails.
    if (uploaded && !saved) {
      await removeKtpFile(uploaded.filename).catch(() => {});
    }

    // Two first-time submits at once: the unique user_id index lets one through.
    if (err.code === 11000) {
      return next(httpError(409, 'You already have an application'));
    }

    next(err);
  }
});

// GET /api/volunteers/me  (the signed-in user's own application, or null)
router.get('/me', authenticate, async (req, res) => {
  const volunteer = await Volunteer.findOne({ user_id: req.user.user_id });

  res.json({ data: volunteer ? volunteer.toPublic() : null });
});

// GET /api/volunteers  (admin: review queue; ?status=pending by default, or "all")
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const rawStatus = req.query.status;
  const statusFilter =
    rawStatus === 'all'
      ? null
      : parseEnumParam(rawStatus, Volunteer.STATUSES, 'status') || 'pending';

  const filter = statusFilter ? { status: statusFilter } : {};

  const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = parseBoundedInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);

  const [rows, total, summary] = await Promise.all([
    Volunteer.find(filter)
      .sort({ submitted_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Volunteer.countDocuments(filter),
    summarize(),
  ]);

  res.json({
    summary,
    count: rows.length,
    total,
    page,
    limit,
    hasMore: page * limit < total,
    data: rows.map((row) => row.toPublic()),
  });
});

// GET /api/volunteers/:id/ktp  (admin or the applicant; everybody else gets 404)
router.get('/:id/ktp', authenticate, async (req, res, next) => {
  const volunteer = await Volunteer.findOne({ volunteer_id: String(req.params.id) });

  const allowed =
    volunteer && (req.user.role === 'admin' || volunteer.user_id === req.user.user_id);

  // 404 (not 403) so the existence of someone else's application is not revealed.
  if (!allowed) {
    return next(httpError(404, 'Volunteer application not found'));
  }

  // The name comes from the database: serve it only when it has the exact shape
  // this server generates, so a bad value can never point outside the folder.
  if (!isKtpFilename(volunteer.ktp_file)) {
    return next(httpError(404, 'KTP file not found'));
  }

  res.set('Cache-Control', 'private, no-store');

  return res.sendFile(
    volunteer.ktp_file,
    {
      root: ktpDir,
      dotfiles: 'deny',
      cacheControl: false,
      headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' },
    },
    (err) => {
      if (!err || res.headersSent) return;

      const missing = err.code === 'ENOENT' || err.status === 404;
      next(missing ? httpError(404, 'KTP file not found') : err);
    }
  );
});

// PATCH /api/volunteers/:id/review  (admin: approve or reject a pending application)
router.patch('/:id/review', authenticate, requireRole('admin'), async (req, res, next) => {
  const { decision, reason } = req.body || {};

  if (!['approved', 'rejected'].includes(decision)) {
    return next(httpError(400, 'decision must be approved or rejected'));
  }

  if (decision === 'rejected') {
    if (typeof reason !== 'string' || !reason.trim()) {
      return next(httpError(400, 'reason is required when rejecting an application'));
    }

    if (reason.trim().length > MAX_REASON_LENGTH) {
      return next(httpError(400, `reason must be at most ${MAX_REASON_LENGTH} characters`));
    }
  }

  const volunteerId = String(req.params.id);

  // Only a pending application can be decided, and the condition is part of the
  // update itself, so two admins cannot both decide the same application.
  const updated = await Volunteer.findOneAndUpdate(
    { volunteer_id: volunteerId, status: 'pending' },
    {
      $set: {
        status: decision,
        review: {
          reviewed_by: req.user.user_id,
          reviewed_at: new Date(),
          rejection_reason: decision === 'rejected' ? reason.trim() : null,
        },
      },
    },
    { returnDocument: 'after', runValidators: true }
  );

  if (updated) {
    return res.json({ data: updated.toPublic() });
  }

  const current = await Volunteer.findOne({ volunteer_id: volunteerId });

  if (!current) {
    return next(httpError(404, 'Volunteer application not found'));
  }

  // Sending the same decision again is a no-op, so a retry after a lost
  // response stays harmless.
  if (current.status === decision) {
    return res.json({ data: current.toPublic() });
  }

  return next(httpError(409, `Application was already ${current.status}`));
});

module.exports = router;
module.exports.normalizeWhatsapp = normalizeWhatsapp;
module.exports.validateApplication = validateApplication;
