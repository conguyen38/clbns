const { getPool } = require('./db');

// Serves the checkin photo as a real image response (not JSON) so the browser
// can decode it natively and cache it by URL — opening the same photo twice
// costs one network round trip instead of two, and repeat views are instant.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const checkinId = req.query && req.query.checkin_id;
  if (!checkinId) { res.status(400).send('Missing checkin_id'); return; }

  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT photo_url FROM checkins WHERE checkin_id=$1', [checkinId]);
    const photoUrl = rows[0] && rows[0].photo_url;
    const match = photoUrl && /^data:(image\/\w+);base64,(.*)$/.exec(photoUrl);
    if (!match) { res.status(404).send('No photo'); return; }

    res.setHeader('Content-Type', match[1]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(Buffer.from(match[2], 'base64'));
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
};
