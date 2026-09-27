let activeQuery = 'figure';
let activePage = 1;
let activePerPage = 12;
let searchResult = null;
let savedPage = 1;
let savedResult = null;
let editingFigureId = null;
let dashboardRequestController = null;
let savedRequestController = null;

async function loadDashboard() {
  const params = new URLSearchParams({
    q: activeQuery,
    page: String(activePage),
    per_page: String(activePerPage),
    type: document.getElementById('apiType').value.trim(),
    min_price: document.getElementById('minPrice').value,
    max_price: document.getElementById('maxPrice').value,
    sort: document.getElementById('sortAlgorithm').value,
    direction: document.getElementById('sortDirection').value,
  });

  showError('');
  document.getElementById('results').innerHTML = '<p class="empty">กำลังค้นหาราคา...</p>';
  dashboardRequestController?.abort();
  dashboardRequestController = new AbortController();

  try {
    const response = await fetch(`/figures?${params}`, { signal: dashboardRequestController.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');

    searchResult = data;
    renderFigures();
    renderPagination(data);
  } catch (error) {
    if (error.name === 'AbortError') return;
    searchResult = null;
    document.getElementById('results').innerHTML = '';
    showError(error.message);
  }
}

function showError(message) {
  const box = document.getElementById('error');
  box.textContent = message;
  box.hidden = !message;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatBaht(value) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatExchangeRate(data) {
  if (!Number.isFinite(data.exchange_rate)) return '';
  const parsedDate = Date.parse(data.exchange_rate_updated_at);
  const updatedLabel = Number.isFinite(parsedDate)
    ? new Date(parsedDate).toLocaleDateString('th-TH')
    : data.exchange_rate_updated_at;
  return `1 USD = ${formatBaht(data.exchange_rate)} · ${updatedLabel}`;
}

function linearSearch(items, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;

  const matches = [];
  for (const item of items) {
    const category = item.primary_browse_category?.name || '';
    const searchableText = `${item.name || ''} ${item.display_name || ''} ${category}`.toLocaleLowerCase();
    if (searchableText.includes(normalizedQuery)) matches.push(item);
  }
  return matches;
}

function renderFigures() {
  if (!searchResult) return;

  const localQuery = document.getElementById('listSearch').value;
  const items = linearSearch(searchResult.items, localQuery);
  document.getElementById('resultInfo').textContent =
    `${items.length} รายการในหน้านี้ · ${searchResult.items_total} ผลจาก API · ` +
      `${searchResult.algorithm} sort ${searchResult.direction === 'asc' ? '↑' : '↓'} · ${searchResult.sortMs} ms · ${formatExchangeRate(searchResult)}`;

  document.getElementById('results').innerHTML = items.length
    ? items.map(item => {
      const name = escapeHtml(item.display_name || item.name || 'ไม่ระบุชื่อ');
      const image = escapeHtml(item.image_url || '');
      const price = Number.isFinite(item.price)
          ? formatBaht(item.price)
        : 'ไม่มีข้อมูลราคา';
      const sourcePrice = Number.isFinite(item.price_usd)
        ? `ราคาเดิม ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.price_usd)}`
        : '';
      const category = escapeHtml(item.primary_browse_category?.name || item.language_label || 'ฟิกเกอร์');
      const store = escapeHtml(item.value_source_label || item.value_basis_label || 'CollectAIO');
      const confidence = item.value_confidence ? `ความเชื่อมั่น ${escapeHtml(item.value_confidence)}` : '';
      const releaseDate = item.release_date ? `วางจำหน่าย ${escapeHtml(item.release_date)}` : '';
      const condition = item.market_condition ? `สภาพ ${escapeHtml(item.market_condition)}` : '';
      const sampleSize = item.value_sample_size ? `ตัวอย่างราคา ${escapeHtml(item.value_sample_size)} รายการ` : '';

      return `<article class="figure-row">
        <img class="figure-image" src="${image}" alt="${name}" loading="lazy" onerror="this.hidden=true">
        <div class="figure-details">
          <h3>${name}</h3>
          <p>${category}${releaseDate ? ` · ${releaseDate}` : ''}</p>
          <span class="price-source">ร้านค้า/แหล่งราคา: ${store}${condition ? ` · ${condition}` : ''}</span>
          <span class="item-detail">${[sourcePrice, confidence, sampleSize].filter(Boolean).join(' · ')}</span>
        </div>
        <div class="figure-actions">
          <div class="figure-price">${price}</div>
          <button type="button" class="small-button" onclick="saveApiFigure(${Number(item.id)})">เก็บรายการ</button>
        </div>
      </article>`;
    }).join('')
    : '<p class="empty">ไม่พบรายการที่ตรงกับคำค้นในหน้านี้</p>';
}

async function loadSavedFigures() {
  const params = new URLSearchParams({
    q: document.getElementById('savedSearch').value.trim(),
    page: String(savedPage),
    per_page: document.getElementById('savedPerPage').value,
    type: document.getElementById('savedType').value.trim(),
    min_price: document.getElementById('savedMinPrice').value,
    max_price: document.getElementById('savedMaxPrice').value,
    sort: document.getElementById('savedSort').value,
    direction: document.getElementById('savedDirection').value,
  });
  savedRequestController?.abort();
  savedRequestController = new AbortController();

  try {
    const response = await fetch(`/saved-figures?${params}`, { signal: savedRequestController.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'โหลดรายการที่จัดเก็บไม่สำเร็จ');
    savedResult = data;
    renderSavedFigures(data);
  } catch (error) {
    if (error.name === 'AbortError') return;
    showError(error.message);
  }
}

function renderSavedFigures(data) {
  document.getElementById('savedInfo').textContent =
      `${data.items_total} รายการ · ${data.algorithm} sort ${data.direction === 'asc' ? '↑' : '↓'} · ${formatExchangeRate(data)}`;
  document.getElementById('savedResults').innerHTML = data.items.length
    ? data.items.map(figure => {
      const name = escapeHtml(figure.name);
      const image = escapeHtml(figure.image_url || '');
      const price = Number.isFinite(figure.price)
          ? formatBaht(figure.price)
        : 'ไม่มีข้อมูลราคา';
      return `<article class="figure-row saved-row">
        <img class="figure-image" src="${image}" alt="${name}" loading="lazy" onerror="this.hidden=true">
        <div class="figure-details">
          <h3>${name}</h3>
          <p>${escapeHtml(figure.character)} · ${escapeHtml(figure.type)}</p>
          <span class="price-source">ร้านค้า/แหล่งราคา: ${escapeHtml(figure.store || 'รายการที่ผู้ใช้จัดเก็บ')}</span>
          <span class="item-detail">${figure.release_date ? `วางจำหน่าย ${escapeHtml(figure.release_date)}` : 'รายละเอียดจากรายการที่จัดเก็บ'}</span>
        </div>
        <div class="figure-actions">
          <div class="figure-price">${price}</div>
          <button type="button" class="small-button" onclick="editFigure('${figure.id}')">แก้ไข</button>
          <button type="button" class="small-button danger-button" onclick="deleteFigure('${figure.id}')">ลบ</button>
        </div>
      </article>`;
    }).join('')
    : '<p class="empty">ยังไม่มีรายการที่จัดเก็บ</p>';

  document.getElementById('savedPageInfo').textContent = `หน้า ${data.page}`;
  document.getElementById('savedPreviousPage').disabled = data.page <= 1;
  document.getElementById('savedNextPage').disabled = !data.items_has_next_page;
}

function resetFigureForm() {
  editingFigureId = null;
  document.getElementById('figureForm').reset();
  document.getElementById('figureFormTitle').textContent = 'เพิ่มฟิกเกอร์ในรายการจัดเก็บ';
  document.getElementById('cancelEdit').hidden = true;
}

function fillFigureForm(figure) {
  editingFigureId = figure.id;
  document.getElementById('figureName').value = figure.name || '';
  document.getElementById('figureCharacter').value = figure.character || '';
  document.getElementById('figureType').value = figure.type || '';
  document.getElementById('figurePrice').value = figure.price ?? '';
  document.getElementById('figureStore').value = figure.store || '';
  document.getElementById('figureImage').value = figure.image_url || '';
  document.getElementById('figureReleaseDate').value = figure.release_date || '';
  document.getElementById('figureFormTitle').textContent = 'แก้ไขข้อมูลฟิกเกอร์';
  document.getElementById('cancelEdit').hidden = false;
  document.getElementById('figureForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveApiFigure(id) {
  const item = searchResult?.items.find(figure => Number(figure.id) === id);
  if (!item) return;
  await sendFigure('/saved-figures', 'POST', {
    name: item.display_name || item.name,
    character: item.display_name || item.name,
    type: item.primary_browse_category?.name || 'Action Figure',
    price: item.price,
    store: item.value_source_label || item.value_basis_label || 'CollectAIO',
    image_url: item.image_url,
    release_date: item.release_date,
  });
}

async function sendFigure(url, method, body) {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'บันทึกข้อมูลไม่สำเร็จ');
    showError('');
    resetFigureForm();
    await loadSavedFigures();
  } catch (error) {
    showError(error.message);
  }
}

async function editFigure(id) {
  const figure = savedResult?.items.find(item => item.id === id);
  if (figure) fillFigureForm(figure);
}

async function deleteFigure(id) {
  if (!window.confirm('ต้องการลบฟิกเกอร์รายการนี้หรือไม่')) return;
  try {
    const response = await fetch(`/saved-figures/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ลบข้อมูลไม่สำเร็จ');
    await loadSavedFigures();
  } catch (error) {
    showError(error.message);
  }
}

function renderPagination(data) {
  document.getElementById('pageInfo').textContent = `หน้า ${data.page} · แสดง ${data.items.length} จาก ${data.per_page} รายการต่อหน้า`;
  document.getElementById('previousPage').disabled = data.page <= 1;
  document.getElementById('nextPage').disabled = !data.items_has_next_page;
}

document.getElementById('apiSearchForm').addEventListener('submit', event => {
  event.preventDefault();
  activeQuery = document.getElementById('apiSearch').value.trim() || 'figure';
  activePage = 1;
  document.getElementById('listSearch').value = '';
  loadDashboard();
});

document.getElementById('listSearch').addEventListener('input', renderFigures);
document.getElementById('sortAlgorithm').addEventListener('change', loadDashboard);
document.getElementById('sortDirection').addEventListener('change', loadDashboard);
document.getElementById('apiType').addEventListener('input', () => { activePage = 1; loadDashboard(); });
document.getElementById('minPrice').addEventListener('input', () => { activePage = 1; loadDashboard(); });
document.getElementById('maxPrice').addEventListener('input', () => { activePage = 1; loadDashboard(); });
document.getElementById('perPage').addEventListener('change', event => {
  activePerPage = Number(event.target.value);
  activePage = 1;
  loadDashboard();
});
document.getElementById('savedSearch').addEventListener('input', () => {
  savedPage = 1;
  loadSavedFigures();
});
document.getElementById('savedSort').addEventListener('change', () => {
  savedPage = 1;
  loadSavedFigures();
});
document.getElementById('savedDirection').addEventListener('change', () => {
  savedPage = 1;
  loadSavedFigures();
});
document.getElementById('savedType').addEventListener('input', () => { savedPage = 1; loadSavedFigures(); });
document.getElementById('savedMinPrice').addEventListener('input', () => { savedPage = 1; loadSavedFigures(); });
document.getElementById('savedMaxPrice').addEventListener('input', () => { savedPage = 1; loadSavedFigures(); });
document.getElementById('savedPerPage').addEventListener('change', () => {
  savedPage = 1;
  loadSavedFigures();
});
document.getElementById('savedPreviousPage').addEventListener('click', () => {
  if (savedPage > 1) {
    savedPage--;
    loadSavedFigures();
  }
});
document.getElementById('savedNextPage').addEventListener('click', () => {
  if (savedResult?.items_has_next_page) {
    savedPage++;
    loadSavedFigures();
  }
});
document.getElementById('figureForm').addEventListener('submit', event => {
  event.preventDefault();
  const body = {
    name: document.getElementById('figureName').value,
    character: document.getElementById('figureCharacter').value,
    type: document.getElementById('figureType').value,
    price: document.getElementById('figurePrice').value,
    store: document.getElementById('figureStore').value,
    image_url: document.getElementById('figureImage').value,
    release_date: document.getElementById('figureReleaseDate').value,
  };
  sendFigure(editingFigureId ? `/saved-figures/${encodeURIComponent(editingFigureId)}` : '/saved-figures', editingFigureId ? 'PUT' : 'POST', body);
});
document.getElementById('cancelEdit').addEventListener('click', resetFigureForm);
document.getElementById('previousPage').addEventListener('click', () => {
  if (activePage > 1) {
    activePage--;
    loadDashboard();
  }
});
document.getElementById('nextPage').addEventListener('click', () => {
  if (searchResult?.items_has_next_page) {
    activePage++;
    loadDashboard();
  }
});

window.addEventListener('load', () => {
  loadDashboard();
  loadSavedFigures();
});

window.saveApiFigure = saveApiFigure;
window.editFigure = editFigure;
window.deleteFigure = deleteFigure;
