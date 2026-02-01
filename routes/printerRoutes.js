const express = require('express');
const router = express.Router();
const escpos = require('escpos');
const USBAdapter = require('@node-escpos/usb-adapter');

module.exports = (io) => {
  // Printer holatini tekshirish endpoint
  router.get('/check-printer', (req, res) => {
    const device = new USBAdapter();
    device.open((err) => {
      if (err) {
        console.log('Printer topilmadi:', err.message);
        return res.json({ 
          connected: false, 
          message: 'Printer ulanmagan',
          error: err.message 
        });
      }

      let printerModel = 'USB Thermal Printer';
      try {
        const deviceInfo = device.device;
        if (deviceInfo && deviceInfo.deviceDescriptor) {
          const { idVendor } = deviceInfo.deviceDescriptor;
          const vendors = {
            '0x0411': 'XP 58IIL',
            '0x0416': 'SPRT',
            '0x0483': 'STMicroelectronics',
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
        console.log('Printer modelini aniqlab bo\'lmadi:', modelErr.message);
      }

      device.close();
      res.json({ connected: true, message: 'Printer ulangan', model: printerModel });
    });
  });

  // Chek chop etish endpoint
  router.post('/print-receipt/:login', (req, res) => {
    const { sales, totalPrice, date } = req.body;
    const login = req.params.login;

    if (!sales || !Array.isArray(sales) || sales.length === 0) {
      const errorMsg = "Sotuv ro'yxati bo'sh";
      if (io) io.emit('print-error', { login, message: errorMsg });
      return res.status(400).json({ success: false, error: errorMsg });
    }

    const device = new USBAdapter();
    device.open((err) => {
      if (err) {
        console.error('Printer ochishda xato:', err.message);
        const errorMsg = 'Printer ulanmagan yoki xato yuz berdi';
        if (io) io.emit('print-error', { login, message: errorMsg, error: err.message });
        return res.status(500).json({ 
          success: false, 
          connected: false, 
          error: errorMsg, 
          details: err.message 
        });
      }

      const printer = new escpos.Printer(device);

      try {
        // Chek sarlavhasi
        printer
          .font('a')
          .align('ct')
          .style('bu')
          .size(1, 1)
          .text('SHOX POS PRO')
          .style('normal')
          .size(0, 0)
          .text('-------------------------------')
          .text('');

        // Xodim va sana
        const formattedDate = date || new Date().toLocaleString('uz-UZ', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }).replace(',', '');

        printer
          .align('lt')
          .text(`Xodim: ${login}`)
          .text(`Sana: ${formattedDate}`)
          .text('-------------------------------')
          .text('');

        // Jadval sarlavhasi
        printer
          .style('b')
          .tableCustom([
            { text: 'Mahsulot', align: 'LEFT', width: 0.40 },
            { text: 'Soni', align: 'CENTER', width: 0.15 },
            { text: 'Narx', align: 'RIGHT', width: 0.22 },
            { text: 'Jami', align: 'RIGHT', width: 0.23 }
          ])
          .style('normal')
          .text('-------------------------------');

        // Mahsulotlar ro'yxati
const splitName = (name, maxLength = 10) => {
  const chunks = [];
  for (let i = 0; i < name.length; i += maxLength) {
    chunks.push(name.substring(i, i + maxLength));
  }
  return chunks;
};



sales.forEach(item => {
  const nameChunks = splitName(item.name || 'Noma\'lum');
  const count = String(item.count || 1);
  const price = String(item.price || 0);
  const itemTotal = Number(item.count || 1) * Number(item.price || 0);
  const total = String(itemTotal);

  // Birinchi qator
  printer.tableCustom([
    { text: nameChunks[0], align: 'LEFT', width: 0.50 },
    { text: count, align: 'CENTER', width: 0.15 },
    { text: price, align: 'RIGHT', width: 0.15 },
    { text: total, align: 'RIGHT', width: 0.20 }
  ]);

  // Qolgan qatorlar
  for (let i = 1; i < nameChunks.length; i++) {
    printer.tableCustom([
      { text: nameChunks[i], align: 'LEFT', width: 0.50 },
      { text: '', align: 'CENTER', width: 0.15 },
      { text: '', align: 'RIGHT', width: 0.15 },
      { text: '', align: 'RIGHT', width: 0.20 }
    ]);
  }
});



        // Jami summa
        printer
  .text('-------------------------------')
  .align('rt')
  .style('b')
  .size(1, 1)
  .text(`JAMI: ${String(totalPrice)} so'm`)
  .size(0, 0)
  .style('normal');


        // Footer
        printer
          .align('ct')
          .text('')
          .style('b')
          .text('Rahmat!')
          .text('Yana tashrif buyuring!')
          .style('normal')
          .text('')
          .feed(3)
          .cut()
          .close();

        // Socket orqali xabar
        if (io) {
          io.emit('print-success', { 
            login, 
            message: 'Chek muvaffaqiyatli chiqarildi', 
            total: Number(totalPrice), 
            itemCount: sales.length 
          });
        }

        res.json({ 
          success: true, 
          connected: true, 
          message: 'Chek muvaffaqiyatli chiqarildi', 
          itemCount: sales.length 
        });

      } catch (printErr) {
        console.error('Chop etishda xato:', printErr.message);
        if (io) {
          io.emit('print-error', { 
            login, 
            message: 'Chop etishda xato', 
            error: printErr.message 
          });
        }
        res.status(500).json({ 
          success: false, 
          error: 'Chop etishda xato', 
          details: printErr.message 
        });
      } finally {
        try { device.close(); } catch (closeErr) { console.error('Device yopishda xato:', closeErr.message); }
      }
    });
  });

  return router;
};
