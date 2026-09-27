'use strict';

// Seeds clearly-marked demo rows so the UI can be exercised before real data is
// imported. Idempotent: previous demo rows are removed first.
//
// Row generation is a pure function and the storage step reuses the importer,
// so this script contains no SQL of its own.

const crypto = require('crypto');
const { createRuntime } = require('./bootstrap');

const COORDINATORS = ['Riya Saha', 'Arjun Mukherjee', 'Priyanka Dutta', 'Sameer Khan'];
const CLIENTS = [
  'Ananya & Vikram', 'Rohit Industries', 'Debojit & Shreya', 'Meera Kapoor',
  'Sanket Jewellers', 'Ishita & Arindam', 'Nova Boutique', 'Tuhin Banerjee',
  'Lakshmi Sarees', 'Kunal & Ritu', 'Vishal Realty', 'Ariya Chakraborty'
];
const TYPES = ['wedding', 'pre-wedding', 'fashion', 'commercial', 'maternity', 'newborn', 'product'];
const VENUES = [
  'Sambad Pavilion, Kolkata', 'The Grand Ballroom, Howrah', 'Studio 8, Salt Lake',
  'Nalhati Resort, Murshidabad', 'Skyline Rooftop, BKC', 'Botanical Garden, Shibpur'
];
const LOCATIONS = ['Kolkata', 'Howrah', 'Kharagpur', 'Darjeeling', 'Murshidabad'];
const STATUS_POOL = ['planned', 'completed', 'completed', 'completed', 'planned'];
const FEES = [5000, 8000, 12000, 15000, 20000, 25000, 35000, 45000];

const DEMO_TITLE_PREFIX = '[DEMO]';

/**
 * Build demo shoots spanning the last 8 and next 3 months.
 *
 * @param {{ now?: Date, random?: () => number }} [options] injectable for reproducible output
 */
function buildDemoRows({ now = new Date(), random = Math.random } = {}) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const rows = [];

  for (let offset = -8; offset <= 3; offset++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const count = 3 + Math.floor(random() * 5);

    for (let i = 0; i < count; i++) {
      const type = pick(TYPES);
      const client = pick(CLIENTS);
      const day = 1 + Math.floor(random() * 27);
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const fee = pick(FEES);
      const isFuture = new Date(date) > now;
      const status = isFuture ? 'planned' : pick(STATUS_POOL);
      const title = `${DEMO_TITLE_PREFIX} ${type.charAt(0).toUpperCase() + type.slice(1)} shoot`;
      const paid = isFuture ? 0 : random() < 0.8 ? fee : fee / 2;

      rows.push({
        title,
        client_name: client,
        shoot_type: type,
        shoot_date: date,
        end_date: null,
        start_time: '10:00:00',
        end_time: null,
        venue: pick(VENUES),
        location: pick(LOCATIONS),
        coordinator: pick(COORDINATORS),
        fee,
        status,
        contact_name: client.split(' ')[0],
        contact_phone: `+91 9${String(Math.floor(random() * 900000000) + 100000000)}`,
        notes: 'Demo row — replace with your imported data.',
        payments: paid
          ? [{ amount: paid, method: random() < 0.5 ? 'cash' : 'UPI', note: 'demo seed', paid_on: date }]
          : [],
        extra: {},
        dedupe_hash: crypto.createHash('md5').update(`demo|${title}|${date}|${client}`).digest('hex')
      });
    }
  }
  return rows;
}

async function seed() {
  const { logger, container } = createRuntime({ timestamps: false });
  try {
    await container.database.query(`DELETE FROM shoots WHERE title LIKE '${DEMO_TITLE_PREFIX}%'`);
    const result = await container.shootImporter.import(buildDemoRows());
    logger.info(`Demo seed: ${result.inserted} shoots, ${result.payments} payments.`);
    if (result.errors.length) logger.warn(`${result.errors.length} row(s) failed:`, result.errors[0].error);
  } catch (error) {
    logger.error('Seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await container.close();
  }
}

if (require.main === module) seed();

module.exports = { buildDemoRows, seed, DEMO_TITLE_PREFIX };
