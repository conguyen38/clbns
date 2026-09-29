require('dotenv').config();
const { Jimp } = require('jimp');
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function makeThumb(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const buf = Buffer.from(base64, 'base64');
  const img = await Jimp.read(buf);
  img.resize({ w: 120 });
  const out = await img.getBase64('image/jpeg');
  return out;
}

async function main() {
  const rows = await sql`select checkin_id, photo_url from checkins where photo_url <> '' and (photo_thumb is null or photo_thumb = '')`;
  console.log(`Found ${rows.length} checkins needing a thumbnail.`);
  for (const r of rows) {
    try {
      const thumb = await makeThumb(r.photo_url);
      await sql`update checkins set photo_thumb = ${thumb} where checkin_id = ${r.checkin_id}`;
      console.log(`  ${r.checkin_id}: thumb ${thumb.length} bytes (was ${r.photo_url.length})`);
    } catch (e) {
      console.error(`  ${r.checkin_id}: FAILED - ${e.message}`);
    }
  }
  console.log('Done.');
}
main().catch(e => { console.error(e); process.exit(1); });
