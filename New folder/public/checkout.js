document.addEventListener('DOMContentLoaded', () => {
  // Select DOM elements
  const merchantWalletNumber = document.getElementById('merchant-wallet-number');
  const copyWalletBtn = document.getElementById('copy-wallet-btn');
  
  const checkoutContainer = document.getElementById('checkout-container');
  const verificationStatusContainer = document.getElementById('verification-status-container');
  const checkoutPaymentForm = document.getElementById('checkout-payment-form');
  
  const customerNameInput = document.getElementById('customer-name');
  const amountInput = document.getElementById('amount');
  const phoneLast4Input = document.getElementById('phone-last4');
  
  const dropArea = document.getElementById('drop-area');
  const screenshotInput = document.getElementById('screenshot-input');
  const previewImg = document.getElementById('preview-img');
  const uploaderPrompt = document.getElementById('uploader-prompt');
  
  // Status Elements
  const statusAnimationIcon = document.getElementById('status-animation-icon');
  const statusMainTitle = document.getElementById('status-main-title');
  const displayOrderId = document.getElementById('display-order-id');
  const displayCustomerName = document.getElementById('display-customer-name');
  const displayAmount = document.getElementById('display-amount');
  
  const dotOcr = document.getElementById('dot-ocr');
  const textOcr = document.getElementById('text-ocr');
  const dotSms = document.getElementById('dot-sms');
  const textSms = document.getElementById('text-sms');
  const btnBackCheckout = document.getElementById('btn-back-checkout');

  let currentOrderId = null;
  let statusPollInterval = null;

  // Load Merchant Wallet Details on start
  loadWalletDetails();

  // Parse URL Query Parameters to automatically populate and lock checkout details
  parseUrlParams();

  function parseUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const amount = urlParams.get('amount');
    const orderId = urlParams.get('orderId');
    const name = urlParams.get('name') || urlParams.get('customerName');

    if (amount) {
      amountInput.value = parseFloat(amount);
      amountInput.readOnly = true;
      amountInput.style.opacity = '0.8';
    }
    if (orderId) {
      // Store order ID in a custom property on the form or window
      checkoutPaymentForm.dataset.orderId = orderId;
    }
    if (name) {
      customerNameInput.value = decodeURIComponent(name);
      customerNameInput.readOnly = true;
      customerNameInput.style.opacity = '0.8';
    }
  }

  // Click-to-Copy Wallet number
  copyWalletBtn.addEventListener('click', () => {
    const numberText = merchantWalletNumber.textContent.trim();
    navigator.clipboard.writeText(numberText).then(() => {
      copyWalletBtn.textContent = 'تم النسخ! 📋';
      copyWalletBtn.style.background = 'var(--success-glow)';
      copyWalletBtn.style.color = 'var(--success)';
      
      setTimeout(() => {
        copyWalletBtn.textContent = 'نسخ الرقم 📋';
        copyWalletBtn.style.background = 'rgba(255, 255, 255, 0.08)';
        copyWalletBtn.style.color = 'var(--text-secondary)';
      }, 2000);
    }).catch(err => {
      console.error('Could not copy text: ', err);
    });
  });

  // Uploader Drop/Click Triggers
  dropArea.addEventListener('click', () => screenshotInput.click());

  // Prevent defaults for drag events
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Handle Drag Highlight
  ['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.add('dragging'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragging'), false);
  });

  // Handle dropped files
  dropArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      screenshotInput.files = files;
      handleFilePreview(files[0]);
    }
  });

  // Handle selected files
  screenshotInput.addEventListener('change', () => {
    if (screenshotInput.files.length > 0) {
      handleFilePreview(screenshotInput.files[0]);
    }
  });

  function handleFilePreview(file) {
    if (!file.type.startsWith('image/')) {
      showNotification('يرجى اختيار ملف صورة صالح!', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      previewImg.style.display = 'block';
      uploaderPrompt.style.display = 'none';
      dropArea.style.padding = '1rem';
    };
    reader.readAsDataURL(file);
  }

  // Handle Checkout Form Submission
  checkoutPaymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const amount = amountInput.value.trim();
    const phoneLast4 = phoneLast4Input.value.trim();
    const customerName = customerNameInput.value.trim() || 'عميل';
    const file = screenshotInput.files[0];

    const formData = new FormData();
    formData.append('amount', amount);
    formData.append('phoneLast4', phoneLast4);
    formData.append('customerName', customerName);
    
    // Append orderId if it was parsed from URL query parameters
    if (checkoutPaymentForm.dataset.orderId) {
      formData.append('orderId', checkoutPaymentForm.dataset.orderId);
    }
    
    if (file) {
      formData.append('screenshot', file);
    }

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (data.success) {
        showNotification(data.message, 'success');
        
        // Show Verification View
        currentOrderId = data.order.id;
        displayOrderId.textContent = data.order.orderId;
        displayCustomerName.textContent = data.order.customerName;
        displayAmount.textContent = `${parseFloat(data.order.amount).toFixed(2)} ج.م`;
        
        checkoutContainer.style.display = 'none';
        verificationStatusContainer.style.display = 'block';
        
        // Reset steps UI
        dotOcr.style.background = data.order.screenshotUrl ? 'var(--warning)' : 'rgba(255,255,255,0.15)';
        textOcr.textContent = data.order.screenshotUrl 
          ? 'جاري تحليل لقطة الشاشة وتدقيق البيانات تلقائياً...' 
          : 'لم يتم رفع لقطة شاشة (تخطى الخطوة تكميلياً)';
        
        dotSms.style.background = 'rgba(255,255,255,0.15)';
        textSms.textContent = 'بانتظار وصول رسالة التحويل من شبكة المحمول...';
        
        statusAnimationIcon.textContent = '⏳';
        statusMainTitle.textContent = 'جاري التحقق من عملية الدفع...';
        btnBackCheckout.style.display = 'inline-flex';

        // Start polling order status
        startStatusPolling(data.order.id);
      } else {
        showNotification(data.error || 'فشل تسجيل العملية', 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('خطأ في الاتصال بالخادم، يرجى المحاولة لاحقاً', 'error');
    }
  });

  // Back to checkout button action
  btnBackCheckout.addEventListener('click', () => {
    stopStatusPolling();
    verificationStatusContainer.style.display = 'none';
    checkoutContainer.style.display = 'block';
  });

  // Load Wallet number dynamically
  async function loadWalletDetails() {
    try {
      const response = await fetch('/api/dashboard/stats');
      const data = await response.json();
      if (data.success) {
        merchantWalletNumber.textContent = data.stats.walletNumber;
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Start polling status
  function startStatusPolling(orderId) {
    if (statusPollInterval) clearInterval(statusPollInterval);

    statusPollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}/status`);
        const data = await response.json();

        if (data.success) {
          // Update OCR Step visual status
          if (data.ocrStatus === 'completed') {
            dotOcr.style.background = 'var(--success)';
            textOcr.textContent = `تم فحص لقطة الشاشة بنجاح! نسبة التطابق: ${data.ocrConfidence}%`;
          } else if (data.ocrStatus === 'failed') {
            dotOcr.style.background = 'var(--primary)';
            textOcr.textContent = 'لم نتمكن من قراءة الصورة تلقائياً (جودة منخفضة، سيتم المراجعة عبر الـ SMS).';
          }

          // Update SMS Step / Match visual status
          if (data.status === 'verified') {
            dotSms.style.background = 'var(--success)';
            textSms.textContent = 'تم استلام وتأكيد رسالة التحويل بنجاح! 🎉';
            
            // Big Final Success Update
            statusAnimationIcon.textContent = '✅';
            statusAnimationIcon.style.color = 'var(--success)';
            statusAnimationIcon.style.animation = 'none';
            statusMainTitle.textContent = '🎉 تم تأكيد الدفع بنجاح!';
            statusMainTitle.style.color = 'var(--success)';
            
            showNotification('تم التحقق وتأكيد طلبك بنجاح! شكراً لك.', 'success');
            btnBackCheckout.style.display = 'none'; // Lock checkout view

            stopStatusPolling();
          } else {
            // Still waiting for SMS
            dotSms.style.background = 'var(--warning)';
            textSms.textContent = 'بانتظار وصول رسالة الشبكة المطابقة للتحويل...';
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1500);
  }

  function stopStatusPolling() {
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
      statusPollInterval = null;
    }
  }

  // Notification Toast Helper
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
});
