'use strict';

const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, 'output');

/**
 * Generate a QR code as a base64 data URL for a given URL string.
 * @param {string} url
 * @returns {Promise<string>} base64 data URL
 */
async function generateQRDataURL(url) {
  return QRCode.toDataURL(url);
}

/**
 * Generate a QR code PNG file for a given table number and URL.
 * Writes to qr-generator/output/table-<tableNumber>.png
 * @param {number} tableNumber
 * @param {string} url
 * @returns {Promise<string>} filename
 */
async function generateQRFile(tableNumber, url) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const filename = `table-${tableNumber}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);
  await QRCode.toFile(filepath, url);
  return filename;
}

module.exports = { generateQRDataURL, generateQRFile };
