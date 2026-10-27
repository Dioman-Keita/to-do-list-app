const pad = (n) => String(n).padStart(2, '0');

export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayKey = () => toKey(new Date());

export const addDays = (key, n) => {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
};

const fmt = (key, options) => fromKey(key).toLocaleDateString('fr-FR', options);

export const weekday = (key) => fmt(key, { weekday: 'long' });
export const longDate = (key) => fmt(key, { day: 'numeric', month: 'long', year: 'numeric' });
export const shortDate = (key) => fmt(key, { day: 'numeric', month: 'short' });
export const monthLabel = (d) => d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export const isDayKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
