// authMiddleware.js
function verifyGlideAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  console.log('🔐 Auth Header:', authHeader);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ Missing or malformed Authorization header');
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  console.log('🔍 Supplied token:', token);
  console.log('🧾 Expected token:', process.env.GLIDE_TERMINAL_WEBHOOK_TOKEN);

  if (token !== process.env.GLIDE_TERMINAL_WEBHOOK_TOKEN) {
    console.log('❌ Unauthorized: token mismatch');
    return res.status(403).json({ error: 'Unauthorized request' });
  }

  console.log('✅ Authenticated successfully');
  next();
}
