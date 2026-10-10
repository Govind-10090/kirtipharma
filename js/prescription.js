// ===== KIRTI PHARMA — prescription.js =====
// Drag-drop upload, camera capture, patient details & chemist queue submission

let selectedRxFile = null;

document.addEventListener('DOMContentLoaded', () => {
  initDropzone();
  initCamera();
  initPatientForm();
});

// ===== PREFILL PATIENT DETAILS =====
function initPatientForm() {
  const nameInput = document.getElementById('patient-name-input');
  const phoneInput = document.getElementById('patient-phone-input');
  const submitBtn = document.getElementById('submit-rx-btn');

  // Auto-fill if user has an active session or past info
  const savedName = localStorage.getItem('kp_user_name');
  const savedPhone = localStorage.getItem('kp_user_phone');

  if (nameInput && savedName && savedName !== 'Customer') {
    nameInput.value = savedName;
  }
  if (phoneInput && savedPhone) {
    phoneInput.value = savedPhone.replace(/[^0-9]/g, '').slice(-10);
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', handlePrescriptionSubmission);
  }
}

// ===== DROPZONE =====
function initDropzone() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('prescription-file');

  if (!dropzone || !fileInput) return;

  // Click to open
  dropzone.addEventListener('click', () => fileInput.click());
  document.getElementById('browse-link')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  // Keyboard accessibility
  dropzone.setAttribute('tabindex', '0');
  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('aria-label', 'Upload prescription — click or drag & drop');
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });

  // Drag events
  ['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'dragend'].forEach(ev => {
    dropzone.addEventListener(ev, () => dropzone.classList.remove('drag-over'));
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) stageFile(file);
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) stageFile(fileInput.files[0]);
  });
}

function stageFile(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type)) {
    showToast('Please upload a JPG, PNG, or PDF file', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File too large. Maximum size is 10MB', 'error');
    return;
  }

  selectedRxFile = file;

  const dropzone = document.getElementById('dropzone');
  const previewSection = document.getElementById('upload-preview-section');
  const previewName = document.getElementById('preview-file-name');
  const previewThumb = document.getElementById('preview-thumb');

  // Show preview
  if (previewSection) previewSection.style.display = 'flex';
  if (previewName) previewName.textContent = file.name;

  if (previewThumb && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewThumb.src = e.target.result;
      previewThumb.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else if (previewThumb) {
    previewThumb.style.display = 'none';
  }

  // Update dropzone UI
  if (dropzone) {
    const icon = dropzone.querySelector('.dropzone-icon');
    const title = dropzone.querySelector('.dropzone-title');
    if (icon) icon.textContent = '📎';
    if (title) title.textContent = `Attached: ${file.name}`;
  }

  showToast(`Prescription "${file.name}" attached! Please check patient details below.`, 'info');
}

function clearSelectedFile() {
  selectedRxFile = null;
  const fileInput = document.getElementById('prescription-file');
  if (fileInput) fileInput.value = '';

  const previewSection = document.getElementById('upload-preview-section');
  if (previewSection) previewSection.style.display = 'none';

  const dropzone = document.getElementById('dropzone');
  if (dropzone) {
    const icon = dropzone.querySelector('.dropzone-icon');
    const title = dropzone.querySelector('.dropzone-title');
    if (icon) icon.textContent = '📄';
    if (title) title.textContent = 'Drop your prescription here';
  }
}

// ===== SUBMIT PRESCRIPTION =====
async function handlePrescriptionSubmission() {
  if (!selectedRxFile) {
    const dropzone = document.getElementById('dropzone');
    if (dropzone) {
      dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' });
      dropzone.style.border = '2px dashed #DC2626';
      setTimeout(() => { dropzone.style.border = ''; }, 2500);
    }
    showToast('Please select or capture your prescription file first', 'error');
    return;
  }

  const nameInput = document.getElementById('patient-name-input');
  const phoneInput = document.getElementById('patient-phone-input');
  const notesInput = document.getElementById('patient-notes-input');
  const submitBtn = document.getElementById('submit-rx-btn');

  const patientName = (nameInput?.value || '').trim();
  const rawPhone = (phoneInput?.value || '').replace(/[^0-9]/g, '').trim();
  const notes = (notesInput?.value || '').trim();

  if (!patientName || patientName.length < 2) {
    nameInput?.focus();
    showToast('Please enter the patient / customer name', 'error');
    return;
  }

  if (!rawPhone || rawPhone.length !== 10) {
    phoneInput?.focus();
    showToast('Please enter a valid 10-digit mobile number', 'error');
    return;
  }

  // Remember contact details for subsequent visits
  localStorage.setItem('kp_user_name', patientName);
  localStorage.setItem('kp_user_phone', rawPhone);

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳</span> Sending to Chemist Queue...';
  }

  let fileDataUrl = '';
  try {
    fileDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(selectedRxFile);
    });
  } catch (_) {}

  const formData = new FormData();
  formData.append('prescription', selectedRxFile);
  if (fileDataUrl) formData.append('fileDataUrl', fileDataUrl);
  formData.append('fileName', selectedRxFile.name);
  formData.append('patient', patientName);
  formData.append('phone', rawPhone);
  formData.append('notes', notes);
  formData.append('source', 'App');

  try {
    const res = await fetch('/api/prescriptions', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();

    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Server error uploading prescription');
    }

    // Success UI
    const successMsg = document.getElementById('upload-success-msg');
    const headerEl = document.getElementById('success-patient-header');
    const detailEl = document.getElementById('success-patient-detail');
    const formSection = document.getElementById('patient-details-form');
    const dropzone = document.getElementById('dropzone');
    const previewSection = document.getElementById('upload-preview-section');
    const reuploadSection = document.getElementById('reupload-section');

    if (headerEl) headerEl.textContent = `Prescription received for ${patientName}!`;
    if (detailEl) detailEl.textContent = `Our pharmacist at Kirti Medical Store has received this and will call you on ${rawPhone} with availability & pricing.`;

    if (successMsg) {
      successMsg.style.display = 'flex';
      successMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (formSection) formSection.style.display = 'none';
    if (dropzone) dropzone.style.display = 'none';
    if (previewSection) previewSection.style.display = 'none';
    if (reuploadSection) reuploadSection.style.display = 'block';

    showToast(`✅ Prescription submitted! Chemist is reviewing your order.`, 'success', 6000);
    logUploadEvent(selectedRxFile.name);

  } catch (err) {
    console.error('[KP] Upload error:', err);
    showToast(`Upload failed: ${err.message}`, 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>📋</span> Submit Prescription to Chemist';
    }
  }
}

// ===== CAMERA CAPTURE =====
function initCamera() {
  const cameraBtn = document.getElementById('camera-btn');
  const cameraInput = document.getElementById('camera-input');
  if (!cameraBtn || !cameraInput) return;

  cameraBtn.addEventListener('click', () => {
    cameraInput.click();
  });

  cameraInput.addEventListener('change', () => {
    if (cameraInput.files[0]) {
      stageFile(cameraInput.files[0]);
    }
  });
}

// ===== REUPLOAD =====
function reuploadPrescription() {
  selectedRxFile = null;
  const fileInput = document.getElementById('prescription-file');
  if (fileInput) fileInput.value = '';

  const dropzone = document.getElementById('dropzone');
  const formSection = document.getElementById('patient-details-form');
  const successMsg = document.getElementById('upload-success-msg');
  const previewSection = document.getElementById('upload-preview-section');
  const reuploadSection = document.getElementById('reupload-section');
  const submitBtn = document.getElementById('submit-rx-btn');

  if (dropzone) {
    dropzone.style.display = 'block';
    const icon = dropzone.querySelector('.dropzone-icon');
    const title = dropzone.querySelector('.dropzone-title');
    if (icon) icon.textContent = '📄';
    if (title) title.textContent = 'Drop your prescription here';
  }
  if (formSection) formSection.style.display = 'block';
  if (previewSection) previewSection.style.display = 'none';
  if (successMsg) successMsg.style.display = 'none';
  if (reuploadSection) reuploadSection.style.display = 'none';
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>📋</span> Submit Prescription to Chemist';
  }
}

// ===== WHATSAPP REDIRECT =====
function sendOnWhatsApp() {
  const msg = encodeURIComponent(
    'Hi Kirti Pharma,\n\nI have a prescription and would like to place an order. Please assist me.\n\nThank you.'
  );
  window.open(`https://wa.me/919876543210?text=${msg}`, '_blank');
}

// ===== ANALYTICS =====
function logUploadEvent(fileName) {
  console.log('[KP] Prescription uploaded to pharmacist queue:', fileName, new Date().toISOString());
}
