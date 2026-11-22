const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');

const FoodItemListing = require('../models/FoodItemListing');
const User = require('../models/User');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  httpError,
  escapeRegex,
  parseEnumParam,
  parseBoundedInt,
} = require('../utils/validation');
const {
  uploadFoodPhotos,
  renameUploadedPhotos,
  sanitizeFoodId,
  uploadDir,
  UPLOAD_URL_PREFIX,
} = require('../middleware/upload');

const router = express.Router();

// How a listing may move between availability marks. `picked_up` and
// `cancelled` are terminal; anything else is rejected with 400.
const STATUS_TRANSITIONS = {
  available: ['reserved', 'cancelled', 'expired'],
  reserved: ['available', 'picked_up', 'cancelled'],
  picked_up: [],
  cancelled: [],
  expired: ['available'],
};

function generateFoodId() {
  return `food_${crypto.randomBytes(4).toString('hex')}`;
}

const EARTH_RADIUS_KM = 6378.1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_RADIUS_KM = 5;
const MAX_RADIUS_KM = 100;
// Notification poll: only food the user can still reach in time, and only a
// short preview list (the notification shows a count, not a full feed).
const EXPIRY_GRACE_MINUTES = 45;
const NEW_PREVIEW_LIMIT = 20;

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Parses the optional ?lat&lng&radiusKm triple. Returns null when absent.
 */
function parseGeoQuery(lat, lng, radiusKm) {
  const hasLat = isPresent(lat);
  const hasLng = isPresent(lng);

  if (!hasLat && !hasLng) return null;

  if (hasLat !== hasLng) {
    throw httpError(400, 'lat and lng must be provided together');
  }

  const latitude = Number(lat);
  const longitude = Number(lng);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw httpError(400, 'lat must be a number between -90 and 90');
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw httpError(400, 'lng must be a number between -180 and 180');
  }

  const radius = isPresent(radiusKm) ? Number(radiusKm) : DEFAULT_RADIUS_KM;

  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_RADIUS_KM) {
    throw httpError(400, `radiusKm must be a number between 0 and ${MAX_RADIUS_KM}`);
  }

  return { latitude, longitude, radiusKm: radius };
}

function parseDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, `${field} is not a valid date`);
  }
  return date;
}

/**
 * JSON requests use the body as-is. Multipart requests (used to upload photos)
 * carry the listing JSON in a `data` field next to the `photos` files.
 */
function parseListingBody(req) {
  if (!req.is('multipart/form-data')) {
    return req.body;
  }

  if (!req.body || !isPresent(req.body.data)) {
    throw httpError(
      400,
      'multipart requests must include a `data` field containing the listing JSON'
    );
  }

  try {
    return JSON.parse(req.body.data);
  } catch {
    throw httpError(400, '`data` must be valid JSON');
  }
}

async function removeUploadedFiles(files) {
  if (!files || files.length === 0) return;

  await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {})));
}

/**
 * Removes the image files this listing created. Only files named
 * Image_<food_id>… are touched, so a listing cannot delete another listing's
 * photo by referencing its URL in photo_urls.
 */
async function removeListingPhotos(listing) {
  const base = `Image_${sanitizeFoodId(listing.food_id)}`;
  const photoUrls = listing.food_details?.photo_urls || [];

  for (const url of photoUrls) {
    if (typeof url !== 'string' || !url.startsWith(`${UPLOAD_URL_PREFIX}/`)) continue;

    // basename() strips any directory component, so a crafted URL cannot
    // escape the uploads folder.
    const name = path.basename(url);
    if (!name.startsWith(base)) continue;

    await fs.unlink(path.join(uploadDir, name)).catch((err) => {
      if (err.code !== 'ENOENT') {
        console.error(`Failed to remove uploaded photo ${name}:`, err.message);
      }
    });
  }
}

/**
 * Validates the request body and normalizes it into the exact shape stored in
 * MongoDB. Ownership and verification are decided by the server:
 * contributor_id comes from the token, and every new listing starts pending.
 */
function buildListingPayload(body, contributorId) {
  const { food_id, created_at, food_details, location } = body || {};

  const details = food_details || {};
  for (const field of ['title', 'category', 'quantity_portions', 'expiry_timestamp']) {
    if (!isPresent(details[field])) {
      throw httpError(400, `food_details.${field} is required`);
    }
  }

  const pickupLocation = location || {};
  if (!isPresent(pickupLocation.location_name)) {
    throw httpError(400, 'location.location_name is required');
  }

  const coordinates = pickupLocation.coordinates || {};
  if (typeof coordinates.latitude !== 'number' || typeof coordinates.longitude !== 'number') {
    throw httpError(400, 'location.coordinates.latitude and longitude are required numbers');
  }

  // Backdating is allowed, but a future date would keep the listing at the top
  // of the feed (and permanently "new" for the notification cursor).
  const createdAt = isPresent(created_at) ? parseDate(created_at, 'created_at') : new Date();

  return {
    food_id: isPresent(food_id) ? String(food_id).trim() : generateFoodId(),
    contributor_id: contributorId,
    created_at: createdAt > new Date() ? new Date() : createdAt,
    updated_at: new Date(),

    // Only the admin verification route may change these.
    verification_status: 'pending',
    verification_details: {
      verified_by_admin_id: null,
      verified_at: null,
      rejection_reason: null,
    },

    food_details: {
      title: details.title,
      description: details.description || '',
      category: details.category,
      dietary_tags: Array.isArray(details.dietary_tags) ? details.dietary_tags : [],
      quantity_portions: details.quantity_portions,
      quantity_unit: isPresent(details.quantity_unit)
        ? String(details.quantity_unit).trim()
        : 'porsi',
      expiry_timestamp: parseDate(details.expiry_timestamp, 'food_details.expiry_timestamp'),
      photo_urls: Array.isArray(details.photo_urls) ? details.photo_urls : [],
    },

    location: {
      location_name: pickupLocation.location_name,
      address_text: pickupLocation.address_text || '',
      coordinates: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      },
      pickup_notes: pickupLocation.pickup_notes || '',
      external_map_url:
        pickupLocation.external_map_url ||
        `https://maps.google.com/?q=${coordinates.latitude},${coordinates.longitude}`,
    },

    status: 'available',
  };
}

/**
 * Finds a listing by its business id (`food_...`) or by the Mongo ObjectId.
 */
async function findListing(identifier) {
  const byFoodId = await FoodItemListing.findOne({ food_id: identifier });
  if (byFoodId) return byFoodId;

  if (mongoose.isValidObjectId(identifier)) {
    return FoodItemListing.findById(identifier);
  }

  return null;
}

/**
 * Listings are public to read, so returning 403 here reveals nothing that
 * GET /api/foods/:id does not already show.
 */
function assertOwner(req, listing) {
  if (listing.contributor_id !== req.user.user_id) {
    throw httpError(403, 'You can only change your own listings');
  }
}

// GET /api/foods
// Explore feed: text search, category filter, availability/verification
// filters, geo radius and paging. Rejected and cancelled listings are hidden
// unless explicitly requested by name.
router.get('/', async (req, res) => {
  const { status, verification_status, contributor_id, category, q, lat, lng, radiusKm } =
    req.query;

  const filter = {};

  filter.status =
    parseEnumParam(status, FoodItemListing.STATUSES, 'status') || { $ne: 'cancelled' };

  filter.verification_status =
    parseEnumParam(
      verification_status,
      FoodItemListing.VERIFICATION_STATUSES,
      'verification_status'
    ) || { $ne: 'rejected' };

  if (isPresent(contributor_id)) {
    filter.contributor_id = String(contributor_id).trim();
  }

  if (isPresent(category)) {
    filter['food_details.category'] = new RegExp(`^${escapeRegex(category)}$`, 'i');
  }

  const needle = isPresent(q) ? String(q).trim() : '';
  if (needle) {
    const pattern = new RegExp(escapeRegex(needle), 'i');
    filter.$or = [
      { 'food_details.title': pattern },
      { 'food_details.description': pattern },
    ];
  }

  const geo = parseGeoQuery(lat, lng, radiusKm);

  const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = parseBoundedInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);

  const pageFilter = { ...filter };
  const countFilter = { ...filter };

  if (geo) {
    const point = { type: 'Point', coordinates: [geo.longitude, geo.latitude] };

    pageFilter['location.geo'] = {
      $near: { $geometry: point, $maxDistance: geo.radiusKm * 1000 },
    };

    // $near cannot be used with countDocuments() or with an explicit sort(), so
    // the total comes from the same circle expressed with a countable operator.
    countFilter['location.geo'] = {
      $geoWithin: {
        $centerSphere: [
          [geo.longitude, geo.latitude],
          geo.radiusKm / EARTH_RADIUS_KM,
        ],
      },
    };
  }

  const findQuery = FoodItemListing.find(pageFilter)
    .skip((page - 1) * limit)
    .limit(limit);

  // $near already returns nearest-first; an explicit sort would override it.
  if (!geo) findQuery.sort({ created_at: -1 });

  const [listings, total] = await Promise.all([
    findQuery,
    FoodItemListing.countDocuments(countFilter),
  ]);

  res.json({
    count: listings.length,
    total,
    page,
    limit,
    hasMore: page * limit < total,
    data: listings.map((listing) => listing.toPublic()),
  });
});

/**
 * Listing payload plus the contributor's public contact block. Resolved at read
 * time (not denormalised into the listing) so a changed phone number takes
 * effect immediately. Null when the owner account no longer exists, so the app
 * can hide the contact buttons instead of showing an empty number.
 */
async function withContributor(listing) {
  const owner = await User.findOne({ user_id: listing.contributor_id });

  return {
    ...listing.toPublic(),
    contributor: owner ? owner.toContributor() : null,
  };
}

// GET /api/foods/new  (notification poll: anything nearby since <since>?)
// Registered before /:id so "new" is not captured as a listing id.
router.get('/new', authenticate, async (req, res) => {
  // Read the clock before querying: an item created while this request runs
  // must still be newer than the returned server_time, otherwise the next poll
  // (which uses that value as its cursor) would skip it forever.
  const now = new Date();

  const geo = parseGeoQuery(req.query.lat, req.query.lng, req.query.radiusKm);

  if (!geo) {
    throw httpError(400, 'lat and lng are required');
  }

  // No cursor means "I just started": answer with nothing so a fresh install
  // does not notify about food that was already on the map.
  const cursor = isPresent(req.query.since)
    ? parseDate(req.query.since, 'since')
    : now;

  const filter = {
    // Never notify someone about their own listing.
    contributor_id: { $ne: req.user.user_id },
    status: 'available',
    verification_status: { $ne: 'rejected' },
    created_at: { $gt: cursor },
    // Skip food that will expire before the user could realistically arrive.
    'food_details.expiry_timestamp': {
      $gt: new Date(now.getTime() + EXPIRY_GRACE_MINUTES * 60 * 1000),
    },
    'location.geo': {
      $geoWithin: {
        $centerSphere: [
          [geo.longitude, geo.latitude],
          geo.radiusKm / EARTH_RADIUS_KM,
        ],
      },
    },
  };

  const [listings, count] = await Promise.all([
    FoodItemListing.find(filter)
      .sort({ created_at: -1 })
      .limit(NEW_PREVIEW_LIMIT)
      .select(
        'food_id created_at food_details.title food_details.quantity_portions food_details.quantity_unit'
      ),
    FoodItemListing.countDocuments(filter),
  ]);

  res.json({
    server_time: now.toISOString(),
    count,
    items: listings.map((listing) => ({
      food_id: listing.food_id,
      title: listing.food_details?.title,
      quantity_portions: listing.food_details?.quantity_portions,
      quantity_unit: listing.food_details?.quantity_unit || 'porsi',
      created_at: listing.created_at ? listing.created_at.toISOString() : null,
    })),
  });
});

// GET /api/foods/:id  (accepts food_id or Mongo ObjectId)
router.get('/:id', async (req, res, next) => {
  const listing = await findListing(req.params.id);

  if (!listing) {
    return next(httpError(404, 'Food listing not found'));
  }

  res.json({ data: await withContributor(listing) });
});

// POST /api/foods  (JSON, or multipart with `data` JSON + `photos` files)
router.post('/', authenticate, uploadFoodPhotos.array('photos', 5), async (req, res, next) => {
  try {
    const payload = buildListingPayload(parseListingBody(req), req.user.user_id);

    if (await FoodItemListing.exists({ food_id: payload.food_id })) {
      throw httpError(409, 'food_id is already registered');
    }

    // Files were stored with temporary names; rename them to Image_<food_id>.
    await renameUploadedPhotos(req.files, payload.food_id);

    const uploadedPhotoUrls = (req.files || []).map(
      (file) => `${UPLOAD_URL_PREFIX}/${file.filename}`
    );

    payload.food_details.photo_urls = [
      ...payload.food_details.photo_urls,
      ...uploadedPhotoUrls,
    ];

    const listing = await FoodItemListing.create(payload);
    res.status(201).json({ data: listing.toPublic() });
  } catch (err) {
    // Never leave orphaned image files behind when creation fails.
    await removeUploadedFiles(req.files);

    // Race condition safety net for the unique food_id index.
    if (err.code === 11000) {
      return next(httpError(409, 'food_id is already registered'));
    }

    next(err);
  }
});

// PATCH /api/foods/:id/status  (owner only: availability mark)
router.patch('/:id/status', authenticate, async (req, res, next) => {
  const listing = await findListing(req.params.id);

  if (!listing) {
    return next(httpError(404, 'Food listing not found'));
  }

  assertOwner(req, listing);

  const { status } = req.body || {};

  if (!isPresent(status)) {
    return next(httpError(400, 'status is required'));
  }

  // Sending the current status again is a no-op, so retries stay harmless.
  if (status === listing.status) {
    return res.json({ data: listing.toPublic() });
  }

  const allowed = STATUS_TRANSITIONS[listing.status] || [];
  if (!allowed.includes(status)) {
    return next(
      httpError(400, `status cannot change from ${listing.status} to ${status}`)
    );
  }

  listing.status = status;
  listing.updated_at = new Date();
  await listing.save();

  res.json({ data: listing.toPublic() });
});

// PATCH /api/foods/:id/verify  (admin only: approval workflow)
router.patch('/:id/verify', authenticate, requireRole('admin'), async (req, res, next) => {
  const listing = await findListing(req.params.id);

  if (!listing) {
    return next(httpError(404, 'Food listing not found'));
  }

  const { decision, reason } = req.body || {};

  if (!['approved', 'rejected'].includes(decision)) {
    return next(httpError(400, 'decision must be approved or rejected'));
  }

  if (decision === 'rejected' && !isPresent(reason)) {
    return next(httpError(400, 'reason is required when rejecting a listing'));
  }

  listing.verification_status = decision;
  listing.verification_details = {
    verified_by_admin_id: req.user.user_id,
    verified_at: new Date(),
    rejection_reason: decision === 'rejected' ? String(reason).trim() : null,
  };
  listing.updated_at = new Date();
  await listing.save();

  res.json({ data: await withContributor(listing) });
});

// PATCH /api/foods/:id  (owner only: listing content)
// food_details and location are replaced wholesale, so the client must send
// the complete object. status/verification have their own endpoints and are
// ignored here.
router.patch('/:id', authenticate, async (req, res, next) => {
  const listing = await findListing(req.params.id);

  if (!listing) {
    return next(httpError(404, 'Food listing not found'));
  }

  assertOwner(req, listing);

  const { food_details, location } = req.body || {};

  if (food_details !== undefined) listing.food_details = food_details;
  if (location !== undefined) listing.location = location;

  listing.updated_at = new Date();
  await listing.save();

  res.json({ data: listing.toPublic() });
});

// DELETE /api/foods/:id  (owner only)
router.delete('/:id', authenticate, async (req, res, next) => {
  const listing = await findListing(req.params.id);

  if (!listing) {
    return next(httpError(404, 'Food listing not found'));
  }

  assertOwner(req, listing);

  // Delete the document first: if unlinking fails we keep orphaned files
  // rather than a listing that points at images that no longer exist.
  await listing.deleteOne();
  await removeListingPhotos(listing);

  res.status(204).send();
});

module.exports = router;
