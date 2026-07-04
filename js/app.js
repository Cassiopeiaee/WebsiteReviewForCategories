const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzmvcbYziC35UvMdD17i8-p1Ju52-2531fO9pLKxgnJCqFOcL0cuPtZB-YhJ1uyDLSfTw/exec',
};

const MAX_FILES = 5;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.webm'];

let selectedFiles = [];

const form = document.getElementById('bug-report-form');
const submitBtn = document.getElementById('btn-submit');
const descriptionField = document.getElementById('description');
const descCharCount = document.getElementById('desc-char-count');
const stepsField = document.getElementById('steps');
const stepsCharCount = document.getElementById('steps-char-count');
const toastContainer = document.getElementById('toast-container');
const successOverlay = document.getElementById('success-overlay');
const configBanner = document.getElementById('config-banner');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const filePreviews = document.getElementById('file-previews');

document.addEventListener('DOMContentLoaded', () => {
  if (!CONFIG.SCRIPT_URL || CONFIG.SCRIPT_URL.trim() === '' || CONFIG.SCRIPT_URL.includes('PASTE_YOUR')) {
    configBanner?.classList.remove('hidden');
  } else {
    configBanner?.classList.add('hidden');
  }

  setupCharCounter(descriptionField, descCharCount, 2000);
  setupCharCounter(stepsField, stepsCharCount, 1000);
  setupFileUpload();
  form?.addEventListener('submit', handleSubmit);
});

function setupCharCounter(field, counter, max) {
  if (!field || !counter) return;

  const update = () => {
    const len = field.value.length;
    counter.textContent = `${len} / ${max}`;
    counter.classList.toggle('char-count--warn', len > max * 0.9);
  };

  field.addEventListener('input', update);
  update();
}

function setupFileUpload() {
  if (!uploadZone || !fileInput) return;

  uploadZone.addEventListener('click', (e) => {
    if (e.target.closest('.upload-zone__browse')) return;
    fileInput.click();
  });

  uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  uploadZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (!uploadZone.contains(e.relatedTarget)) {
      uploadZone.classList.remove('dragover');
    }
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });
}

function addFiles(fileList) {
  const newFiles = Array.from(fileList);

  for (const file of newFiles) {
    if (selectedFiles.length >= MAX_FILES) {
      showToast('error', 'Limit Reached', `You can upload a maximum of ${MAX_FILES} files.`);
      break;
    }

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
      showToast('error', 'Invalid File Type', `"${file.name}" is not a supported file.`);
      continue;
    }

    const currentTotal = selectedFiles.reduce((sum, f) => sum + f.file.size, 0);
    if (currentTotal + file.size > MAX_TOTAL_SIZE) {
      showToast('error', 'Size Limit', `Adding "${file.name}" would exceed the limit.`);
      continue;
    }

    if (selectedFiles.some(f => f.file.name === file.name && f.file.size === file.size)) {
      continue;
    }

    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    selectedFiles.push({ file, id });
    renderFilePreview(file, id);
  }
}

function removeFile(id) {
  selectedFiles = selectedFiles.filter(f => f.id !== id);
  const el = document.getElementById(id);
  if (el) {
    el.style.animation = 'filePreviewIn 0.2s ease reverse';
    setTimeout(() => el.remove(), 200);
  }
}

function renderFilePreview(file, id) {
  const card = document.createElement('div');
  card.className = 'file-preview';
  card.id = id;

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');

  let thumbHTML = '';

  if (isImage) {
    const url = URL.createObjectURL(file);
    thumbHTML = `<img class="file-preview__thumb" src="${url}" alt="${escapeHTML(file.name)}">`;
  } else if (isVideo) {
    const url = URL.createObjectURL(file);
    thumbHTML = `
      <div class="file-preview__video-thumb">
        <video src="${url}" preload="metadata" muted></video>
      </div>`;
  }

  card.innerHTML = `
    ${thumbHTML}
    <div class="file-preview__info">
      <span class="file-preview__name" title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</span>
      <span class="file-preview__size">${formatFileSize(file.size)}</span>
    </div>
    <button type="button" class="file-preview__remove" aria-label="Remove file" title="Remove">x</button>
    <div class="file-preview__progress"></div>
  `;

  card.querySelector('.file-preview__remove').addEventListener('click', (e) => {
    e.stopPropagation();
    removeFile(id);
  });

  filePreviews.appendChild(card);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleSubmit(e) {
  e.preventDefault();

  if (!CONFIG.SCRIPT_URL || CONFIG.SCRIPT_URL.trim() === '' || CONFIG.SCRIPT_URL.includes('PASTE_YOUR')) {
    showToast('error', 'Not Configured', 'Please configure your URL.');
    return;
  }

  const title = document.getElementById('title').value.trim();
  const description = descriptionField.value.trim();
  const steps = stepsField?.value.trim() || '';
  const email = document.getElementById('email')?.value.trim() || '';

  if (!title || !description) {
    showToast('error', 'Missing Fields', 'Please fill in all required fields.');
    return;
  }

  submitBtn.classList.add('loading');
  submitBtn.disabled = true;

  try {
    const filesPayload = [];
    if (selectedFiles.length > 0) {
      for (const { file, id } of selectedFiles) {
        const card = document.getElementById(id);
        const progressBar = card?.querySelector('.file-preview__progress');

        card?.classList.add('uploading');
        if (progressBar) progressBar.style.width = '50%';

        try {
          const content = await fileToBase64(file);
          filesPayload.push({
            name: file.name,
            type: file.type,
            content: content
          });

          if (progressBar) progressBar.style.width = '100%';
          card?.classList.remove('uploading');
          card?.classList.add('uploaded');
        } catch (fileErr) {
          console.error(fileErr);
          showToast('error', 'File Error', `Could not process "${file.name}".`);
          throw fileErr;
        }
      }
    }

    const payload = {
      title,
      description,
      steps,
      email,
      files: filesPayload
    };

    const response = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      let errorDetail = 'Server error';
      if (result.error) {
        errorDetail = result.error;
      } else if (result.body) {
        try {
          const githubError = JSON.parse(result.body);
          errorDetail = githubError.message || result.body;
        } catch (e) {
          errorDetail = result.body;
        }
      }
      throw new Error(errorDetail);
    }

    showSuccessOverlay();
    form.reset();
    selectedFiles = [];
    filePreviews.innerHTML = '';

  } catch (error) {
    console.error(error);
    showToast('error', 'Submission Failed', `Could not submit report: ${error.message}`);
  } finally {
    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;
  }
}

function showSuccessOverlay() {
  successOverlay.classList.add('visible');

  setTimeout(() => {
    successOverlay.classList.remove('visible');
  }, 2800);

  successOverlay.addEventListener('click', () => {
    successOverlay.classList.remove('visible');
  }, { once: true });
}

function showToast(type, title, message) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;

  const icon = type === 'success' ? '[Success]' : '[Error]';

  toast.innerHTML = `
    <span class="toast__icon">${icon}</span>
    <div class="toast__content">
      <div class="toast__title">${escapeHTML(title)}</div>
      <div class="toast__message">${escapeHTML(message)}</div>
    </div>
    <button class="toast__close" aria-label="Close">&times;</button>
  `;

  toast.querySelector('.toast__close').addEventListener('click', () => dismissToast(toast));
  toastContainer.appendChild(toast);

  setTimeout(() => dismissToast(toast), 4500);
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('toast--exit')) return;
  toast.classList.add('toast--exit');
  setTimeout(() => toast.remove(), 350);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
