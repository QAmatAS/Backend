const express = require('express');

const FoodItemListing = require('../models/FoodItemListing');
const { authenticate } = require('../middleware/auth');
const { parseEnumParam, parseBoundedInt } = require('../utils/validation');

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Counts a contributor's listings by verification status. Derived on read so
 * the numbers can never drift from the listings themselves (a stored counter
 * would be wrong the moment anything wrote to the collection directly).
 */
async function summarizeListings(userId) {
  const rows = await FoodItemListing.aggregate([
    { $match: { contributor_id: userId } },
    { $group: { _id: '$verification_status', count: { $sum: 1 } } },
  ]);

  const summary = { total: 0, pending: 0, approved: 0, rejected: 0 };

  for (const row of rows) {
    if (row._id === 'pending' || row._id === 'approved' || row._id === 'rejected') {
      summary[row._id] = row.count;
    }
    summary.total += row.count;
  }

  return summary;
}

// GET /api/me
router.get('/', authenticate, async (req, res) => {
  const summary = await summarizeListings(req.user.user_id);

  res.json({
    data: {
      ...req.user.toPublic(),
      stats: {
        total_shared_submitted: summary.total,
        total_shared_approved: summary.approved,
        // No ratings/reviews in v1; the field stays so the contract is stable.
        rating: 0,
      },
    },
  });
});

// GET /api/me/listings  (Donations tab: the signed-in user's own listings)
// Unlike the Explore feed, nothing is hidden here: the owner needs to see their
// rejected listings and the rejection reason.
router.get('/listings', authenticate, async (req, res) => {
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

  const [listings, total, summary] = await Promise.all([
    FoodItemListing.find(filter)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    FoodItemListing.countDocuments(filter),
    summarizeListings(req.user.user_id),
  ]);

  res.json({
    // Counts over all of the user's listings, independent of the active filter,
    // so the header badges stay stable while the list is filtered.
    summary,
    count: listings.length,
    total,
    page,
    limit,
    hasMore: page * limit < total,
    data: listings.map((listing) => listing.toPublic()),
  });
});

module.exports = router;
