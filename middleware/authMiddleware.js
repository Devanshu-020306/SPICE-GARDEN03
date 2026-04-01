'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * protect — verifies Bearer JWT, attaches req.user (no password), calls next()
 * On failure: 401 "Not authorized, token failed."
 */
async function protect(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authorized, token failed.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ error: 'Not authorized, token failed.' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Not authorized, token failed.' });
  }
}

/**
 * authorize(...roles) — returns middleware that checks req.user.role
 * On failure: 403
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role.' });
    }
    next();
  };
}

module.exports = { protect, authorize };
