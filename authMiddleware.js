// authMiddleware.js
// authMiddleware.js
function verifyGlideAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (token !== process.env.GLIDE_TERMINAL_WEBHOOK_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized request' });
  }

  next();
}

module.exports = { verifyGlideAuth };
