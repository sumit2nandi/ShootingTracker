import { MONTH_NAMES } from '../core/format.js';
import { appStatus } from './shoot-status.js';

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Rebuild the original spreadsheet layout (Date / Description / Coordinator /
 * Remuneration / Status plus the Month·Total side block).
 *
 * Pure: rows in, CSV text out — so the format is pinned by tests instead of by
 * opening a file in a spreadsheet.
 *
 * @param {object[]} rows shoots as returned by `GET /api/shoots`
 * @returns {string}
 */
export function buildExportCsv(rows) {
  if (!rows.length) return '';
  const sorted = [...rows].sort((a, b) =>
    a.shoot_date < b.shoot_date ? -1 : a.shoot_date > b.shoot_date ? 1 : a.id - b.id
  );
  const [firstYear, firstMonth] = String(sorted[0].shoot_date).slice(0, 7).split('-').map(Number);

  // 12 consecutive months from the earliest month, like the original sheet
  const monthTotals = [];
  for (let offset = 0; offset < 12; offset++) {
    const date = new Date(firstYear, firstMonth - 1 + offset, 1);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const total = sorted.reduce(
      (sum, shoot) => (String(shoot.shoot_date).slice(0, 7) === yearMonth ? sum + (+shoot.fee || 0) : sum),
      0
    );
    monthTotals.push({ name: MONTH_NAMES[date.getMonth()], total });
  }

  const lines = ['Date,Description,Coordinator ,Remuneration,Status,,Month,Total,,Advance,,'];
  sorted.forEach((shoot, index) => {
    const [year, month, day] = String(shoot.shoot_date).slice(0, 10).split('-').map(Number);
    const monthTotal = monthTotals[index];
    lines.push(
      [
        `${day}-${MONTH_NAMES[month - 1]}-${year}`,
        csvCell(shoot.title),
        csvCell(shoot.coordinator || ''),
        Math.round((+shoot.fee || 0) * 100) / 100,
        appStatus(shoot.status) === 'completed' ? 'Done' : '',
        '',
        monthTotal ? monthTotal.name : '',
        monthTotal ? monthTotal.total : '',
        '',
        index === 0 ? 'Description ' : '',
        index === 0 ? 'Amount ' : '',
        index === 0 ? 'Date' : ''
      ].join(',')
    );
  });
  return lines.join('\n');
}

/** Trigger a browser download for generated text. */
export function downloadText(filename, content, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
