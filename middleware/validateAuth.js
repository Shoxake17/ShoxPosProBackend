/**
 * Login va Register body uchun input validation + sanitization (XSS/Injection oldini olish).
 */
const { body, validationResult } = require('express-validator');

const loginValidation = [
  body('login')
    .trim()
    .notEmpty().withMessage("Login majburiy")
    .isLength({ max: 100 }).withMessage("Login juda uzun")
    .escape(),
  body('password')
    .notEmpty().withMessage("Parol majburiy")
    .isLength({ min: 1, max: 500 }).withMessage("Parol formati noto'g'ri"),
];

const registerValidation = [
  body('login')
    .trim()
    .notEmpty().withMessage("Login majburiy")
    .isLength({ max: 100 }).withMessage("Login juda uzun")
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage("Login faqat harf, raqam, _, ., - dan iborat bo'lishi kerak")
    .escape(),
  body('password')
    .notEmpty().withMessage("Parol majburiy")
    .isLength({ min: 6, max: 500 }).withMessage("Parol kamida 6 belgidan iborat bo'lishi kerak"),
  body('role').optional().isIn(['seller', 'admin', 'cashier']).withMessage("Noto'g'ri role"),
];

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msg = errors.array().map(e => e.msg).join('; ');
    return res.status(400).json({ success: false, message: msg });
  }
  next();
}

module.exports = {
  loginValidation,
  registerValidation,
  handleValidationErrors,
};
