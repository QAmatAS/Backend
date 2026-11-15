const express = require('express');

const usersRouter = require('./users');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    message: 'API is running',
    endpoints: ['GET /api/health', 'GET /api/users', 'POST /api/users'],
  });
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.use('/users', usersRouter);

module.exports = router;
