const express = require('express');
const router = express.Router();
const USBAdapter = require('@node-escpos/usb-adapter');

module.exports = (io) => {

  router.get('/check-printer', (req, res) => {
    // ✅ FIX: responded flag — ikki marta res.json() chaqirilishini oldini oladi
    let responded = false;

    const safeRespond = (data) => {
      if (responded) return; // ← ikkinchi chaqiruvni bloklaydi
      responded = true;
      res.json(data);
    };

    let device;
    try {
      device = new USBAdapter();
    } catch (initErr) {
      // USBAdapter yaratishda xato (masalan, libusb mavjud emas)
      console.warn('⚠️ USBAdapter yaratib bo\'lmadi:', initErr.message);
      return res.json({
        connected: false,
        message: 'USB adapter ishga tushmadi',
        error: initErr.message
      });
    }

    device.open((err) => {
      if (err) {
        console.log('Printer topilmadi:', err.message);
        return safeRespond({
          connected: false,
          message: 'Printer ulanmagan',
          error: err.message
        });
      }

      // Printer modeli aniqlash
      let printerModel = 'USB Thermal Printer';
      try {
        const deviceInfo = device.device;
        if (deviceInfo && deviceInfo.deviceDescriptor) {
          const { idVendor } = deviceInfo.deviceDescriptor;
          const vendors = {
            '0x0483': 'XP-58IIL',
            '0x0416': 'SPRT',
            '0x0411': 'STMicroelectronics',
            '0x04b8': 'Epson',
            '0x154f': 'Wincor Nixdorf',
            '0x1fc9': 'NXP Semiconductors',
            '0x0dd4': 'Custom Engineering',
            '0x2730': 'Citizen'
          };
          const vendorHex = `0x${idVendor.toString(16).padStart(4, '0')}`;
          printerModel = vendors[vendorHex] || `USB Thermal Printer (${vendorHex})`;
        }
      } catch (modelErr) {
        console.warn('Printer modelini aniqlab bo\'lmadi:', modelErr.message);
      }

      // ✅ Qurilmani yopib, keyin javob beramiz
      try {
        device.close();
      } catch (closeErr) {
        console.warn('Printer yopishda xato:', closeErr.message);
      }

      safeRespond({
        connected: true,
        message: 'Printer ulangan',
        model: printerModel
      });
    });

    // ✅ Timeout: 5 soniya ichida javob kelmasa xato qaytaradi
    setTimeout(() => {
      safeRespond({
        connected: false,
        message: 'Printer javob bermadi (timeout)',
        error: 'TIMEOUT'
      });
    }, 5000);
  });

  return router;
};