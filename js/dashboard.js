// ===== KIRTI PHARMA — dashboard.js =====
// Chemist Portal: Prescription Review, Bill Builder, Order Fulfillment & Inventory Management

let PRESCRIPTIONS = [];
let completedPrescriptions = [];
let currentPrescription = null;
let chemistOrders = [];
let filteredChemistOrders = [];
let activeChemistOrderFilter = 'all';
let currentBillingOrder = null;
let currentModalOrder = null;
let billRows = [];
let dashTableSearch = '';
let currentPage = 1;
const PAGE_SIZE = 15;
let activeDashTab = 'prescriptions';

document.addEventListener('DOMContentLoaded', async () => {
  // Chemist Authorization Guard:
  // Whoever is tagged with admin in the database can access the Chemist Dashboard!
  const isLoggedIn = localStorage.getItem('kp_logged_in') === 'true';
  const role = (localStorage.getItem('kp_user_role') || '').toLowerCase();
  const isAdmin = (role === 'admin' || role === 'chemist');

  if (!isLoggedIn || !isAdmin) {
    sessionStorage.setItem('kp_auth_msg', '🔒 Access Restricted: Chemist Portal is reserved for accounts tagged as Admin in database. Showing customer store.');
    window.location.replace('index.html');
    return;
  }

  initClock();
  initDashboardSearch();
  initDashTabs();
  initChemistRealtimeEvents();

  // Load initial data from backend
  await Promise.all([
    loadPrescriptionsFromApi(),
    loadChemistOrdersFromApi(),
    loadMedicinesFromApi(),
    loadStatsFromApi(),
    loadCustomersFromApi()
  ]);
});

function initClock() {
  const el = document.getElementById('current-time');
  if (!el) return;
  const update = () => {
    el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  update();
  setInterval(update, 60000);
}

// ===== REAL-TIME SSE SYNC =====
function initChemistRealtimeEvents() {
  if (!window.EventSource) return;

  try {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'new_order') {
          chemistOrders.unshift(data.payload);
          applyChemistOrderFilter();
          updateDashStats();
          showToast(`🔔 New Order #${data.payload.id} received from ${data.payload.customerName}!`, 'success', 6000);
        } else if (data.type === 'prescription_uploaded') {
          PRESCRIPTIONS.unshift(data.payload);
          renderPrescriptionList();
          updateDashStats();
          showToast(`📋 New Prescription received from ${data.payload.patient}!`, 'info', 6000);
        } else if (data.type === 'order_status_updated') {
          const idx = chemistOrders.findIndex(o => o.id === data.payload.id);
          if (idx > -1) {
            chemistOrders[idx] = data.payload;
            applyChemistOrderFilter();
          }
        } else if (data.type === 'medicine_added') {
          if (!MEDICINES.some(m => m.id === data.payload.id)) {
            MEDICINES.unshift(data.payload);
            renderMedicineTable();
          }
        }
      } catch (err) {}
    };
  } catch (e) {}
}

// ===== LOAD FROM API =====
async function loadPrescriptionsFromApi() {
  try {
    const res = await fetch('/api/prescriptions');
    const json = await res.json();
    if (json.success && json.data) {
      PRESCRIPTIONS = json.data.filter(p => p.status !== 'Completed');
      completedPrescriptions = json.data.filter(p => p.status === 'Completed');
    }
  } catch (e) {
    PRESCRIPTIONS = [
      { id: 1, patient: 'Meena Deshpande', initials: 'MD', time: '3:45 PM', source: 'App', status: 'Pending', color: '#7C3AED', phone: '+919876543211', fileUrl: 'images/med_fever_pain.png' },
      { id: 2, patient: 'Suresh Bawane', initials: 'SB', time: '4:02 PM', source: 'WhatsApp', status: 'Pending', color: '#2563EB', phone: '+919876543212', fileUrl: 'images/med_chronic.png' },
      { id: 3, patient: 'Priya Nagpure', initials: 'PN', time: '4:28 PM', source: 'App', status: 'Pending', color: '#DB2777', phone: '+919876543213', fileUrl: 'images/med_antibiotics.png' },
    ];
  }
  renderPrescriptionList();
}

async function loadChemistOrdersFromApi() {
  try {
    const res = await fetch('/api/orders');
    const json = await res.json();
    if (json.success && json.data) {
      chemistOrders = json.data;
    }
  } catch (e) {
    chemistOrders = [];
  }
  applyChemistOrderFilter();
}

const SUPABASE_API_URL = 'https://fbbxjlvwejpqgkpngdam.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SsDTP0Nb5QWiUBJd6nWCKQ_BJcDwgbc';

async function fetchSupabaseMedicinesDirect() {
  try {
    const res = await fetch(`${SUPABASE_API_URL}/rest/v1/medicines?select=*&order=id.asc`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.map(m => ({
      ...m,
      packSize: m.packsize ?? m.packSize ?? 10,
      packUnit: m.packunit ?? m.packUnit ?? 'tablets',
      imageColor: m.imagecolor ?? m.imageColor ?? '#FEE2E2',
      image: (m.image && m.image.trim()) ? m.image : ((typeof CAT_IMAGES !== 'undefined' ? CAT_IMAGES[m.category] : null) || 'images/med_fever_pain.png'),
      stock: Number(m.stock || 0),
      sold: Number(m.sold || 0),
      price: Number(m.price || 0),
      mrp: Number(m.mrp || 0),
      prescription_required: Boolean(m.prescription_required),
      chronic: Boolean(m.chronic)
    }));
  } catch (err) {
    console.warn('[SUPABASE DIRECT FETCH ERROR]:', err);
    return null;
  }
}

async function loadMedicinesFromApi() {
  let loaded = false;
  try {
    const res = await fetch('/api/medicines');
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        MEDICINES = json.data;
        saveMedicinesToStorage();
        loaded = true;
      }
    }
  } catch (e) {}

  if (!loaded) {
    const sbData = await fetchSupabaseMedicinesDirect();
    if (sbData && sbData.length > 0) {
      MEDICINES = sbData;
      saveMedicinesToStorage();
    }
  }

  renderMedicineTable();
  updateDashStats();
}

async function loadStatsFromApi() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();
    if (json.success && json.data) {
      const stats = json.data;
      const statEl = document.getElementById('pending-count');
      if (statEl) statEl.textContent = stats.prescriptions.pending;

      const stockEl = document.getElementById('total-stock-count');
      if (stockEl && stats.inventory && stats.inventory.totalStockUnits !== undefined) {
        stockEl.textContent = Number(stats.inventory.totalStockUnits).toLocaleString();
      }

      const soldEl = document.getElementById('total-sold-count');
      if (soldEl && stats.inventory && stats.inventory.totalSoldUnits !== undefined) {
        soldEl.textContent = Number(stats.inventory.totalSoldUnits).toLocaleString();
      }

      const revEl = document.getElementById('today-revenue-count');
      if (revEl && stats.orders && stats.orders.todayRevenue !== undefined) {
        revEl.textContent = '₹' + Number(stats.orders.todayRevenue).toLocaleString();
      }
    }
  } catch (e) {}
  updateDashStats();
}

// ===== STATS =====
function updateDashStats() {
  const pendingStatEl = document.getElementById('pending-count');
  const pendingBadgeEl = document.getElementById('pending-badge');
  const rxTabCount = document.getElementById('dash-rx-tab-count');
  const orderTabCount = document.getElementById('dash-orders-tab-count');
  const stockEl = document.getElementById('total-stock-count');
  const soldEl = document.getElementById('total-sold-count');

  if (pendingStatEl) pendingStatEl.textContent = PRESCRIPTIONS.length;
  if (pendingBadgeEl) pendingBadgeEl.textContent = `${PRESCRIPTIONS.length} pending`;
  if (rxTabCount) rxTabCount.textContent = PRESCRIPTIONS.length;
  if (orderTabCount) orderTabCount.textContent = chemistOrders.length;

  if (stockEl && Array.isArray(MEDICINES) && MEDICINES.length > 0) {
    const totalStock = MEDICINES.reduce((sum, m) => sum + (parseInt(m.stock) || 0), 0);
    stockEl.textContent = totalStock.toLocaleString();
  }
  if (soldEl && Array.isArray(MEDICINES) && MEDICINES.length > 0) {
    const totalSold = MEDICINES.reduce((sum, m) => sum + (parseInt(m.sold) || 0), 0);
    soldEl.textContent = totalSold.toLocaleString();
  }
}

// ===== PRESCRIPTION LIST =====
function renderPrescriptionList() {
  const container = document.getElementById('prescription-list');
  const completedContainer = document.getElementById('completed-list');
  if (!container) return;

  if (PRESCRIPTIONS.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:32px 0;text-align:center">
        <span class="empty-icon" style="font-size:32px">📋</span>
        <div class="empty-title" style="font-weight:700;margin-top:6px">All caught up!</div>
        <div class="empty-desc" style="font-size:0.85rem;color:var(--text-muted)">No pending prescriptions at this time.</div>
      </div>
    `;
  } else {
    container.innerHTML = PRESCRIPTIONS.map(p => renderPrescriptionCard(p)).join('');
  }

  if (completedContainer) {
    if (completedPrescriptions.length === 0) {
      completedContainer.innerHTML = `<p style="font-size:0.85rem;color:var(--text-light);padding:12px 0">No completed prescriptions yet.</p>`;
    } else {
      completedContainer.innerHTML = completedPrescriptions.map(p => `
        <div class="prescription-card" style="opacity:0.8;background:#f8fdf9;border-color:#D1FAE5;margin-bottom:8px">
          <div class="patient-avatar" style="background:${p.color || '#10B981'}">${p.initials || 'PT'}</div>
          <div class="prescription-info">
            <div class="patient-name">${p.patient}</div>
            <div class="prescription-meta">
              <span>${p.time || ''}</span>
              <span class="status-badge status-done">✅ Billed & Done</span>
            </div>
          </div>
        </div>
      `).join('');
    }
  }
  renderDirectOrdersQueue();
}

function renderPrescriptionCard(p) {
  const sourceBadgeClass = p.source === 'WhatsApp' ? 'badge-green' : 'badge-blue';
  const statusClass = p.status === 'Pending' ? 'status-pending' : 'status-review';
  const rawFileUrl = p.fileUrl || p.fileurl || '';
  const fileName = p.fileName || p.filename || '';
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const viewUrl = p.id ? `/api/prescriptions/${p.id}/file` : (rawFileUrl.includes('undefined') ? 'images/med_fever_pain.png' : rawFileUrl);
  const thumbUrl = (rawFileUrl && !rawFileUrl.includes('undefined')) ? rawFileUrl : (p.id ? `/api/prescriptions/${p.id}/file` : 'images/med_fever_pain.png');

  return `
    <div class="prescription-card" id="rx-card-${p.id}" onclick="openBillBuilder(${p.id})">
      <div class="patient-avatar" style="background:${p.color || '#7C3AED'}">${p.initials || 'PT'}</div>
      <div class="prescription-info" style="flex:1;min-width:0">
        <div class="patient-name">${p.patient}</div>
        <div class="prescription-meta">
          <span style="font-size:0.75rem;color:var(--text-muted)">📞 ${p.phone || 'N/A'}</span>
          <span class="badge ${sourceBadgeClass}" style="font-size:0.65rem">${p.source}</span>
          <span class="status-badge ${statusClass}">${p.status}</span>
        </div>
        <div class="prescription-meta" style="margin-top:3px;gap:8px">
          <span style="font-size:0.73rem;color:var(--text-muted)">🕐 ${p.time || ''}</span>
          ${p.notes ? `<span style="font-size:0.72rem;color:var(--text-muted);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px" title="${p.notes}">📝 ${p.notes}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
        <div style="display:flex;align-items:center;gap:6px">
          ${!isPdf ? `<img src="${thumbUrl}" alt="Rx" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex-shrink:0" onerror="this.src='/api/prescriptions/${p.id}/file'">` : `<span style="font-size:1.4rem" title="${fileName}">📄</span>`}
          <a href="${viewUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="btn btn-sm btn-secondary" style="font-size:0.7rem;padding:3px 8px">👁 View Rx</a>
        </div>
        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openBillBuilder(${p.id})" style="flex-shrink:0">Review &amp; Bill →</button>
      </div>
    </div>
  `;
}

// ===== CUSTOMER ORDERS MANAGEMENT (Chemist View) =====
function filterDashOrders(filter, btn) {
  activeChemistOrderFilter = filter;
  document.querySelectorAll('.order-dash-filter').forEach(b => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-secondary');
  });
  if (btn) {
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
  }
  applyChemistOrderFilter();
}

function applyChemistOrderFilter() {
  if (activeChemistOrderFilter === 'all') {
    filteredChemistOrders = [...chemistOrders];
  } else if (activeChemistOrderFilter === 'active') {
    filteredChemistOrders = chemistOrders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
  } else if (activeChemistOrderFilter === 'delivered') {
    filteredChemistOrders = chemistOrders.filter(o => o.status === 'delivered');
  }
  renderChemistOrders();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toggleOrderCollapse(orderId) {
  const collapseRow = document.getElementById(`order-collapse-${orderId}`);
  const chevron = document.getElementById(`expand-chevron-${orderId}`);
  const mainRow = document.getElementById(`order-row-${orderId}`);
  if (!collapseRow) return;

  const isHidden = collapseRow.style.display === 'none' || !collapseRow.style.display;
  collapseRow.style.display = isHidden ? 'table-row' : 'none';
  if (chevron) {
    chevron.textContent = isHidden ? '▾' : '▸';
    chevron.style.color = isHidden ? 'var(--primary-green)' : 'var(--text-muted)';
  }
  if (mainRow) {
    mainRow.style.backgroundColor = isHidden ? '#F0FDF4' : '';
  }
}

function renderChemistOrders() {
  const container = document.getElementById('dash-orders-table-container');
  if (!container) return;

  if (filteredChemistOrders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:28px;color:var(--text-muted);font-size:0.875rem">
        📦 No orders found in this view.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
        <thead>
          <tr style="background:#F8FAFC;border-bottom:1px solid var(--border);text-align:left">
            <th style="padding:10px 12px;width:125px">Order ID</th>
            <th style="padding:10px 12px">Customer</th>
            <th style="padding:10px 12px;width:120px">Items</th>
            <th style="padding:10px 12px;width:95px">Total</th>
            <th style="padding:10px 12px;width:110px">Status</th>
            <th style="padding:10px 12px;text-align:right;width:180px">Change Stage &amp; Bill</th>
          </tr>
        </thead>
        <tbody>
          ${filteredChemistOrders.map(order => {
            const isDelivered = order.status === 'delivered';
            const isDelivery = order.status === 'delivery';

            let items = order.items;
            if (typeof items === 'string') {
              try {
                items = JSON.parse(items);
                if (typeof items === 'string') items = JSON.parse(items);
              } catch(e) { items = []; }
            }
            items = Array.isArray(items) ? items : [];

            const rawPhone = order.phone || '';
            const cleanPhone = rawPhone.replace(/[^0-9]/g, '').slice(-10);

            return `
              <!-- Compact Main Row (Click to expand/collapse inline) -->
              <tr id="order-row-${order.id}" class="dash-order-row" onclick="toggleOrderCollapse('${order.id}')" style="border-bottom:1px solid #F1F5F9;cursor:pointer" title="Click to view medicines &amp; bill">
                <td style="padding:10px 12px;vertical-align:middle">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span id="expand-chevron-${order.id}" style="color:var(--text-muted);font-size:0.8rem;transition:all 0.15s ease">▸</span>
                    <div>
                      <div style="font-weight:800;color:var(--primary-green);font-size:0.86rem">${order.id}</div>
                      <div style="color:var(--text-muted);font-size:0.7rem;margin-top:1px">${order.placed || ''} · ${order.date || 'Today'}</div>
                    </div>
                  </div>
                </td>

                <td style="padding:10px 12px;vertical-align:middle">
                  <div style="font-weight:700;color:var(--text-dark)">${escapeHtml(order.customerName || 'Customer')}</div>
                  <div style="color:var(--text-muted);font-size:0.75rem">📞 ${escapeHtml(order.phone || '')}</div>
                </td>

                <!-- Compact Items Badge (Clickable) -->
                <td style="padding:10px 12px;vertical-align:middle">
                  <span class="badge badge-blue" style="font-size:0.74rem;padding:3px 8px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
                    💊 ${items.length} item${items.length === 1 ? '' : 's'} <span style="font-size:0.65rem">▾</span>
                  </span>
                </td>

                <td style="padding:10px 12px;vertical-align:middle;white-space:nowrap">
                  <div style="font-weight:800;font-size:0.92rem;color:var(--text-dark)">₹${order.total || order.subtotal || 0}</div>
                  <div style="font-size:0.7rem;color:var(--text-muted)">${order.paymentMethod || 'UPI'}</div>
                </td>

                <td style="padding:10px 12px;vertical-align:middle;white-space:nowrap">
                  <span class="badge ${isDelivered ? 'badge-green' : (isDelivery ? 'badge-blue' : 'badge-saffron')}" style="font-size:0.7rem;font-weight:700">
                    ${order.status.toUpperCase()}
                  </span>
                </td>

                <td style="padding:10px 12px;vertical-align:middle;text-align:right" onclick="event.stopPropagation()">
                  <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
                    <button class="btn btn-sm btn-primary" onclick="openOrderDetailsModal('${order.id}')" style="font-size:0.74rem;padding:4px 9px;font-weight:700;display:inline-flex;align-items:center;gap:4px;white-space:nowrap" title="Click to view medicines &amp; generate bill">
                      👁️ View &amp; Bill
                    </button>
                    <select onchange="updateChemistOrderStatus('${order.id}', this.value)" style="padding:4px 8px;font-size:0.75rem;border-radius:6px;border:1px solid var(--border);background:white;font-weight:600">
                      <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                      <option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>Preparing</option>
                      <option value="delivery" ${order.status === 'delivery' ? 'selected' : ''}>Out for Delivery 🛵</option>
                      <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered ✅</option>
                    </select>
                  </div>
                </td>
              </tr>

              <!-- Collapsible Inline Drawer Row (Revealed on click) -->
              <tr id="order-collapse-${order.id}" style="display:none;background:#F8FAFC;border-bottom:2px solid #E2E8F0">
                <td colspan="6" style="padding:12px 14px">
                  <div style="background:white;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:1px solid #F1F5F9;padding-bottom:8px;flex-wrap:wrap;gap:8px">
                      <div style="display:flex;align-items:center;gap:8px">
                        <span style="font-weight:800;font-size:0.86rem;color:#0F172A">
                          💊 Medicines Needed (${items.length} item${items.length === 1 ? '' : 's'}) — #${order.id}
                        </span>
                        <span class="badge ${order.prescriptionId ? 'badge-blue' : 'badge-saffron'}" style="font-size:0.65rem">
                          ${order.prescriptionId ? 'Prescription Order' : 'Direct Order'}
                        </span>
                      </div>
                      <div style="display:flex;gap:6px;align-items:center">
                        <button class="btn btn-sm btn-primary" onclick="loadOrderIntoBillBuilder('${order.id}')" style="font-size:0.72rem;padding:4px 10px;font-weight:700">
                          🧾 Load into Bill Builder
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="printOrderInvoice('${order.id}')" style="font-size:0.72rem;padding:4px 10px">
                          🖨️ Print Invoice
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="openOrderDetailsModal('${order.id}')" style="font-size:0.72rem;padding:4px 10px">
                          👁️ View Full Details
                        </button>
                        <button class="btn btn-sm" onclick="toggleOrderCollapse('${order.id}')" style="font-size:0.72rem;padding:4px 8px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:6px;color:#475569">
                          ▲ Close
                        </button>
                      </div>
                    </div>

                    <div style="overflow-x:auto;margin-bottom:8px">
                      <table style="width:100%;border-collapse:collapse;font-size:0.78rem">
                        <thead>
                          <tr style="background:#F8FAFC;border-bottom:1px solid #E2E8F0;text-align:left;color:#475569">
                            <th style="padding:6px 8px;width:30px">#</th>
                            <th style="padding:6px 8px">Medicine</th>
                            <th style="padding:6px 8px;width:80px">Packing</th>
                            <th style="padding:6px 8px;text-align:center;width:60px">Qty</th>
                            <th style="padding:6px 8px;text-align:right;width:80px">Unit Price</th>
                            <th style="padding:6px 8px;text-align:right;width:85px">Total</th>
                            <th style="padding:6px 8px;text-align:center;width:120px">Stock Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${items.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:12px;color:var(--text-muted)">No medicine items recorded.</td></tr>` : items.map((it, idx) => {
                            const med = MEDICINES.find(m => m.id === it.id) ||
                                        MEDICINES.find(m => m.name && it.name && m.name.toLowerCase() === it.name.toLowerCase());
                            const name = it.name || it.medicineName || 'Medicine';
                            const qty = it.qty || it.quantity || 1;
                            const brand = it.brand || (med ? med.brand : '');
                            const salt = med ? (med.salt || '') : '';
                            const price = it.price || (med ? med.price : 0);
                            const pack = it.packUnit || (med ? med.packUnit : 'strip');
                            const rowTotal = qty * price;

                            let stockBadge = '';
                            if (med) {
                              if (med.stock >= qty) {
                                stockBadge = `<span class="badge badge-green" style="font-size:0.68rem;font-weight:700">✅ In Stock (${med.stock})</span>`;
                              } else if (med.stock > 0) {
                                stockBadge = `<span class="badge badge-saffron" style="font-size:0.68rem;font-weight:700">⚠️ Low (${med.stock})</span>`;
                              } else {
                                stockBadge = `<span class="badge" style="background:#FEE2E2;color:#991B1B;font-size:0.68rem;font-weight:700">❌ Out of Stock</span>`;
                              }
                            } else {
                              stockBadge = `<span class="badge badge-blue" style="font-size:0.68rem">Standard Item</span>`;
                            }

                            return `
                              <tr style="border-bottom:1px solid #F1F5F9">
                                <td style="padding:6px 8px;color:var(--text-muted);font-weight:700">${idx + 1}</td>
                                <td style="padding:6px 8px">
                                  <div style="font-weight:700;color:var(--text-dark)">💊 ${escapeHtml(name)}</div>
                                  ${brand ? `<div style="font-size:0.7rem;color:var(--primary-green);font-weight:600">${escapeHtml(brand)}</div>` : ''}
                                  ${salt ? `<div style="font-size:0.68rem;color:var(--text-muted)">${escapeHtml(salt)}</div>` : ''}
                                </td>
                                <td style="padding:6px 8px;color:var(--text-muted)">${escapeHtml(pack)}</td>
                                <td style="padding:6px 8px;text-align:center">
                                  <span style="background:#EEF2FF;color:#4338CA;font-weight:800;padding:2px 7px;border-radius:5px;font-size:0.78rem">
                                    x ${qty}
                                  </span>
                                </td>
                                <td style="padding:6px 8px;text-align:right;font-weight:600">₹${price}</td>
                                <td style="padding:6px 8px;text-align:right;font-weight:800;color:var(--primary-green)">₹${rowTotal}</td>
                                <td style="padding:6px 8px;text-align:center">${stockBadge}</td>
                              </tr>
                            `;
                          }).join('')}
                        </tbody>
                      </table>
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-top:6px;border-top:1px dashed #E2E8F0;font-size:0.74rem;color:var(--text-muted)">
                      <div>
                        📍 <strong>Delivery Address:</strong> ${escapeHtml(order.deliveryAddress || 'Gondia store customer')} · 
                        👤 <strong>Customer:</strong> ${escapeHtml(order.customerName || 'Customer')} (📞 ${escapeHtml(order.phone || 'N/A')})
                      </div>
                      ${cleanPhone ? `
                        <div style="display:flex;gap:6px">
                          <a href="tel:${cleanPhone}" class="btn btn-sm btn-secondary" style="font-size:0.68rem;padding:2px 7px;text-decoration:none">
                            📞 Call
                          </a>
                          <a href="https://wa.me/91${cleanPhone}?text=Hello%20${encodeURIComponent(order.customerName || 'Customer')},%20this%20is%20Kirti%20Pharma%20regarding%20Order%20%23${order.id}" target="_blank" class="btn btn-sm btn-secondary" style="font-size:0.68rem;padding:2px 7px;text-decoration:none;color:#047857">
                            💬 WhatsApp
                          </a>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function updateChemistOrderStatus(orderId, newStatus) {
  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const json = await res.json();
    if (json.success) {
      const idx = chemistOrders.findIndex(o => o.id === orderId);
      if (idx > -1) {
        chemistOrders[idx] = json.data;
        applyChemistOrderFilter();
      }
      showToast(`Order #${orderId} marked as ${newStatus.toUpperCase()}`, 'success');
    }
  } catch (err) {
    showToast('Failed to update status', 'error');
  }
}

// ===== ORDER DETAILS MODAL & INVOICE BILLING =====
function openOrderDetailsModal(orderId) {
  const order = chemistOrders.find(o => o.id === orderId);
  if (!order) {
    showToast(`Order #${orderId} not found`, 'error');
    return;
  }
  currentModalOrder = order;

  // Header
  const titleEl = document.getElementById('order-detail-title');
  if (titleEl) titleEl.textContent = `Order #${order.id}`;

  const statusBadge = document.getElementById('order-detail-status-badge');
  if (statusBadge) {
    const isDelivered = order.status === 'delivered';
    const isDelivery = order.status === 'delivery';
    statusBadge.className = `badge ${isDelivered ? 'badge-green' : (isDelivery ? 'badge-blue' : 'badge-saffron')}`;
    statusBadge.textContent = (order.status || 'PREPARING').toUpperCase();
  }

  const payBadge = document.getElementById('order-detail-pay-badge');
  if (payBadge) {
    payBadge.textContent = `${order.paymentMethod || 'UPI'} · ${order.paymentStatus || 'Paid'}`;
  }

  // Customer Card
  const nameEl = document.getElementById('od-customer-name');
  if (nameEl) nameEl.textContent = order.customerName || 'Kirti Customer';

  const phoneEl = document.getElementById('od-customer-phone');
  if (phoneEl) phoneEl.textContent = `📞 ${order.phone || 'N/A'}`;

  const callBtn = document.getElementById('od-call-btn');
  if (callBtn) callBtn.href = `tel:${order.phone || '+919876543210'}`;

  const waBtn = document.getElementById('od-wa-btn');
  if (waBtn) {
    const cleanDigits = (order.phone || '9876543210').replace(/[^0-9]/g, '').slice(-10);
    waBtn.href = `https://wa.me/91${cleanDigits}?text=${encodeURIComponent(`Hello ${order.customerName || ''}, this is Kirti Pharma Gondia regarding your order #${order.id}.`)}`;
  }

  const notesWrap = document.getElementById('od-notes-wrap');
  const notesText = document.getElementById('od-notes-text');
  if (notesWrap && notesText) {
    if (order.notes) {
      notesText.textContent = order.notes;
      notesWrap.style.display = 'block';
    } else {
      notesWrap.style.display = 'none';
    }
  }

  const addrEl = document.getElementById('od-address');
  if (addrEl) addrEl.textContent = `📍 ${order.deliveryAddress || 'Gondia Store Delivery'}`;

  const timeEl = document.getElementById('od-time-info');
  if (timeEl) timeEl.textContent = `Placed: ${order.date || 'Today'} · ${order.placed || ''}`;

  const rxWrap = document.getElementById('od-prescription-wrap');
  const rxLink = document.getElementById('od-rx-link');
  if (rxWrap && rxLink) {
    if (order.prescriptionId) {
      rxLink.href = `/api/prescriptions/${order.prescriptionId}/file`;
      rxWrap.style.display = 'block';
    } else {
      rxWrap.style.display = 'none';
    }
  }

  // Parse items
  let items = order.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  items = Array.isArray(items) ? items : [];

  const countBadge = document.getElementById('od-item-count');
  if (countBadge) countBadge.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

  // Render Medicines Needed Table
  const tbody = document.getElementById('od-medicines-tbody');
  if (tbody) {
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">No medicine items found in this order.</td></tr>`;
    } else {
      tbody.innerHTML = items.map((item, idx) => {
        const med = MEDICINES.find(m => m.id === item.id) ||
                    MEDICINES.find(m => m.name && item.name && m.name.toLowerCase() === item.name.toLowerCase());
        const qty = item.qty || 1;
        const unitPrice = item.price || (med ? med.price : 0);
        const rowTotal = qty * unitPrice;
        const salt = med ? (med.salt || '') : '';
        const brand = item.brand || (med ? med.brand : '');
        const pack = item.packUnit || (med ? med.packUnit : 'strip');

        let stockBadge = '';
        if (med) {
          if (med.stock >= qty) {
            stockBadge = `<span class="badge badge-green" style="font-size:0.7rem;font-weight:700">✅ In Stock (${med.stock})</span>`;
          } else if (med.stock > 0) {
            stockBadge = `<span class="badge badge-saffron" style="font-size:0.7rem;font-weight:700">⚠️ Low (${med.stock})</span>`;
          } else {
            stockBadge = `<span class="badge" style="background:#FEE2E2;color:#991B1B;font-size:0.7rem;font-weight:700">❌ Out of Stock</span>`;
          }
        } else {
          stockBadge = `<span class="badge badge-blue" style="font-size:0.7rem">Prescribed Item</span>`;
        }

        return `
          <tr style="border-bottom:1px solid #F1F5F9">
            <td style="padding:10px 12px;font-weight:700;color:var(--text-muted)">${idx + 1}</td>
            <td style="padding:10px 12px">
              <div style="font-weight:700;color:var(--text-dark);font-size:0.86rem">${escapeHtml(item.name)}</div>
              ${salt ? `<div style="font-size:0.72rem;color:var(--text-muted)">Salt: ${escapeHtml(salt)}</div>` : ''}
              ${brand ? `<div style="font-size:0.72rem;color:var(--primary-green);font-weight:600">Brand: ${escapeHtml(brand)}</div>` : ''}
            </td>
            <td style="padding:10px 12px;color:var(--text-muted);font-size:0.78rem">${escapeHtml(pack)}</td>
            <td style="padding:10px 12px;text-align:center">
              <span style="background:#EEF2FF;color:#4338CA;padding:4px 10px;border-radius:6px;font-weight:800;font-size:0.85rem">
                x ${qty}
              </span>
            </td>
            <td style="padding:10px 12px;text-align:right;font-weight:600">₹${unitPrice}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:800;color:var(--primary-green)">₹${rowTotal}</td>
            <td style="padding:10px 12px;text-align:center">${stockBadge}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // Financial Breakdown
  const subtotal = order.subtotal || items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
  const delivery = order.deliveryFee ?? (subtotal >= 499 ? 0 : 30);
  const total = order.total || (subtotal + delivery);

  const subtotalEl = document.getElementById('od-subtotal');
  if (subtotalEl) subtotalEl.textContent = `₹${subtotal}`;

  const deliveryEl = document.getElementById('od-delivery');
  if (deliveryEl) deliveryEl.textContent = delivery === 0 ? 'FREE' : `₹${delivery}`;

  const grandEl = document.getElementById('od-grand-total');
  if (grandEl) grandEl.textContent = `₹${total}`;

  const payModeEl = document.getElementById('od-pay-mode');
  if (payModeEl) payModeEl.textContent = `${order.paymentMethod || 'UPI'} (${order.paymentStatus || 'Paid'})`;

  // Stage selector
  const stageSelect = document.getElementById('od-stage-select');
  if (stageSelect) stageSelect.value = order.status || 'preparing';

  openModal('order-detail-modal');
}

async function updateModalOrderStatus() {
  if (!currentModalOrder) return;
  const stageSelect = document.getElementById('od-stage-select');
  if (!stageSelect) return;
  const newStatus = stageSelect.value;
  await updateChemistOrderStatus(currentModalOrder.id, newStatus);
  currentModalOrder.status = newStatus;
  const statusBadge = document.getElementById('order-detail-status-badge');
  if (statusBadge) {
    statusBadge.textContent = newStatus.toUpperCase();
    const isDelivered = newStatus === 'delivered';
    const isDelivery = newStatus === 'delivery';
    statusBadge.className = `badge ${isDelivered ? 'badge-green' : (isDelivery ? 'badge-blue' : 'badge-saffron')}`;
  }
}

function loadOrderIntoBillBuilderFromModal() {
  if (!currentModalOrder) return;
  loadOrderIntoBillBuilder(currentModalOrder.id);
  closeModal('order-detail-modal');
}

function loadOrderIntoBillBuilder(orderId) {
  const order = chemistOrders.find(o => o.id === orderId);
  if (!order) return;

  currentBillingOrder = order;
  currentPrescription = null;

  let items = order.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  items = Array.isArray(items) ? items : [];

  billRows = items.map(item => {
    const med = MEDICINES.find(m => m.id === item.id) ||
                MEDICINES.find(m => m.name && item.name && m.name.toLowerCase() === item.name.toLowerCase());
    return {
      medicineId: med ? med.id : (MEDICINES[0] ? MEDICINES[0].id : item.id),
      name: item.name,
      qty: item.qty || 1,
      unitPrice: item.price || (med ? med.price : 0)
    };
  });

  const section = document.getElementById('bill-builder-section');
  if (section) {
    section.style.display = 'block';
    section.style.opacity = '1';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  renderBillBuilder(currentBillingOrder);
  showToast(`📋 Order #${order.id} loaded into Bill Builder. You can now adjust medicines or print bill!`, 'success', 4000);
}

function printModalOrderInvoice() {
  if (!currentModalOrder) return;
  printOrderInvoice(currentModalOrder.id);
}

function printOrderInvoice(orderId, customRows = null) {
  const order = chemistOrders.find(o => o.id === orderId) || currentModalOrder || currentBillingOrder;
  if (!order) {
    showToast('Order not found', 'error');
    return;
  }

  let items = [];
  if (customRows && customRows.length > 0) {
    items = customRows.map(r => {
      const med = MEDICINES.find(m => m.id === r.medicineId);
      return {
        name: med ? med.name : (r.name || 'Medicine'),
        brand: med ? med.brand : '',
        salt: med ? med.salt : '',
        packUnit: med ? med.packUnit : 'strip',
        qty: r.qty,
        price: r.unitPrice
      };
    });
  } else {
    items = order.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch(e) { items = []; }
    }
    items = Array.isArray(items) ? items : [];
  }

  const subtotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);
  const delivery = order.deliveryFee ?? (subtotal >= 499 ? 0 : 30);
  const grandTotal = subtotal + delivery;
  const cgst = (subtotal * 0.06).toFixed(2);
  const sgst = (subtotal * 0.06).toFixed(2);

  const container = document.getElementById('printable-invoice-container');
  if (!container) return;

  container.innerHTML = `
    <!-- PHARMACY HEADER -->
    <div style="border-bottom:2px solid #059669;padding-bottom:14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.8rem">🌿</span>
          <div>
            <h1 style="margin:0;font-size:1.45rem;font-weight:900;color:#047857;letter-spacing:0.5px">KIRTI PHARMA &amp; SURGICALS</h1>
            <div style="font-size:0.75rem;color:#4B5563;font-weight:600">RETAIL CHEMIST, DRUGGIST &amp; SURGICAL SUPPLIERS</div>
          </div>
        </div>
        <div style="font-size:0.75rem;color:#4B5563;margin-top:6px;line-height:1.4">
          Main Bazar, Near City Bus Stand, Ring Road, Gondia - 441614 (Maharashtra)<br>
          📞 Phone: +91 98765 43210 &nbsp;|&nbsp; ✉️ care@kirtipharma.com
        </div>
      </div>
      <div style="text-align:right">
        <div style="display:inline-block;background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;font-weight:800;font-size:0.85rem;padding:4px 12px;border-radius:6px">
          TAX INVOICE / CASH MEMO
        </div>
        <div style="font-size:0.72rem;color:#4B5563;margin-top:6px">
          <strong>D.L. No:</strong> MH-GON-2024-00129 / 130<br>
          <strong>GSTIN:</strong> 27AABCK1234F1Z5
        </div>
      </div>
    </div>

    <!-- INVOICE METADATA & CUSTOMER INFO -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:0.8rem">
      <div>
        <div style="color:#64748B;font-size:0.7rem;text-transform:uppercase;font-weight:700">Billed To (Customer / Patient)</div>
        <div style="font-size:0.95rem;font-weight:800;color:#0F172A;margin-top:2px">${escapeHtml(order.customerName || 'Customer')}</div>
        <div style="color:#334155;margin-top:2px">📞 Mobile: <strong>${escapeHtml(order.phone || 'N/A')}</strong></div>
        <div style="color:#475569;margin-top:2px;line-height:1.3">📍 ${escapeHtml(order.deliveryAddress || 'Gondia Store Delivery')}</div>
      </div>
      <div style="text-align:right">
        <div style="color:#64748B;font-size:0.7rem;text-transform:uppercase;font-weight:700">Invoice Details</div>
        <div style="font-size:0.95rem;font-weight:800;color:#047857;margin-top:2px">INV-${escapeHtml(order.id)}</div>
        <div style="color:#334155;margin-top:2px">Date: <strong>${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></div>
        <div style="color:#334155;margin-top:2px">Payment: <strong>${escapeHtml(order.paymentMethod || 'UPI')} (${escapeHtml(order.paymentStatus || 'Paid')})</strong></div>
        ${order.prescriptionId ? `<div style="color:#2563EB;font-weight:600;margin-top:2px">Rx Ref: #${order.prescriptionId}</div>` : ''}
      </div>
    </div>

    <!-- MEDICINES TABLE -->
    <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:16px">
      <thead>
        <tr style="background:#047857;color:white;text-align:left">
          <th style="padding:8px 10px;width:35px">#</th>
          <th style="padding:8px 10px">Description of Medicine</th>
          <th style="padding:8px 10px">Mfg/Brand</th>
          <th style="padding:8px 10px;text-align:center">Pack</th>
          <th style="padding:8px 10px;text-align:center">Qty</th>
          <th style="padding:8px 10px;text-align:right">Rate (₹)</th>
          <th style="padding:8px 10px;text-align:right">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((it, idx) => {
          const qty = it.qty || 1;
          const rate = Number(it.price) || 0;
          const amt = (qty * rate).toFixed(2);
          return `
            <tr style="border-bottom:1px solid #E2E8F0;background:${idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'}">
              <td style="padding:8px 10px;color:#64748B">${idx + 1}</td>
              <td style="padding:8px 10px;font-weight:700;color:#0F172A">
                ${escapeHtml(it.name)}
                ${it.salt ? `<div style="font-size:0.7rem;color:#64748B;font-weight:normal">${escapeHtml(it.salt)}</div>` : ''}
              </td>
              <td style="padding:8px 10px;color:#475569">${escapeHtml(it.brand || 'Generic')}</td>
              <td style="padding:8px 10px;text-align:center;color:#475569">${escapeHtml(it.packUnit || 'strip')}</td>
              <td style="padding:8px 10px;text-align:center;font-weight:700">${qty}</td>
              <td style="padding:8px 10px;text-align:right">₹${rate.toFixed(2)}</td>
              <td style="padding:8px 10px;text-align:right;font-weight:700">₹${amt}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>

    <!-- TOTALS & TAX BREAKDOWN -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;border-top:1px solid #CBD5E1;padding-top:12px;margin-bottom:20px">
      <div style="font-size:0.75rem;color:#475569;max-width:380px;line-height:1.4">
        <strong>GST Breakdown:</strong> Includes CGST (6%) ₹${cgst} &amp; SGST (6%) ₹${sgst}.<br>
        <strong>Terms &amp; Conditions:</strong><br>
        1. Please consult doctor before taking prescribed dosage.<br>
        2. Medicines once sold cannot be returned without original cash memo within 7 days.<br>
        3. Store all medications in a cool and dry place away from direct sunlight.
      </div>
      <div style="min-width:240px;text-align:right;font-size:0.82rem">
        <div style="display:flex;justify-content:space-between;padding:3px 0;color:#475569">
          <span>Items Subtotal:</span>
          <strong>₹${subtotal.toFixed(2)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:3px 0;color:#475569">
          <span>Delivery / Handling:</span>
          <strong>${delivery === 0 ? 'FREE' : `₹${delivery.toFixed(2)}`}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;margin-top:4px;border-top:2px solid #047857;font-size:1.1rem;font-weight:900;color:#047857">
          <span>NET PAYABLE:</span>
          <span>₹${grandTotal.toFixed(2)}</span>
        </div>
      </div>
    </div>

    <!-- SIGNATURE & PHARMACIST AUTH -->
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:28px;padding-top:16px;border-top:1px dashed #CBD5E1">
      <div style="font-size:0.72rem;color:#64748B">
        Verified &amp; Dispensed by: <strong>Kirti Registered Pharmacist</strong><br>
        Reg No: <strong>R-PH-MH-55241</strong> · Gondia Central Pharmacy
      </div>
      <div style="text-align:center">
        <div style="font-weight:700;font-size:0.8rem;color:#1E293B">For KIRTI PHARMA &amp; SURGICALS</div>
        <div style="height:32px"></div>
        <div style="border-top:1px solid #475569;padding-top:4px;font-size:0.72rem;color:#475569;font-weight:600">
          Authorized Pharmacist Signature
        </div>
      </div>
    </div>
  `;

  openModal('invoice-modal');
}

// ===== DASHBOARD SEARCH =====
function initDashboardSearch() {
  const input = document.getElementById('dash-search');
  if (!input) return;
  let timer;
  input.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      dashTableSearch = e.target.value;
      currentPage = 1;
      renderMedicineTable();
    }, 250);
  });
}

// ===== MEDICINE TABLE =====
function getFilteredMedicines() {
  if (!dashTableSearch.trim()) return MEDICINES;
  const q = dashTableSearch.toLowerCase();
  return MEDICINES.filter(m =>
    m.name.toLowerCase().includes(q) ||
    m.salt.toLowerCase().includes(q) ||
    m.brand.toLowerCase().includes(q) ||
    m.category.toLowerCase().includes(q)
  );
}

function renderMedicineTable() {
  const tbody = document.getElementById('medicine-table-body');
  const paginationEl = document.getElementById('table-pagination');
  if (!tbody) return;

  const filtered = getFilteredMedicines();
  const total = filtered.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const countEl = document.getElementById('table-count');
  if (countEl) countEl.textContent = `${total} medicines in store`;

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)">No medicines match your search.</td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(m => {
      const stockNum = parseInt(m.stock) || 0;
      const soldNum = parseInt(m.sold) || 0;
      const inStock = stockNum > 0;
      const isLowStock = stockNum > 0 && stockNum <= 15;
      const imgSrc = m.image || (typeof CAT_IMAGES !== 'undefined' ? CAT_IMAGES[m.category] : null) || 'images/med_fever_pain.png';
      const salesRev = soldNum * (m.price || 0);

      const statusColor = !inStock ? '#DC2626' : (isLowStock ? '#D97706' : '#166534');
      const statusBg = !inStock ? '#FEE2E2' : (isLowStock ? '#FEF3C7' : '#DCFCE7');

      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <img src="${imgSrc}" alt="${m.name}" style="width:36px;height:36px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0">
              <div>
                <div style="font-weight:600;font-size:0.82rem">${m.name}</div>
                ${m.prescription_required ? '<span class="badge badge-rx" style="font-size:0.6rem">Rx</span>' : ''}
              </div>
            </div>
          </td>
          <td style="font-size:0.78rem;color:var(--text-muted);max-width:180px">${m.salt}</td>
          <td style="font-size:0.8rem;font-weight:500">${m.brand}</td>
          <td>
            <div style="display:flex;flex-direction:column;gap:3px">
              <span style="display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:0.82rem;color:${statusColor};background:${statusBg};padding:3px 8px;border-radius:6px;width:fit-content">
                <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};display:inline-block"></span>
                ${inStock ? stockNum + ' in stock' : 'Out of stock'}
              </span>
              <span style="font-size:0.7rem;color:var(--text-muted)">
                ${!inStock ? '⚠️ Restock required' : (isLowStock ? 'Low inventory alert' : 'Healthy inventory')}
              </span>
            </div>
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-weight:700;font-size:0.82rem;color:#1E293B">
                🔥 ${soldNum} sold
              </span>
              <span style="font-size:0.72rem;color:#166534;font-weight:600">
                ₹${salesRev.toLocaleString()} sales
              </span>
            </div>
          </td>
          <td style="font-size:0.8rem;color:var(--text-muted)">${m.packSize} ${m.packUnit}</td>
          <td style="font-weight:700;font-size:0.875rem">₹${m.price}</td>
          <td>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn btn-sm btn-secondary" onclick="addToBill(${m.id})" ${!inStock ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
                + Bill
              </button>
              <button class="btn btn-sm" onclick="removeMedicine(${m.id})" style="color:var(--danger);background:var(--danger-light);border:none;padding:6px 8px;border-radius:6px;cursor:pointer" title="Remove from inventory">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Pagination
  if (paginationEl) {
    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
    } else {
      let pagHTML = '';
      pagHTML += `<button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
      for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
          pagHTML += `<button class="page-btn${i === currentPage ? ' active' : ''}" onclick="goToPage(${i})">${i}</button>`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
          pagHTML += `<span style="padding:0 4px;color:var(--text-light)">…</span>`;
        }
      }
      pagHTML += `<button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
      paginationEl.innerHTML = pagHTML;
    }
  }
}

function goToPage(page) {
  const total = Math.ceil(getFilteredMedicines().length / PAGE_SIZE);
  if (page < 1 || page > total) return;
  currentPage = page;
  renderMedicineTable();
}

async function removeMedicine(id) {
  const idx = MEDICINES.findIndex(m => m.id === id);
  if (idx === -1) return;
  const medName = MEDICINES[idx].name;

  if (confirm(`Are you sure you want to remove ${medName} from the store inventory and Supabase database?`)) {
    let deleted = false;
    try {
      const res = await fetch(`/api/medicines/${id}`, { method: 'DELETE' });
      if (res.ok) deleted = true;
    } catch (e) {}

    if (!deleted) {
      try {
        await fetch(`${SUPABASE_API_URL}/rest/v1/medicines?id=eq.${id}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
      } catch (e) {}
    }

    MEDICINES.splice(idx, 1);
    saveMedicinesToStorage();
    renderMedicineTable();
    updateDashStats();
    showToast(`🗑️ ${medName} removed from Supabase Cloud`, 'success');
  }
}

// ===== BILL BUILDER =====
function addToBill(medicineId) {
  const med = MEDICINES.find(m => m.id === medicineId);
  if (!med) return;
  billRows.push({ medicineId, qty: 1, unitPrice: med.price });
  if (currentPrescription) {
    renderBillBuilder(currentPrescription);
  } else if (currentBillingOrder) {
    renderBillBuilder(currentBillingOrder);
  } else {
    showToast(`${med.name} queued for next bill`, 'info');
  }
  showToast(`${med.name} added to bill`, 'success');
}

function openBillBuilder(prescriptionId) {
  currentBillingOrder = null;
  currentPrescription = PRESCRIPTIONS.find(p => p.id === prescriptionId) ||
    completedPrescriptions.find(p => p.id === prescriptionId);
  if (!currentPrescription) return;

  // Mark as In Review on server
  fetch(`/api/prescriptions/${prescriptionId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'In Review' })
  }).catch(() => {});

  const card = document.getElementById(`rx-card-${prescriptionId}`);
  if (card) {
    const statusEl = card.querySelector('.status-badge');
    if (statusEl) { statusEl.className = 'status-badge status-review'; statusEl.textContent = 'In Review'; }
  }

  const section = document.getElementById('bill-builder-section');
  if (section) {
    section.style.display = 'block';
    section.style.opacity = '1';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  renderBillBuilder(currentPrescription);
}

function renderBillBuilder(target) {
  const current = target || currentPrescription || currentBillingOrder;
  if (!current) return;

  const headerEl = document.getElementById('bill-patient-name');
  const tbody = document.getElementById('bill-table-body');
  const grandTotalEl = document.getElementById('bill-grand-total');

  if (headerEl) {
    headerEl.textContent = current.customerName
      ? `${current.customerName} (Order #${current.id})`
      : (current.patient || 'Customer');
  }

  // ─── Prescription preview panel ────────────────────────────────────────────
  const previewPanel = document.getElementById('rx-preview-panel');
  if (previewPanel) {
    const hasRx = current.prescriptionId || current.fileUrl || current.fileurl;
    if (hasRx) {
      const rxId = current.prescriptionId || current.id;
      const rawFileUrl = current.fileUrl || current.fileurl || '';
      const fileName = current.fileName || current.filename || '';
      const isPdf = fileName.toLowerCase().endsWith('.pdf');
      const viewUrl = rxId ? `/api/prescriptions/${rxId}/file` : (rawFileUrl.includes('undefined') ? 'images/med_fever_pain.png' : rawFileUrl);
      const previewSrc = (rawFileUrl && !rawFileUrl.includes('undefined')) ? rawFileUrl : viewUrl;

      const patEl = document.getElementById('rx-prev-patient');
      if (patEl) patEl.textContent = (current.patient || current.customerName || 'Customer') + ' — ' + (current.source || 'Order Prescription');
      const phEl = document.getElementById('rx-prev-phone');
      if (phEl) phEl.textContent = '📞 ' + (current.phone || 'N/A');
      const notesEl = document.getElementById('rx-prev-notes');
      if (notesEl) notesEl.textContent = current.notes ? ('📝 ' + current.notes) : '';

      const imgEl = document.getElementById('rx-prev-img');
      const pdfEl = document.getElementById('rx-prev-pdf');
      const linkEl = document.getElementById('rx-prev-link');
      const fullLink = document.getElementById('rx-prev-fulllink');

      if (linkEl) linkEl.href = viewUrl;
      if (fullLink) fullLink.href = viewUrl;
      if (imgEl) {
        imgEl.src = previewSrc;
        imgEl.style.display = isPdf ? 'none' : 'block';
        imgEl.onerror = () => { imgEl.src = `/api/prescriptions/${rxId}/file`; };
      }
      if (pdfEl) pdfEl.style.display = isPdf ? 'flex' : 'none';
      previewPanel.style.display = 'block';
    } else {
      previewPanel.style.display = 'none';
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  const grandTotal = billRows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0);
  if (grandTotalEl) grandTotalEl.textContent = `₹${grandTotal.toFixed(0)}`;

  if (!tbody) return;

  if (billRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.875rem">No medicines in bill. Use "+ Bill" to add medicines or select an order/prescription.</td></tr>`;
    return;
  }

  tbody.innerHTML = billRows.map((row, idx) => {
    const med = MEDICINES.find(m => m.id === row.medicineId);
    const total = row.qty * row.unitPrice;
    return `
      <tr>
        <td>
          <select onchange="updateBillMedicine(${idx}, parseInt(this.value))" style="min-width:160px;padding:5px 8px;border-radius:6px;border:1px solid var(--border)">
            ${MEDICINES.map(m =>
              `<option value="${m.id}" ${m.id === row.medicineId ? 'selected' : ''}>${m.name} (${m.brand}) — ₹${m.price}</option>`
            ).join('')}
          </select>
        </td>
        <td>
          <input type="number" min="1" max="20" value="${row.qty}"
            onchange="updateBillQty(${idx}, parseInt(this.value))"
            style="width:64px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;font-weight:700">
        </td>
        <td style="font-weight:600">₹${row.unitPrice}</td>
        <td style="font-weight:800;color:var(--primary-green)">₹${total.toFixed(0)}</td>
        <td>
          <button onclick="removeBillRow(${idx})" class="btn btn-sm" style="color:var(--danger);background:var(--danger-light);padding:4px 8px;border:none;border-radius:6px;cursor:pointer">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function addBillRow() {
  const firstAvailable = MEDICINES.find(m => m.stock > 0) || MEDICINES[0];
  if (!firstAvailable) return;
  billRows.push({ medicineId: firstAvailable.id, qty: 1, unitPrice: firstAvailable.price });
  renderBillBuilder(currentPrescription || currentBillingOrder);
}

function updateBillMedicine(idx, medId) {
  const med = MEDICINES.find(m => m.id === medId);
  if (!med) return;
  billRows[idx].medicineId = medId;
  billRows[idx].unitPrice = med.price;
  renderBillBuilder(currentPrescription || currentBillingOrder);
}

function updateBillQty(idx, qty) {
  if (qty < 1 || isNaN(qty)) qty = 1;
  billRows[idx].qty = Math.min(qty, 20);
  renderBillBuilder(currentPrescription || currentBillingOrder);
}

function removeBillRow(idx) {
  billRows.splice(idx, 1);
  renderBillBuilder(currentPrescription || currentBillingOrder);
}

function printInvoice() {
  if (billRows.length === 0) {
    showToast('Please add medicines to the bill before printing', 'error');
    return;
  }

  if (currentBillingOrder) {
    printOrderInvoice(currentBillingOrder.id, billRows);
    return;
  }

  if (currentPrescription) {
    const rxOrder = {
      id: `RX-${currentPrescription.id}`,
      customerName: currentPrescription.patient,
      phone: currentPrescription.phone,
      deliveryAddress: 'Gondia store customer (Prescription Pick-up)',
      paymentMethod: 'Cash / Counter',
      paymentStatus: 'Pending',
      prescriptionId: currentPrescription.id,
      items: billRows.map(r => {
        const med = MEDICINES.find(m => m.id === r.medicineId);
        return {
          name: med ? med.name : 'Medicine',
          brand: med ? med.brand : '',
          salt: med ? med.salt : '',
          packUnit: med ? med.packUnit : 'strip',
          price: r.unitPrice,
          qty: r.qty
        };
      })
    };
    printOrderInvoice(rxOrder.id, billRows);
    return;
  }

  window.print();
}

async function markAsReady() {
  if (!currentPrescription && !currentBillingOrder) {
    showToast('No active order or prescription selected to mark ready', 'error');
    return;
  }

  if (billRows.length === 0) {
    showToast('Please add medicines to the bill before completing', 'error');
    return;
  }

  // Case 1: Finalizing a live customer order
  if (currentBillingOrder) {
    const orderId = currentBillingOrder.id;
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'delivery' })
      });
      const json = await res.json();
      if (json.success) {
        showToast(`✅ Order #${orderId} billed and marked Out for Delivery! 🛵`, 'success');
      }
    } catch (err) {
      showToast(`✅ Order #${orderId} marked as Ready!`, 'success');
    }

    billRows = [];
    currentBillingOrder = null;
    const section = document.getElementById('bill-builder-section');
    if (section) section.style.display = 'none';
    loadChemistOrdersFromApi();
    return;
  }

  // Case 2: Finalizing a prescription and creating order
  const rxId = currentPrescription.id;
  try {
    const res = await fetch(`/api/prescriptions/${rxId}/bill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        billRows,
        createOrder: true
      })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`✅ Order created and sent to customer!`, 'success');
    }
  } catch (err) {}

  const idx = PRESCRIPTIONS.findIndex(p => p.id === rxId);
  if (idx > -1) {
    const [done] = PRESCRIPTIONS.splice(idx, 1);
    done.status = 'Completed';
    completedPrescriptions.unshift(done);
  }

  // Reset bill
  billRows = [];
  const section = document.getElementById('bill-builder-section');
  if (section) section.style.display = 'none';
  currentPrescription = null;

  renderPrescriptionList();
  updateDashStats();
  loadChemistOrdersFromApi();
}

// ===== DASHBOARD TABS =====
function syncDashPanels() {
  const leftPanel = document.getElementById('dash-left-panel');
  const rightPanel = document.getElementById('dash-right-panel');
  const ordersSection = document.getElementById('dash-orders-section');
  const medSection = document.getElementById('medicine-table-section');
  const custSection = document.getElementById('dash-customers-section');

  if (!leftPanel || !rightPanel) return;

  if (activeDashTab === 'customers') {
    leftPanel.style.display = 'none';
    rightPanel.style.display = 'block';
    if (ordersSection) ordersSection.style.display = 'none';
    if (medSection) medSection.style.display = 'none';
    if (custSection) custSection.style.display = 'block';
    return;
  }

  if (custSection) custSection.style.display = 'none';

  if (window.innerWidth <= 1024) {
    if (activeDashTab === 'prescriptions') {
      leftPanel.style.display = 'block';
      rightPanel.style.display = 'none';
    } else {
      leftPanel.style.display = 'none';
      rightPanel.style.display = 'block';
      if (ordersSection && medSection) {
        ordersSection.style.display = activeDashTab === 'orders' ? 'block' : 'none';
        medSection.style.display = activeDashTab === 'medicines' ? 'block' : 'none';
      }
    }
  } else {
    leftPanel.style.removeProperty('display');
    rightPanel.style.removeProperty('display');
    if (ordersSection && medSection) {
      if (activeDashTab === 'prescriptions') {
        ordersSection.style.display = 'block';
        medSection.style.display = 'block';
      } else if (activeDashTab === 'orders') {
        ordersSection.style.display = 'block';
        medSection.style.display = 'none';
      } else if (activeDashTab === 'medicines') {
        ordersSection.style.display = 'none';
        medSection.style.display = 'block';
      }
    }
  }
}

function initDashTabs() {
  const tabs = document.querySelectorAll('.dash-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      activeDashTab = target;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      syncDashPanels();
    });
  });

  syncDashPanels();
  window.addEventListener('resize', syncDashPanels);
}

// ===== REGISTERED CUSTOMERS (SUPABASE CLOUD) =====
async function loadCustomersFromApi() {
  try {
    const res = await fetch('/api/auth/customers');
    const json = await res.json();
    if (json.success && json.data) {
      renderCustomersTable(json.data);
    }
  } catch (e) {
    console.warn('Failed to load customers from API:', e);
  }
}

function renderCustomersTable(customers) {
  const tbody = document.getElementById('customers-table-body');
  const countEl = document.getElementById('dash-cust-tab-count');
  if (countEl) countEl.textContent = customers.length;
  if (!tbody) return;

  if (!customers || customers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">No registered customers yet in database.</td></tr>`;
    return;
  }

  tbody.innerHTML = customers.map(c => {
    const isUserAdmin = (c.role && String(c.role).toLowerCase() === 'admin');
    return `
      <tr>
        <td style="font-weight:700">👤 ${c.name}</td>
        <td><code>+91 ${c.phone}</code></td>
        <td><span class="badge ${isUserAdmin ? 'badge-saffron' : 'badge-green'}">${isUserAdmin ? 'ADMIN / CHEMIST' : 'CUSTOMER'}</span></td>
        <td style="font-size:0.85rem;color:var(--text-muted)">${c.addresses?.[0]?.text || 'Gondia - 441614'}</td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${c.created_at ? new Date(c.created_at).toLocaleDateString() : 'Active'}</td>
        <td>
          ${isUserAdmin
            ? `<button class="btn btn-sm btn-secondary" onclick="changeUserRole('${c.id}', 'customer')" style="font-size:0.75rem;padding:4px 8px">Remove Admin</button>`
            : `<button class="btn btn-sm btn-primary" onclick="changeUserRole('${c.id}', 'admin')" style="font-size:0.75rem;padding:4px 8px;background:#006642">Tag as Admin</button>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

async function changeUserRole(userId, newRole) {
  try {
    const res = await fetch(`/api/auth/users/${userId}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`User successfully updated to ${newRole.toUpperCase()} in database!`, 'success');
      loadCustomersFromApi();
    } else {
      showToast(data.error || 'Failed to update user role', 'error');
    }
  } catch (err) {
    showToast('Failed to update role in database', 'error');
  }
}

// ===== ADD MEDICINE MODAL =====
let uploadedMedImageBase64 = '';

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

function openAddMedicineModal() {
  const form = document.getElementById('add-med-form');
  if (form) form.reset();
  resetMedImage();
  openModal('add-med-modal');
}

function previewMedImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxDim = 120;
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > maxDim) {
          h = Math.round(h * maxDim / w);
          w = maxDim;
        }
      } else {
        if (h > maxDim) {
          w = Math.round(w * maxDim / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      uploadedMedImageBase64 = canvas.toDataURL('image/jpeg', 0.8);

      document.getElementById('med-preview-thumb').src = uploadedMedImageBase64;
      document.getElementById('med-preview-name').textContent = file.name;
      document.getElementById('med-dz-content').style.display = 'none';
      document.getElementById('med-img-preview').style.display = 'flex';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function resetMedImage() {
  uploadedMedImageBase64 = '';
  const fileInput = document.getElementById('add-med-file');
  if (fileInput) fileInput.value = '';
  const dzContent = document.getElementById('med-dz-content');
  if (dzContent) dzContent.style.display = 'block';
  const imgPreview = document.getElementById('med-img-preview');
  if (imgPreview) imgPreview.style.display = 'none';
}

async function saveNewMedicine(event) {
  event.preventDefault();

  const name = document.getElementById('add-med-name').value.trim();
  const salt = document.getElementById('add-med-salt').value.trim();
  const brand = document.getElementById('add-med-brand').value.trim();
  const category = document.getElementById('add-med-category').value;
  const price = parseFloat(document.getElementById('add-med-price').value);
  const mrp = parseFloat(document.getElementById('add-med-mrp').value);
  const stock = parseInt(document.getElementById('add-med-stock').value);
  const packSize = parseInt(document.getElementById('add-med-pack-size').value);
  const packUnit = document.getElementById('add-med-pack-unit').value;
  const rx = document.getElementById('add-med-rx').checked;
  const chronic = document.getElementById('add-med-chronic').checked;

  if (price > mrp) {
    showToast('Price cannot be greater than MRP', 'error');
    return;
  }

  const saveBtn = event.target.querySelector('button[type="submit"]');
  const origBtnText = saveBtn ? saveBtn.textContent : 'Save Medicine';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving to Supabase...';
  }

  const payload = {
    name,
    salt,
    brand,
    category,
    price,
    mrp,
    stock,
    packSize,
    packUnit,
    prescription_required: rx,
    chronic,
    imageBase64: uploadedMedImageBase64
  };

  let savedMedicine = null;

  // 1. Try local server API first
  try {
    const res = await fetch('/api/medicines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        savedMedicine = json.data;
      }
    }
  } catch (err) {
    console.log('[Kirti Pharma] Backend route not reachable, saving directly to Supabase Cloud...');
  }

  // 2. Direct Supabase Cloud Save (guarantees saving to Supabase Cloud if backend is offline or on port mismatch)
  if (!savedMedicine) {
    try {
      const categoryColors = {
        'Fever & Pain': '#FEE2E2',
        'Antibiotics': '#FEF3C7',
        'Gastro': '#D1FAE5',
        'Chronic Care': '#EDE9FE',
        'Vitamins & Supplements': '#FFF7ED',
        'Skincare': '#FECDD3',
        'Baby Care': '#E0F2FE',
        'ENT': '#F0FDF4'
      };
      const directRow = {
        name,
        salt: salt || null,
        brand: brand || 'Generic',
        category,
        price: parseFloat(price) || 0,
        mrp: parseFloat(mrp) || parseFloat(price) || 0,
        stock: parseInt(stock) || 0,
        sold: 0,
        packsize: parseInt(packSize) || 10,
        packunit: packUnit || 'tablets',
        prescription_required: Boolean(rx),
        chronic: Boolean(chronic),
        imagecolor: categoryColors[category] || '#FEE2E2',
        icon: category === 'Gastro' || category === 'Baby Care' ? '🍶' : '💊',
        image: uploadedMedImageBase64 || (typeof CAT_IMAGES !== 'undefined' ? CAT_IMAGES[category] : 'images/med_fever_pain.png')
      };

      const directRes = await fetch(`${SUPABASE_API_URL}/rest/v1/medicines`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(directRow)
      });

      if (directRes.ok) {
        const directData = await directRes.json();
        if (Array.isArray(directData) && directData.length > 0) {
          const m = directData[0];
          savedMedicine = {
            ...m,
            packSize: m.packsize ?? 10,
            packUnit: m.packunit ?? 'tablets',
            imageColor: m.imagecolor ?? '#FEE2E2',
            image: m.image || 'images/med_fever_pain.png',
            stock: Number(m.stock || 0),
            sold: Number(m.sold || 0),
            price: Number(m.price || 0),
            mrp: Number(m.mrp || 0),
            prescription_required: Boolean(m.prescription_required),
            chronic: Boolean(m.chronic)
          };
        }
      } else {
        const errJson = await directRes.json().catch(() => ({}));
        throw new Error(errJson.message || `Supabase returned HTTP ${directRes.status}`);
      }
    } catch (sbErr) {
      console.error('[SUPABASE DIRECT INSERT ERROR]:', sbErr);
      showToast(`❌ Failed to save to Supabase: ${sbErr.message}`, 'error', 6000);
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = origBtnText;
      }
      return;
    }
  }

  if (savedMedicine) {
    const existingIdx = MEDICINES.findIndex(m => m.id === savedMedicine.id);
    if (existingIdx > -1) {
      MEDICINES[existingIdx] = savedMedicine;
    } else {
      MEDICINES.unshift(savedMedicine);
    }

    saveMedicinesToStorage();
    closeModal('add-med-modal');
    currentPage = 1;
    renderMedicineTable();
    updateDashStats();
    loadStatsFromApi();
    const formEl = document.getElementById('add-med-form');
    if (formEl) formEl.reset();
    resetMedImage();
    showToast(`⚡ ${name} successfully saved & synced to Supabase Cloud! (Stock: ${stock})`, 'success', 5000);
  }

  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = origBtnText;
  }
}
