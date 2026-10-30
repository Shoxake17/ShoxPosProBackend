/**
 * Do'kon hisobini ochish (register) body uchun input validation + sanitization
 * (XSS/Injection oldini olish).
 *
 * Login/parol validatsiyasi olib tashlangan: kirish OnDex orqali (yagona kirish).
 */
const { body, validationResult } = require('express-validator');

const registerValidation = [
  // Hamkorning OnDex telefon raqami: +998 90 123 45 67, 998901234567 va h.k.
  // Aniq format (998 + 9 raqam) controller'da tekshiriladi.
  body('ondexPhone')
    .trim()
    .notEmpty().withMessage("OnDex telefon raqami majburiy")
    .isLength({ max: 30 }).withMessage("Telefon raqami juda uzun")
    .matches(/^[+\d\s()-]+$/).withMessage("Telefon raqamida faqat raqam, +, bo'sh joy va - bo'lishi mumkin"),
  body('role').optional().isIn(['admin', 'cashier']).withMessage("Noto'g'ri role"),
];

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msg = errors.array().map(e => e.msg).join('; ');
    if (process.env.NODE_ENV !== 'production') {
      console.warn("⚠️ [Express Validator Error]:", msg);
      console.warn("   Body fields present:", Object.keys(req.body || {}));
    }
    return res.status(400).json({ success: false, message: msg });
  }
  next();
}

module.exports = {
  registerValidation,
  handleValidationErrors,
};
