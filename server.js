// CollectAIO figure price search API proxy
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STORAGE_FILE = path.join(__dirname, 'figures.json');
const API_PAGE_SIZE = 48;
const FALLBACK_USD_THB_RATE = 33.386191;
let exchangeRateCache = {
  rate: FALLBACK_USD_THB_RATE,
  updatedAt: 'อัตราสำรอง',
  fetchedAt: 0,
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function getUsdThbRate() {
  if (Date.now() - exchangeRateCache.fetchedAt < 60 * 60 * 1000) return exchangeRateCache;

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) throw new Error(`Exchange rate API ตอบกลับสถานะ ${response.status}`);
    const data = await response.json();
    if (data.result !== 'success' || !Number.isFinite(data.rates?.THB)) {
      throw new Error('ไม่ได้รับอัตรา USD/THB ที่ถูกต้อง');
    }
    exchangeRateCache = {
      rate: data.rates.THB,
      updatedAt: data.time_last_update_utc,
      fetchedAt: Date.now(),
    };
  } catch (error) {
    if (exchangeRateCache.fetchedAt) return exchangeRateCache;
    exchangeRateCache.updatedAt = 'อัตราสำรอง ใช้เมื่อเชื่อมต่อไม่ได้';
    exchangeRateCache.fetchedAt = Date.now();
  }
  return exchangeRateCache;
}

function readSavedFigures() {
  try {
    const figures = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
    return Array.isArray(figures) ? figures : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeSavedFigures(figures) {
  fs.writeFileSync(STORAGE_FILE, `${JSON.stringify(figures, null, 2)}\n`, 'utf8');
}

function normalizeFigure(input, existing = {}) {
  const name = String(input.name ?? existing.name ?? '').trim();
  const character = String(input.character ?? existing.character ?? '').trim();
  const type = String(input.type ?? existing.type ?? '').trim();
  const rawPrice = input.price ?? existing.price;
  const price = rawPrice === '' || rawPrice === null || rawPrice === undefined
    ? null
    : Number(rawPrice);

  if (!name || !character || !type) {
    return { error: 'กรุณาระบุชื่อฟิกเกอร์ ตัวละคร และประเภท' };
  }
  if (price !== null && !Number.isFinite(price)) {
    return { error: 'ราคาต้องเป็นตัวเลขหรือเว้นว่างได้' };
  }

  return {
    value: {
      ...existing,
      name,
      character,
      type,
      price,
      currency: 'THB',
      store: String(input.store ?? existing.store ?? '').trim(),
      image_url: String(input.image_url ?? existing.image_url ?? '').trim(),
      release_date: String(input.release_date ?? existing.release_date ?? '').trim(),
      updated_at: new Date().toISOString(),
    },
  };
}

function comparePrice(first, second, direction) {
  const firstHasPrice = Number.isFinite(first.price);
  const secondHasPrice = Number.isFinite(second.price);
  if (!firstHasPrice || !secondHasPrice) {
    if (firstHasPrice === secondHasPrice) return 0;
    return firstHasPrice ? -1 : 1;
  }
  return direction === 'desc' ? second.price - first.price : first.price - second.price;
}

function selectionSort(items, direction) {
  const sorted = [...items];
  for (let index = 0; index < sorted.length - 1; index++) {
    let bestIndex = index;
    for (let next = index + 1; next < sorted.length; next++) {
      if (comparePrice(sorted[next], sorted[bestIndex], direction) < 0) bestIndex = next;
    }
    [sorted[index], sorted[bestIndex]] = [sorted[bestIndex], sorted[index]];
  }
  return sorted;
}

function insertionSort(items, direction) {
  const sorted = [...items];
  for (let index = 1; index < sorted.length; index++) {
    const item = sorted[index];
    let cursor = index - 1;
    while (cursor >= 0 && comparePrice(sorted[cursor], item, direction) > 0) {
      sorted[cursor + 1] = sorted[cursor];
      cursor--;
    }
    sorted[cursor + 1] = item;
  }
  return sorted;
}

function bubbleSort(items, direction) {
  const sorted = [...items];
  for (let end = sorted.length - 1; end > 0; end--) {
    for (let index = 0; index < end; index++) {
      if (comparePrice(sorted[index], sorted[index + 1], direction) > 0) {
        [sorted[index], sorted[index + 1]] = [sorted[index + 1], sorted[index]];
      }
    }
  }
  return sorted;
}

function filterFigures(items, type, minPrice, maxPrice) {
  const normalizedType = String(type || '').trim().toLocaleLowerCase();
  const minimum = minPrice === '' || minPrice === undefined ? null : Number(minPrice);
  const maximum = maxPrice === '' || maxPrice === undefined ? null : Number(maxPrice);

  return items.filter(item => {
    const itemType = `${item.primary_browse_category?.name || item.type || ''}`.toLocaleLowerCase();
    const matchesType = !normalizedType || itemType.includes(normalizedType);
    const matchesMinimum = minimum === null || (Number.isFinite(item.price) && item.price >= minimum);
    const matchesMaximum = maximum === null || (Number.isFinite(item.price) && item.price <= maximum);
    return matchesType && matchesMinimum && matchesMaximum;
  });
}

app.get('/figures', async (req, res) => {
  const query = String(req.query.q || 'figure').trim();
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const perPageOptions = [6, 12, 24, 48];
  const perPage = perPageOptions.includes(Number.parseInt(req.query.per_page, 10))
    ? Number.parseInt(req.query.per_page, 10)
    : 24;
  const algorithm = ['selection', 'insertion', 'bubble'].includes(req.query.sort)
    ? req.query.sort
    : 'selection';
  const direction = req.query.direction === 'desc' ? 'desc' : 'asc';
  const type = String(req.query.type || '').trim();
  const minPrice = String(req.query.min_price ?? '').trim();
  const maxPrice = String(req.query.max_price ?? '').trim();
  const start = (page - 1) * perPage;
  const apiPage = Math.floor(start / API_PAGE_SIZE) + 1;

  try {
    const exchangeRate = await getUsdThbRate();
    const url = new URL('https://www.collectaio.com/api/v2/search');
    url.searchParams.set('q', query || 'figure');
    url.searchParams.set('category', 'action-figures');
    url.searchParams.set('page', String(apiPage));
    url.searchParams.set('per_page', String(API_PAGE_SIZE));

    const response = await fetch(url);
    if (!response.ok) throw new Error(`CollectAIO ตอบกลับสถานะ ${response.status}`);

    const result = await response.json();
    const startedAt = performance.now();
    const sorters = { selection: selectionSort, insertion: insertionSort, bubble: bubbleSort };
    const convertedItems = (Array.isArray(result.items) ? result.items : []).map(item => ({
      ...item,
      price_usd: item.price,
      price: Number.isFinite(item.price) ? item.price * exchangeRate.rate : null,
      currency: 'THB',
    }));
    const filtered = filterFigures(convertedItems, type, minPrice, maxPrice);
    const sorted = sorters[algorithm](filtered, direction);
    const pageOffset = start % API_PAGE_SIZE;
    const items = sorted.slice(pageOffset, pageOffset + perPage);

    res.json({
      ...result,
      items,
      items_total: sorted.length,
      items_has_next_page: pageOffset + perPage < sorted.length ||
        (pageOffset + perPage >= API_PAGE_SIZE && result.items_has_next_page === true),
      page,
      per_page: perPage,
      algorithm,
      direction,
      exchange_rate: exchangeRate.rate,
      exchange_rate_updated_at: exchangeRate.updatedAt,
      sortMs: (performance.now() - startedAt).toFixed(3),
    });
  } catch (error) {
    res.status(502).json({ error: error.message || 'เชื่อมต่อ CollectAIO ไม่สำเร็จ' });
  }
});

app.get('/saved-figures', async (req, res) => {
  try {
    const exchangeRate = await getUsdThbRate();
    const query = String(req.query.q || '').trim().toLocaleLowerCase();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const requestedPerPage = Number.parseInt(req.query.per_page, 10) || 12;
    const perPage = [6, 12, 24, 48].includes(requestedPerPage) ? requestedPerPage : 12;
    const direction = req.query.direction === 'desc' ? 'desc' : 'asc';
    const algorithm = ['selection', 'insertion', 'bubble'].includes(req.query.sort)
      ? req.query.sort
      : 'selection';
    const type = String(req.query.type || '').trim();
    const minPrice = String(req.query.min_price ?? '').trim();
    const maxPrice = String(req.query.max_price ?? '').trim();
    const savedFigures = readSavedFigures().map(figure => ({
      ...figure,
      price: Number.isFinite(figure.price)
        ? figure.currency === 'THB' ? figure.price : figure.price * exchangeRate.rate
        : null,
      currency: 'THB',
    }));
    const searched = savedFigures.filter(figure =>
      `${figure.name} ${figure.character} ${figure.type}`.toLocaleLowerCase().includes(query)
    );
    const filtered = filterFigures(searched, type, minPrice, maxPrice);
    const sorters = { selection: selectionSort, insertion: insertionSort, bubble: bubbleSort };
    const sorted = sorters[algorithm](filtered, direction);
    const start = (page - 1) * perPage;

    res.json({
      items: sorted.slice(start, start + perPage),
      items_total: sorted.length,
      page,
      per_page: perPage,
      items_has_next_page: start + perPage < sorted.length,
      algorithm,
      direction,
      exchange_rate: exchangeRate.rate,
      exchange_rate_updated_at: exchangeRate.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: `อ่านรายการที่จัดเก็บไม่สำเร็จ: ${error.message}` });
  }
});

app.post('/saved-figures', (req, res) => {
  const normalized = normalizeFigure(req.body || {});
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  try {
    const figure = {
      id: crypto.randomUUID(),
      ...normalized.value,
      created_at: new Date().toISOString(),
    };
    const savedFigures = readSavedFigures();
    savedFigures.push(figure);
    writeSavedFigures(savedFigures);
    res.status(201).json(figure);
  } catch (error) {
    res.status(500).json({ error: `เพิ่มฟิกเกอร์ไม่สำเร็จ: ${error.message}` });
  }
});

app.put('/saved-figures/:id', (req, res) => {
  try {
    const savedFigures = readSavedFigures();
    const index = savedFigures.findIndex(figure => figure.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'ไม่พบฟิกเกอร์ที่ต้องการแก้ไข' });

    const normalized = normalizeFigure(req.body || {}, savedFigures[index]);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    savedFigures[index] = normalized.value;
    writeSavedFigures(savedFigures);
    res.json(savedFigures[index]);
  } catch (error) {
    res.status(500).json({ error: `แก้ไขฟิกเกอร์ไม่สำเร็จ: ${error.message}` });
  }
});

app.delete('/saved-figures/:id', (req, res) => {
  try {
    const savedFigures = readSavedFigures();
    const remaining = savedFigures.filter(figure => figure.id !== req.params.id);
    if (remaining.length === savedFigures.length) {
      return res.status(404).json({ error: 'ไม่พบฟิกเกอร์ที่ต้องการลบ' });
    }
    writeSavedFigures(remaining);
    res.json({ message: 'ลบฟิกเกอร์เรียบร้อย' });
  } catch (error) {
    res.status(500).json({ error: `ลบฟิกเกอร์ไม่สำเร็จ: ${error.message}` });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Figure price search: http://localhost:${PORT}`));
}

module.exports = app;
