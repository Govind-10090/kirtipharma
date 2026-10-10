// ===== KIRTI PHARMA BACKEND — upload.js =====
// Multer file upload configuration for prescriptions and medicine catalog images
// Uses disk storage locally, memory storage on Vercel (read-only filesystem)

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

let storage;

if (IS_SERVERLESS) {
  // Vercel has a read-only filesystem — use in-memory storage instead
  storage = multer.memoryStorage();
  console.log('[UPLOAD] Using memoryStorage (serverless environment)');
} else {
  const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
  const PRESCRIPTIONS_DIR = path.join(UPLOADS_DIR, 'prescriptions');
  const MEDICINES_DIR = path.join(UPLOADS_DIR, 'medicines');

  [PRESCRIPTIONS_DIR, MEDICINES_DIR].forEach(dir => {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.warn('[UPLOAD] Could not create upload dir:', dir, e.message);
    }
  });

  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === 'medicineImage' || req.originalUrl.includes('medicines')) {
        cb(null, MEDICINES_DIR);
      } else {
        cb(null, PRESCRIPTIONS_DIR);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      cb(null, `${cleanName}-${unique}${ext}`);
    }
  });
}

const fileFilter = (req, file, cb) => {
  const allowedMime = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ];
  if (allowedMime.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file format. Please upload JPG, PNG, WEBP or PDF.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB limit
  }
});

module.exports = upload;

