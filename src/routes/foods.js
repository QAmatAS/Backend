const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');

const FoodItemListing = require('../models/FoodItemListing');

const router = express.Router();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function generateFoodId() {
  return `food_${crypto.randomBytes(4).toString('hex')}`;
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function parseDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, `${field} is not a valid date`);
  }
  return date;
}

/**
 * Validates the request body and normalizes it into the exact shape stored in
 * MongoDB. Optional parts (food_id, created_at, verification, status) get
 * sensible defaults so a minimal payload is enough.
 */
function buildListingPayload(body) {
  const {
    food_id,
    contributor_id,
    created_at,
    verification_status,
    verification_details,
    food_details,
    location,
    status,
  } = body || {};

  if (!isPresent(contributor_id)) {
    throw httpError(400, 'contributor_id is required');
  }

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

  const verification = verification_details || {};
  let verifiedAt = isPresent(verification.verified_at)
    ? parseDate(verification.verified_at, 'verification_details.verified_at')
    : null;

  if (verification_status === 'approved' && !verifiedAt) {
    verifiedAt = new Date();
  }

  if (
    verification_status === 'rejected' &&
    !isPresent(verification.rejection_reason)
  ) {
    throw httpError(400, 'verification_details.rejection_reason is required when rejected');
  }

  const mapUrl =
    pickupLocation.external_map_url ||
    `https://maps.google.com/?q=${coordinates.latitude},${coordinates.longitude}`;

  return {
    food_id: isPresent(food_id) ? String(food_id).trim() : generateFoodId(),
    contributor_id: String(contributor_id).trim(),
    created_at: isPresent(created_at) ? parseDate(created_at, 'created_at') : new Date(),
    updated_at: new Date(),

    verification_status: verification_status || 'pending',
    verification_details: {
      verified_by_admin_id: verification.verified_by_admin_id || null,
      verified_at: verifiedAt,
      rejection_reason: verification.rejection_reason || null,
    },

    food_details: {
      title: details.title,
      description: details.description || '',
      category: details.category,
      dietary_tags: details.dietary_tags || [],
      quantity_portions: details.quantity_portions,
      expiry_timestamp: parseDate(details.expiry_timestamp, 'food_details.expiry_timestamp'),
      photo_urls: details.photo_urls || [],
    },

    location: {
      location_name: pickupLocation.location_name,
      address_text: pickupLocation.address_text || '',
      coordinates: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      },
      pickup_notes: pickupLocation.pickup_notes || '',
      external_map_url: mapUrl,
    },

    status: status || 'available',
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

// GET /api/foods  (optional filters: status, verification_status, contributor_id)
router.get('/', async (req, res) => {
  const { status, verification_status, contributor_id } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (verification_status) filter.verification_status = verification_status;
  if (contributor_id) filter.contributor_id = contributor_id;

  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50;

  const requestedSkip = Number.parseInt(req.query.skip, 10);
  const skip = Number.isFinite(requestedSkip) ? Math.max(requestedSkip, 0) : 0;

  const listings = await FoodItemListing.find(filter)
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit);

  res.json({
    count: listings.length,
    data: listings.map((listing) => listing.toPublic()),
  });
});

// GET /api/foods/:id  (accepts food_id or Mongo ObjectId)
router.get('/:id', async (req, res, next) => {
  const listing = await findListing(req.params.id);

  if (!listing) {
    return next(httpError(404, 'Food listing not found'));
  }

  res.json({ data: listing.toPublic() });
});

// POST /api/foods  (create + persist in MongoDB)
router.post('/', async (req, res, next) => {
  try {
    const payload = buildListingPayload(req.body);

    if (await FoodItemListing.exists({ food_id: payload.food_id })) {
      throw httpError(409, 'food_id is already registered');
    }

    const listing = await FoodItemListing.create(payload);
    res.status(201).json({ data: listing.toPublic() });
  } catch (err) {
    // Race condition safety net for the unique food_id index.
    if (err.code === 11000) {
      return next(httpError(409, 'food_id is already registered'));
    }

    next(err);
  }
});

// PATCH /api/foods/:id  (update status, verification or listing content)
router.patch('/:id', async (req, res, next) => {
  const listing = await findListing(req.params.id);

  if (!listing) {
    return next(httpError(404, 'Food listing not found'));
  }

  const {
    status,
    verification_status,
    verification_details,
    food_details,
    location,
  } = req.body || {};

  if (status !== undefined) listing.status = status;
  if (verification_status !== undefined) listing.verification_status = verification_status;

  if (verification_details !== undefined) {
    const current = listing.verification_details
      ? listing.verification_details.toObject()
      : {};

    listing.verification_details = { ...current, ...verification_details };
  }

  if (food_details !== undefined) listing.food_details = food_details;
  if (location !== undefined) listing.location = location;

  listing.updated_at = new Date();
  await listing.save();

  res.json({ data: listing.toPublic() });
});

// DELETE /api/foods/:id
router.delete('/:id', async (req, res, next) => {
  const listing = await findListing(req.params.id);

  if (!listing) {
    return next(httpError(404, 'Food listing not found'));
  }

  await listing.deleteOne();
  res.status(204).send();
});

module.exports = router;
