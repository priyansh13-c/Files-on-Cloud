const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    // Reject tokens that were issued before the most recent logout.
    // decoded.tv is absent on tokens issued before this fix; treat them
    // as revoked to force a clean re-login after the upgrade.
    if (decoded.tv === undefined || decoded.tv !== user.tokenVersion) {
      return res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

module.exports = auth;