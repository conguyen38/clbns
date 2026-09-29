require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const { randomUUID } = require('crypto');
const sql = neon(process.env.DATABASE_URL);

const CHECKPOINTS = [
  { name: 'OneMount - Văn phòng Hà Nội (Times City)', lat: 21.0042501, long: 105.8695696, radius: 150 },
  { name: 'OneMount - Văn phòng HCM (Lumiere Riverside)', lat: 10.8025, long: 106.7478, radius: 500 },
  { name: 'Masterise - VP bán hàng Ocean Park 3', lat: 20.9550, long: 105.9450, radius: 500 },
];

async function main() {
  for (const c of CHECKPOINTS) {
    const id = randomUUID();
    await sql`
      INSERT INTO checkpoints (checkpoint_id, checkpoint_name, lat, long, radius_m)
      VALUES (${id}, ${c.name}, ${c.lat}, ${c.long}, ${c.radius})
    `;
    console.log('added', c.name, id);
  }
  const all = await sql`select checkpoint_id, checkpoint_name, lat, long, radius_m from checkpoints order by checkpoint_name`;
  console.log(all);
}
main().catch(e => { console.error(e); process.exit(1); });
