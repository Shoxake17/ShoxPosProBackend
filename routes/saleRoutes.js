// const express = require('express');
// const router = express.Router();
// const fs = require('fs');
// const path = require('path');

// /**
//  * 📌 Save Sale
//  * POST /api/sales/save
//  * Body: { login, name, barcode, quantity, price }
//  */
// router.post('/save', async (req, res) => {
//   console.log('💾 Save sale so\'rovi keldi:', req.body);
  
//   const { login, name, barcode, quantity, price } = req.body;

//   // Validatsiya
//   if (!login || !barcode || !name || !quantity || !price) {
//     console.warn("⚠️ Ma'lumotlar to'liq emas:", req.body);
//     return res.status(400).json({ 
//       success: false,
//       message: "❌ Sotuv ma'lumotlari to'liq emas",
//       required: ['login', 'name', 'barcode', 'quantity', 'price']
//     });
//   }

//   // Raqamlarni tekshirish
//   if (isNaN(quantity) || isNaN(price) || quantity <= 0 || price < 0) {
//     return res.status(400).json({ 
//       success: false,
//       message: "❌ Quantity va price to'g'ri raqam bo'lishi kerak"
//     });
//   }

//   try {
//     const today = new Date().toISOString().split("T")[0];
//     const userDir = path.join(__dirname, "..", "login", login);
//     const jsonFilePath = path.join(userDir, `${login}.json`);

//     // Foydalanuvchi direktoriyasini yaratish
//     if (!fs.existsSync(userDir)) {
//       fs.mkdirSync(userDir, { recursive: true });
//       console.log(`📁 Yangi foydalanuvchi direktoriyasi yaratildi: ${userDir}`);
//     }

//     // Mavjud ma'lumotlarni o'qish
//     let data = {};
//     if (fs.existsSync(jsonFilePath)) {
//       try {
//         const raw = fs.readFileSync(jsonFilePath, "utf-8");
//         data = JSON.parse(raw);
//       } catch (err) {
//         console.warn("⚠️ JSON faylni parse qilishda xatolik:", err.message);
//         data = {};
//       }
//     }

//     // Bugungi sanani initsializatsiya qilish
//     if (!data[today]) {
//       data[today] = [];
//     }

//     // Mavjud mahsulotni tekshirish va yangilash
//     const existing = data[today].find(item => item.barcode === barcode);
    
//     if (existing) {
//       // Mavjud mahsulotga qo'shish
//       existing.quantity += Number(quantity);
//       existing.total = existing.quantity * existing.price;
//       console.log(`📦 Mavjud mahsulot yangilandi: ${existing.name} (${existing.quantity})`);
//     } else {
//       // Yangi mahsulot qo'shish
//       const newProduct = {
//         name,
//         barcode,
//         quantity: Number(quantity),
//         price: Number(price),
//         total: Number(quantity) * Number(price),
//         date: new Date().toISOString()
//       };
//       data[today].push(newProduct);
//       console.log(`✨ Yangi mahsulot qo'shildi: ${name}`);
//     }

//     // Faylga yozish
//     fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), "utf-8");
//     console.log(`✅ Sotuv muvaffaqiyatli saqlandi: ${jsonFilePath}`);
    
//     res.json({ 
//       success: true,
//       message: "✅ Sotuv muvaffaqiyatli saqlandi",
//       saved: true,
//       data: data[today]
//     });

//   } catch (err) {
//     console.error("❌ Sotuvni saqlashda xatolik:", err);
//     res.status(500).json({ 
//       success: false,
//       message: "❌ Server xatosi",
//       error: err.message 
//     });
//   }
// });

// /**
//  * 📌 Get User Sales
//  * GET /api/sales/:login
//  * Optional query: ?date=YYYY-MM-DD
//  */
// router.get('/:login', (req, res) => {
//   const { login } = req.params;
//   const { date } = req.query;

//   if (!login) {
//     return res.status(400).json({ 
//       success: false,
//       message: "❌ Login parametri kerak" 
//     });
//   }

//   const jsonFilePath = path.join(__dirname, "..", "login", login, `${login}.json`);

//   // Fayl mavjudligini tekshirish
//   if (!fs.existsSync(jsonFilePath)) {
//     console.warn(`⚠️ Fayl topilmadi: ${jsonFilePath}`);
//     return res.status(404).json({ 
//       success: false,
//       message: "❌ Sotuvlar topilmadi",
//       data: {}
//     });
//   }

//   try {
//     const raw = fs.readFileSync(jsonFilePath, "utf-8");
//     let data = JSON.parse(raw);

//     // Eski formatni yangi formatga o'zgartirish (agar kerak bo'lsa)
//     if (Array.isArray(data)) {
//       const merged = {};
//       data.forEach(entry => {
//         if (entry.products) {
//           Object.entries(entry.products).forEach(([date, items]) => {
//             if (!merged[date]) merged[date] = [];
//             merged[date].push(...items);
//           });
//         }
//       });
//       data = merged;
//     }

//     // Agar ma'lum bir sana so'ralsa
//     if (date) {
//       const dateData = data[date] || [];
//       return res.json({ 
//         success: true,
//         date,
//         sales: dateData,
//         total: dateData.reduce((sum, item) => sum + (item.total || 0), 0)
//       });
//     }

//     // Barcha sanalarni statistika bilan qaytarish
//     const statistics = {
//       totalDays: Object.keys(data).length,
//       totalSales: Object.values(data).reduce((sum, items) => sum + items.length, 0),
//       totalAmount: Object.values(data).reduce((sum, items) => 
//         sum + items.reduce((s, item) => s + (item.total || 0), 0), 0
//       )
//     };

//     res.json({ 
//       success: true,
//       data,
//       statistics
//     });

//   } catch (err) {
//     console.error("❌ JSON faylni o'qishda xatolik:", err);
//     res.status(500).json({ 
//       success: false,
//       message: "❌ Faylni o'qib bo'lmadi",
//       error: err.message 
//     });
//   }
// });

// /**
//  * 📌 Get Today's Sales
//  * GET /api/sales/:login/today
//  */
// router.get('/:login/today', (req, res) => {
//   const { login } = req.params;
//   const today = new Date().toISOString().split("T")[0];
//   const jsonFilePath = path.join(__dirname, "..", "login", login, `${login}.json`);

//   if (!fs.existsSync(jsonFilePath)) {
//     return res.json({ 
//       success: true,
//       date: today,
//       sales: [],
//       total: 0
//     });
//   }

//   try {
//     const raw = fs.readFileSync(jsonFilePath, "utf-8");
//     const data = JSON.parse(raw);
//     const todaySales = data[today] || [];

//     const total = todaySales.reduce((sum, item) => sum + (item.total || 0), 0);

//     res.json({ 
//       success: true,
//       date: today,
//       sales: todaySales,
//       total
//     });

//   } catch (err) {
//     console.error("❌ Bugungi sotuvlarni olishda xatolik:", err);
//     res.status(500).json({ 
//       success: false,
//       message: "❌ Server xatosi",
//       error: err.message 
//     });
//   }
// });

// /**
//  * 📌 Update Product Price
//  * PUT /api/sales/update-price
//  * Body: { login, barcode, price }
//  */
// router.put('/update-price', (req, res) => {
//   const { login, barcode, price } = req.body;

//   // Validatsiya
//   if (!login || !barcode || price === undefined) {
//     return res.status(400).json({ 
//       success: false, 
//       message: "❌ Login, barcode va price kerak" 
//     });
//   }

//   if (isNaN(price) || price < 0) {
//     return res.status(400).json({ 
//       success: false, 
//       message: "❌ Price musbat raqam bo'lishi kerak" 
//     });
//   }

//   const filePath = path.join(__dirname, "..", "login", login, `${login}.json`);

//   if (!fs.existsSync(filePath)) {
//     return res.status(404).json({ 
//       success: false, 
//       message: "❌ Fayl topilmadi" 
//     });
//   }

//   try {
//     const raw = fs.readFileSync(filePath, "utf-8");
//     const data = JSON.parse(raw);
//     let updated = false;
//     let updatedItems = [];

//     // Barcha sanalar bo'yicha qidirish va yangilash
//     Object.entries(data).forEach(([date, products]) => {
//       if (Array.isArray(products)) {
//         products.forEach(item => {
//           if (item.barcode === barcode) {
//             const oldPrice = item.price;
//             item.price = Number(price);
//             item.total = item.quantity * Number(price);
//             updated = true;
//             updatedItems.push({
//               date,
//               name: item.name,
//               oldPrice,
//               newPrice: Number(price),
//               quantity: item.quantity,
//               newTotal: item.total
//             });
//             console.log(`💲 Narx yangilandi: ${item.name} (${oldPrice} → ${price})`);
//           }
//         });
//       }
//     });

//     if (updated) {
//       fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
//       return res.json({ 
//         success: true,
//         message: "✅ Narx muvaffaqiyatli yangilandi",
//         updated: updatedItems
//       });
//     } else {
//       return res.status(404).json({ 
//         success: false, 
//         message: "❌ Mahsulot topilmadi" 
//       });
//     }

//   } catch (err) {
//     console.error("❌ Narxni yangilashda xatolik:", err);
//     res.status(500).json({ 
//       success: false, 
//       message: "❌ Server xatosi",
//       error: err.message 
//     });
//   }
// });

// /**
//  * 📌 Delete Sale Item
//  * DELETE /api/sales/delete
//  * Body: { login, barcode, date }
//  */
// router.delete('/delete', (req, res) => {
//   const { login, barcode, date } = req.body;

//   if (!login || !barcode || !date) {
//     return res.status(400).json({ 
//       success: false, 
//       message: "❌ Login, barcode va date kerak" 
//     });
//   }

//   const filePath = path.join(__dirname, "..", "login", login, `${login}.json`);

//   if (!fs.existsSync(filePath)) {
//     return res.status(404).json({ 
//       success: false, 
//       message: "❌ Fayl topilmadi" 
//     });
//   }

//   try {
//     const raw = fs.readFileSync(filePath, "utf-8");
//     const data = JSON.parse(raw);

//     if (!data[date] || !Array.isArray(data[date])) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "❌ Ushbu sanada sotuvlar topilmadi" 
//       });
//     }

//     const initialLength = data[date].length;
//     data[date] = data[date].filter(item => item.barcode !== barcode);

//     if (data[date].length === initialLength) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "❌ Mahsulot topilmadi" 
//       });
//     }

//     // Agar sana bo'sh qolsa, uni o'chirish
//     if (data[date].length === 0) {
//       delete data[date];
//     }

//     fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
//     console.log(`🗑️ Mahsulot o'chirildi: ${barcode} (${date})`);

//     res.json({ 
//       success: true, 
//       message: "✅ Mahsulot muvaffaqiyatli o'chirildi",
//       remainingItems: data[date] ? data[date].length : 0
//     });

//   } catch (err) {
//     console.error("❌ Mahsulotni o'chirishda xatolik:", err);
//     res.status(500).json({ 
//       success: false, 
//       message: "❌ Server xatosi",
//       error: err.message 
//     });
//   }
// });

// /**
//  * 📌 Get Sales Statistics
//  * GET /api/sales/:login/stats
//  * Optional query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//  */
// router.get('/:login/stats', (req, res) => {
//   const { login } = req.params;
//   const { startDate, endDate } = req.query;

//   const filePath = path.join(__dirname, "..", "login", login, `${login}.json`);

//   if (!fs.existsSync(filePath)) {
//     return res.json({ 
//       success: true,
//       statistics: {
//         totalSales: 0,
//         totalAmount: 0,
//         totalProducts: 0,
//         averagePerDay: 0
//       }
//     });
//   }

//   try {
//     const raw = fs.readFileSync(filePath, "utf-8");
//     const data = JSON.parse(raw);

//     let filteredData = data;

//     // Sana oralig'i bo'yicha filtrlash
//     if (startDate || endDate) {
//       filteredData = {};
//       Object.entries(data).forEach(([date, items]) => {
//         const inRange = (!startDate || date >= startDate) && 
//                        (!endDate || date <= endDate);
//         if (inRange) {
//           filteredData[date] = items;
//         }
//       });
//     }

//     const statistics = {
//       totalDays: Object.keys(filteredData).length,
//       totalSales: Object.values(filteredData).reduce((sum, items) => sum + items.length, 0),
//       totalAmount: Object.values(filteredData).reduce((sum, items) => 
//         sum + items.reduce((s, item) => s + (item.total || 0), 0), 0
//       ),
//       averagePerDay: 0,
//       topProducts: []
//     };

//     if (statistics.totalDays > 0) {
//       statistics.averagePerDay = statistics.totalAmount / statistics.totalDays;
//     }

//     // Top mahsulotlarni hisoblash
//     const productSummary = {};
//     Object.values(filteredData).forEach(items => {
//       items.forEach(item => {
//         if (!productSummary[item.barcode]) {
//           productSummary[item.barcode] = {
//             name: item.name,
//             barcode: item.barcode,
//             totalQuantity: 0,
//             totalAmount: 0
//           };
//         }
//         productSummary[item.barcode].totalQuantity += item.quantity;
//         productSummary[item.barcode].totalAmount += item.total;
//       });
//     });

//     statistics.topProducts = Object.values(productSummary)
//       .sort((a, b) => b.totalAmount - a.totalAmount)
//       .slice(0, 10);

//     res.json({ 
//       success: true,
//       statistics,
//       dateRange: { startDate, endDate }
//     });

//   } catch (err) {
//     console.error("❌ Statistikani olishda xatolik:", err);
//     res.status(500).json({ 
//       success: false, 
//       message: "❌ Server xatosi",
//       error: err.message 
//     });
//   }
// });

// module.exports = router;