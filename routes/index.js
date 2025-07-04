const express = require('express');
const router = express.Router();

router.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

router.get('/', (req, res) => {
  res.sendFile(require('path').join(__dirname, '..', 'public', 'index.html'));
});

module.exports = router;
