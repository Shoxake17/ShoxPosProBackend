const { MongoClient } = require("mongodb");

function cleanName(name) {
  if (!name) return ""; // agar null/undefined bo‘lsa bo‘sh string qaytar
  return String(name)   // majburan stringga aylantiramiz
    .replace(/\(.*?\)/g, "")
    .replace(/қадоқсиз.*$/i, "")
    .replace(/1\s*дона.*$/i, "")
    .replace(/,+/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}


async function run() {
  const client = await MongoClient.connect(
    "mongodb+srv://ShoxPosProCluster:Parol.2003@cluster1.a5xadn9.mongodb.net/"
  );
  const db = client.db("test");
  const products = db.collection("products");

  const total = await products.countDocuments();
  let processed = 0;

  const cursor = products.find({});
  let ops = [];

  while (await cursor.hasNext()) {
    const product = await cursor.next();
    const cleanedName = cleanName(product.name);

    ops.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { name: cleanedName } }
      }
    });

    // Har 1000 ta hujjatdan keyin bulkWrite
    if (ops.length === 1000) {
      await products.bulkWrite(ops);
      processed += ops.length;
      ops = [];

      const percent = ((processed / total) * 100).toFixed(2);
      console.log(`Progress: ${processed}/${total} (${percent}%)`);
    }
  }

  // Oxirgi batchni ham yozamiz
  if (ops.length > 0) {
    await products.bulkWrite(ops);
    processed += ops.length;
  }

  console.log(`✅ Cleaning tugadi! ${processed}/${total} hujjat yangilandi.`);
  await client.close();
}

run();
