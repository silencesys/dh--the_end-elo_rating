// Requires a matching x-api-key header on the request.
// Configure the expected value via UPLOAD_API_KEY in .env.
// If the variable is absent, all requests are rejected (fail-safe).
function requireApiKey(req, res, next) {
  const expectedKey = process.env.UPLOAD_API_KEY;
  if (!expectedKey) {
    return res.status(503).json({ error: 'Upload endpoint is not configured (UPLOAD_API_KEY not set).' });
  }
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== expectedKey) {
    return res.status(401).json({ error: 'Missing or invalid API key.' });
  }
  next();
}

module.exports = requireApiKey;
