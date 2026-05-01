const { Router } = require('express');
const { requireUser } = require('../middleware/auth');

const router = Router();

router.get('/', requireUser, (req, res) => {
  res.json({
    userId: req.user.sub,
    userEmail: req.user.email,
    userName: req.user.name,
    userPicture: req.user.picture,
  });
});

module.exports = router;
