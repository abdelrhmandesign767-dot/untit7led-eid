// Dashboard client side script
document.addEventListener('DOMContentLoaded', () => {
  // Select DOM Elements
  const statRevenue = document.getElementById('stat-revenue');
  const statVerifiedOrders = document.getElementById('stat-verified-orders');
  const statTotalOrders = document.getElementById('stat-total-orders');
  const statPendingOrders = document.getElementById('stat-pending-orders');
  const statTotalSms = document.getElementById('stat-total-sms');
  const statUnlinkedSms = document.getElementById('stat-unlinked-sms');
  
  const ordersList = document.getElementById('orders-list');
  const smsList = document.getElementById('sms-list');
  const ordersCountBadge = document.getElementById('orders-count-badge');
  const smsCountBadge = document.getElementById('sms-count-badge');
  
  const walletNumberInput = document.getElementById('wallet-number-input');
  const walletSettingsForm = document.getElementById('wallet-settings-form');
  const simulatorForm = document.getElementById('simulator-form');

  // Load Settings and Stats initially
  fetchStats();
  fetchOrders();
  fetchSmsLogs();

  // Setup periodic polling to simulate real-time updates (every 3 seconds)
  setInterval(() => {
    fetchStats();
    fetchOrders();
    fetchSmsLogs();
  }, 3000);

  // Form Submit: Save Wallet Settings
  walletSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const walletNumber = walletNumberInput.value.trim();

    try {
      const response = await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletNumber })
      });
      const data = await response.json();

      if (data.success) {
        showNotification('تم تحديث رقم المحفظة بنجاح!', 'success');
      } else {
        showNotification(data.error || 'حدث خطأ أثناء التحديث', 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('خطأ في الاتصال بالسيرفر', 'error');
    }
  });

  // Form Submit: Simulate SMS Incoming
  simulatorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('sim-amount').value);
    const senderPhone = document.getElementById('sim-phone').value.trim();
    const trxId = document.getElementById('sim-trx').value.trim();

    try {
      const response = await fetch('/api/dashboard/simulate-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, senderPhone, trxId })
      });
      const data = await response.json();

      if (data.success) {
        showNotification('تمت محاكاة الرسالة واستلامها بنجاح!', 'success');
        simulatorForm.reset();
        fetchStats();
        fetchOrders();
        fetchSmsLogs();
      } else {
        showNotification(data.error || 'فشلت عملية المحاكاة', 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('خطأ في الاتصال بالسيرفر', 'error');
    }
  });

  // Fetch Dashboard Stats
  async function fetchStats() {
    try {
      const response = await fetch('/api/dashboard/stats');
      const data = await response.json();
      if (data.success) {
        const s = data.stats;
        statRevenue.textContent = `${s.totalRevenue.toFixed(2)} ج.م`;
        statVerifiedOrders.textContent = s.verifiedOrders;
        statTotalOrders.textContent = `إجمالي الطلبات المستلمة: ${s.totalOrders}`;
        statPendingOrders.textContent = s.pendingOrders;
        statTotalSms.textContent = s.totalSms;
        statUnlinkedSms.textContent = `الرسائل غير المربوطة: ${s.unlinkedSms}`;
        
        // Update input field value if not active
        if (document.activeElement !== walletNumberInput) {
          walletNumberInput.value = s.walletNumber;
        }
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }

  // Fetch and render Orders
  async function fetchOrders() {
    try {
      const response = await fetch('/api/dashboard/orders');
      const data = await response.json();
      
      if (data.success) {
        const orders = data.orders;
        ordersCountBadge.textContent = orders.length;

        if (orders.length === 0) {
          ordersList.innerHTML = `
            <div class="glass-panel" style="padding: 3rem; text-align: center; color: var(--text-secondary);">
              📭 لا توجد طلبات مسجلة بعد. قم بزيارة صفحة الدفع لإجراء طلب تجريبي!
            </div>
          `;
          return;
        }

        // Render orders efficiently
        ordersList.innerHTML = orders.map(order => {
          const dateStr = new Date(order.createdAt).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'}) + ' | ' + new Date(order.createdAt).toLocaleDateString('ar-EG');
          
          let statusBadge = '';
          if (order.status === 'verified') {
            statusBadge = `<span class="badge badge-verified">✓ تم التأكيد تلقائياً</span>`;
          } else {
            statusBadge = `<span class="badge badge-pending">⏳ بانتظار الـ SMS</span>`;
          }

          let ocrSection = '';
          if (order.ocrStatus === 'pending') {
            ocrSection = `
              <div class="ocr-details">
                🔍 جاري تشغيل الـ OCR وقراءة لقطة الشاشة...
              </div>
            `;
          } else if (order.ocrStatus === 'completed') {
            const barColor = order.ocrConfidence >= 80 ? 'var(--success)' : (order.ocrConfidence >= 50 ? 'var(--warning)' : 'var(--primary)');
            ocrSection = `
              <div class="ocr-details">
                <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                  <span>🤖 فحص ومطابقة محتويات الصورة:</span>
                  <span style="font-weight:700; color: ${barColor}">${order.ocrConfidence}%</span>
                </div>
                <div class="ocr-meter-container">
                  <div class="ocr-meter-bar" style="width: ${order.ocrConfidence}%; background: ${barColor}"></div>
                </div>
                <div class="ocr-text-log" style="display:none;" id="ocr-text-${order.id}">${order.ocrText}</div>
                <div style="text-align:left; margin-top:5px;">
                  <span style="cursor:pointer; font-size:0.75rem; text-decoration:underline; color:var(--text-secondary);" onclick="toggleOcrText('${order.id}')">إظهار النص المستخرج 🔍</span>
                </div>
              </div>
            `;
          } else if (order.ocrStatus === 'failed') {
            ocrSection = `
              <div class="ocr-details" style="border-color: rgba(230,0,0,0.2);">
                ⚠️ فشلت محاولة قراءة لقطة الشاشة تلقائياً (جودة الصورة منخفضة)
              </div>
            `;
          }

          const screenshotThumb = order.screenshotUrl 
            ? `<div style="position:relative;">
                 <img src="${order.screenshotUrl}" alt="Screenshot" style="width:70px; height:70px; object-fit:cover; border-radius: var(--radius-sm); border:1px solid var(--border-color); cursor:pointer;" onclick="viewFullImage('${order.screenshotUrl}')">
                 <span style="position:absolute; bottom:-4px; right:15px; background:rgba(0,0,0,0.7); font-size:0.6rem; padding:1px 4px; border-radius:4px; color:var(--text-secondary);">تكبير 🔍</span>
               </div>` 
            : `<div style="width:70px; height:70px; background:rgba(255,255,255,0.03); border-radius: var(--radius-sm); border:1px dashed var(--border-color); display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:0.65rem; color:var(--text-secondary); text-align:center; padding: 2px;">لا توجد لقطة</div>`;

          const approveButton = order.status !== 'verified' 
            ? `<button class="btn btn-success" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="manualApproveOrder('${order.id}')">موافقة يدوية ✓</button>`
            : '';

          return `
            <div class="glass-panel list-item" style="flex-direction: column; align-items: stretch; gap: 12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap: 15px; width: 100%;">
                
                <div style="display:flex; align-items:center; gap:15px;">
                  ${screenshotThumb}
                  <div class="item-details">
                    <div style="display:flex; align-items:center; gap:10px;">
                      <span class="item-title">${order.customerName}</span>
                      <span style="font-size:0.75rem; color:var(--text-secondary);">كود الطلب: <strong>${order.orderId}</strong></span>
                    </div>
                    <div class="item-meta">
                      <span>📅 ${dateStr}</span>
                      <span>📱 آخر 4 أرقام: <strong style="color:var(--text-primary); font-size:0.9rem;">${order.phoneLast4}</strong></span>
                    </div>
                    ${order.trxId ? `<div style="font-size:0.75rem; color:var(--success); margin-top:2px;">رقم العملية المحققة: <strong>${order.trxId}</strong></div>` : ''}
                  </div>
                </div>

                <div class="item-right">
                  <span class="item-amount">${order.amount.toFixed(2)} ج.م</span>
                  <div style="display:flex; gap:10px; align-items:center;">
                    ${statusBadge}
                    ${approveButton}
                  </div>
                </div>

              </div>
              
              ${ocrSection}
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
    }
  }

  // Fetch and render SMS Logs
  async function fetchSmsLogs() {
    try {
      const response = await fetch('/api/dashboard/sms');
      const data = await response.json();
      
      if (data.success) {
        const smsLogs = data.sms;
        smsCountBadge.textContent = smsLogs.length;

        if (smsLogs.length === 0) {
          smsList.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-secondary); font-size: 0.9rem;">
              📭 لا توجد رسائل مستلمة بعد.
            </div>
          `;
          return;
        }

        smsList.innerHTML = smsLogs.map(sms => {
          const dateStr = new Date(sms.createdAt).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'});
          const badge = sms.isLinked 
            ? `<span class="badge badge-linked">مربوط بالطلب</span>` 
            : `<span class="badge badge-unlinked">غير مربوط</span>`;

          return `
            <div class="glass-panel" style="padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem; border-color: ${sms.isLinked ? 'rgba(16, 185, 129, 0.15)' : 'var(--border-color)'}">
              <div style="display:flex; justify-content:space-between; color: var(--text-secondary); font-size: 0.75rem;">
                <span>📅 ${dateStr} | من: Vodafone</span>
                ${badge}
              </div>
              <div style="direction: ltr; text-align: right; font-family: 'Cairo', sans-serif; font-size: 0.8rem; line-height: 1.4; color: var(--text-primary);">
                ${sms.text}
              </div>
              ${sms.amount ? `
                <div style="display:flex; justify-content:space-between; margin-top:2px; font-size:0.75rem; border-top: 1px solid rgba(255,255,255,0.03); padding-top:4px; color: var(--text-secondary);">
                  <span>المبلغ المكتشف: <strong style="color:var(--text-primary);">${sms.amount} ج.م</strong></span>
                  <span>الرقم: <strong style="color:var(--text-primary);">${sms.senderPhone || 'غير معروف'}</strong></span>
                </div>
              ` : ''}
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Error fetching SMS logs:', err);
    }
  }

  // Toast Notification System
  function showNotification(message, type = 'success') {
    const notificationArea = document.getElementById('notification-area');
    const note = document.createElement('div');
    note.className = `notification ${type} glass-panel`;
    note.innerHTML = `
      <span>${type === 'success' ? '✓' : '⚠️'}</span>
      <span>${message}</span>
    `;
    notificationArea.appendChild(note);

    setTimeout(() => {
      note.style.opacity = '0';
      note.style.transform = 'translateY(20px)';
      setTimeout(() => note.remove(), 300);
    }, 4000);
  }

  // Expose global helper actions to window so onclick handlers function properly
  window.manualApproveOrder = async function(id) {
    if (!confirm('هل أنت متأكد من تفعيل وموافقة هذا الطلب يدوياً؟')) return;

    try {
      const response = await fetch(`/api/dashboard/orders/${id}/approve`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        showNotification('تم تأكيد وتفعيل الطلب بنجاح يدوياً!', 'success');
        fetchStats();
        fetchOrders();
      } else {
        showNotification(data.error || 'حدث خطأ أثناء التفعيل', 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('خطأ في الاتصال بالسيرفر', 'error');
    }
  };

  window.toggleOcrText = function(id) {
    const log = document.getElementById(`ocr-text-${id}`);
    if (log) {
      log.style.display = log.style.display === 'none' ? 'block' : 'none';
    }
  };

  window.viewFullImage = function(url) {
    window.open(url, '_blank');
  };

  window.showNotification = showNotification; // make global for debugging
});
