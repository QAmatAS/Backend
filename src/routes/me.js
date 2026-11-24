const express = require('express');
const fsp = require('fs/promises');

const FoodItemListing = require('../models/FoodItemListing');
const { authenticate } = require('../middleware/auth');
const {
  uploadAvatar,
  removeUserAvatars,
  removeAvatarFile,
  AVATAR_URL_PREFIX,
} = require('../middleware/upload');
const { parseEnumParam, parseBoundedInt, httpError } = require('../utils/validation');

const ExpiredListing = FoodItemListing.Expired;

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VERIFICATION_KEYS = ['pending', 'approved', 'rejected'];
// Fields a user may change on their own profile. Everything else (email, role,
// user_id, password) is deliberately not writable here.
const PROFILE_FIELDS = ['display_name', 'avatar_url', 'bio', 'phone'];

/**
 * Counts a contributor's listings by verification status, across the active
 * collection and the Expired archive. Derived on read so the numbers can never
 * drift from the listings themselves (a stored counter would be wrong the moment
 * anything wrote to the collection directly).
 */
async function countByVerification(model, userId) {
  return model.aggregate([
    { $match: { contributor_id: userId } },
    { $group: { _id: '$verification_status', count: { $sum: 1 } } },
  ]);
}

async function summarizeListings(userId) {
  const [activeRows, archivedRows] = await Promise.all([
    countByVerification(FoodItemListing, userId),
    countByVerification(ExpiredListing, userId),
  ]);

  const summary = { total: 0, pending: 0, approved: 0, rejected: 0, expired: 0 };

  for (const row of activeRows) {
    if (VERIFICATION_KEYS.includes(row._id)) summary[row._id] = row.count;
    summary.total += row.count;
  }

  for (const row of archivedRows) {
    if (VERIFICATION_KEYS.includes(row._id)) summary[row._id] += row.count;
    summary.total += row.count;
    summary.expired += row.count;
  }

  return summary;
}

/**
 * The shape returned by both GET and PATCH /api/me, so a profile edit answers
 * with exactly the same object the app already renders.
 */
async function buildProfile(user) {
  const summary = await summarizeListings(user.user_id);

  return {
    ...user.toPublic(),
    stats: {
      // Lifetime totals: listings that expired and moved to the archive still
      // count as shared, otherwise the number would drop over time.
      total_shared_submitted: summary.total,
      total_shared_approved: summary.approved,
      // No ratings/reviews in v1; the field stays so the contract is stable.
      rating: 0,
    },
  };
}

// GET /api/me
router.get('/', authenticate, async (req, res) => {
  res.json({ data: await buildProfile(req.user) });
});

// PATCH /api/me  (update the signed-in user's own profile)
// Partial update: only the fields present in the body are touched, and
// `personal_info` is merged so editing the bio cannot wipe the phone number.
router.patch('/', authenticate, async (req, res, next) => {
  const { name, personal_info: personalInfo } = req.body || {};
  const user = req.user;
  const previousAvatarUrl = (user.personal_info && user.personal_info.avatar_url) || '';
  let changed = false;

  if (name !== undefined) {
    const nextName = String(name).trim();

    if (!nextName) {
      return next(httpError(400, 'name cannot be empty'));
    }

    user.name = nextName;
    changed = true;
  }

  if (personalInfo !== undefined) {
    if (typeof personalInfo !== 'object' || personalInfo === null || Array.isArray(personalInfo)) {
      return next(httpError(400, 'personal_info must be an object'));
    }

    user.personal_info = user.personal_info || {};

    for (const field of PROFILE_FIELDS) {
      if (personalInfo[field] === undefined) continue;

      // null clears the field; anything else is stored as trimmed text.
      user.personal_info[field] =
        personalInfo[field] === null ? '' : String(personalInfo[field]).trim();
      changed = true;
    }
  }

  if (!changed) {
    return next(
      httpError(
        400,
        `no updatable fields provided (name, ${PROFILE_FIELDS.map((f) => `personal_info.${f}`).join(', ')})`
      )
    );
  }

  // Runs schema validation too (lengths), surfaced as 400 by the error handler.
  await user.save();

  // If the avatar was replaced by another URL, the old uploaded file is unused.
  if (previousAvatarUrl && previousAvatarUrl !== user.personal_info.avatar_url) {
    await removeAvatarFile(previousAvatarUrl, user.user_id).catch(() => {});
  }

  res.json({ data: await buildProfile(user) });
});

// POST /api/me/avatar  (multipart, field `avatar`, one image up to 5 MB)
router.post('/avatar', authenticate, uploadAvatar.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw httpError(400, 'avatar file is required (multipart field name: avatar)');
    }

    const user = req.user;
    user.personal_info = user.personal_info || {};
    user.personal_info.avatar_url = `${AVATAR_URL_PREFIX}/${req.file.filename}`;
    await user.save();

    // Removing the older uploads after a successful save means a failed save
    // never leaves the account without its previous photo.
    await removeUserAvatars(user.user_id, req.file.filename).catch((err) => {
      console.error('Failed to remove old avatar files:', err.message);
    });

    res.status(201).json({ data: await buildProfile(user) });
  } catch (err) {
    // Never leave an orphaned file behind when the update fails.
    if (req.file) {
      await fsp.rm(req.file.path, { force: true }).catch(() => {});
    }
    next(err);
  }
});

// DELETE /api/me/avatar  (remove the profile photo)
router.delete('/avatar', authenticate, async (req, res) => {
  const user = req.user;
  const previousUrl = (user.personal_info && user.personal_info.avatar_url) || '';

  user.personal_info = user.personal_info || {};
  user.personal_info.avatar_url = '';
  await user.save();

  await removeAvatarFile(previousUrl, user.user_id).catch(() => {});

  res.json({ data: await buildProfile(user) });
});

// GET /api/me/listings  (Donations tab: the signed-in user's own listings)
// Unlike the Explore feed, nothing is hidden here: the owner sees pending,
// rejected and expired listings, plus the rejection reason on rejected ones.
router.get('/listings', authenticate, async (req, res) => {
  // The owner's view shows every status, but it should still reflect reality.
  await FoodItemListing.expireStale();

  const { verification_status, status } = req.query;

  const filter = { contributor_id: req.user.user_id };

  const verificationFilter = parseEnumParam(
    verification_status,
    FoodItemListing.VERIFICATION_STATUSES,
    'verification_status'
  );
  if (verificationFilter) filter.verification_status = verificationFilter;

  const statusFilter = parseEnumParam(status, FoodItemListing.STATUSES, 'status');
  if (statusFilter) filter.status = statusFilter;

  const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = parseBoundedInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);

  // Both collections hold listings for this user, so they are merged by date:
  // take the newest (page * limit) from each, merge, then slice the page.
  const take = page * limit;

  const [active, archived, activeTotal, archivedTotal, summary] = await Promise.all([
    FoodItemListing.find(filter).sort({ created_at: -1 }).limit(take),
    ExpiredListing.find(filter).sort({ created_at: -1 }).limit(take),
    FoodItemListing.countDocuments(filter),
    ExpiredListing.countDocuments(filter),
    summarizeListings(req.user.user_id),
  ]);

  const merged = [...active, ...archived].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const data = merged.slice((page - 1) * limit, page * limit);
  const total = activeTotal + archivedTotal;

  res.json({
    // Counts over all of the user's listings, independent of the active filter,
    // so the header badges stay stable while the list is filtered.
    summary,
    count: data.length,
    total,
    page,
    limit,
    hasMore: page * limit < total,
    data: data.map((listing) => listing.toPublic()),
  });
});

module.exports = router;
