const express = require('express');

const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/me
router.get('/', authenticate, async (req, res) => {
  res.json({ data: req.user.toPublic() });
});

// GET /api/me/listings is added in Phase 6, once listings reference user_id.
module.exports = router;
