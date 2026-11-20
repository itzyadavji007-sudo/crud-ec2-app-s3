// On your PC (localhost / 127.0.0.1) talk directly to the local backend.
// On the server, Nginx forwards /api/* to the private backend instance.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const API = isLocal ? 'http://localhost:5000/api' : '/api';

const form = document.getElementById('item-form');
const idInput = document.getElementById('item-id');
const titleInput = document.getElementById('title');
const descInput = document.getElementById('description');
const fileInput = document.getElementById('file');
const currentFile = document.getElementById('current-file');
const submitBtn = document.getElementById('submit-btn');
const cancelBtn = document.getElementById('cancel-btn');
const formTitle = document.getElementById('form-title');
const message = document.getElementById('message');
const tbody = document.getElementById('items-body');

let items = [];

function show(text, ok = true) {
  message.textContent = text;
  message.className = ok ? 'ok' : 'err';
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

async function loadItems() {
  try {
    const res = await fetch(`${API}/items`);
    if (!res.ok) throw new Error();
    items = await res.json();
    render();
  } catch {
    show('Could not load items. Is the backend reachable?', false);
  }
}

function render() {
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No items yet.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map((i) => `
    <tr>
      <td>${i.id}</td>
      <td>${esc(i.title)}</td>
      <td>${esc(i.description)}</td>
      <td>${i.file_name ? `<a href="${API}/files/${i.id}">${esc(i.original_name)}</a>` : '-'}</td>
      <td class="row-actions">
        <button class="small" data-edit="${i.id}">Edit</button>
        <button class="small danger" data-delete="${i.id}">Delete</button>
      </td>
    </tr>`).join('');
}

function resetForm() {
  form.reset();
  idInput.value = '';
  currentFile.textContent = '';
  formTitle.textContent = 'Add item';
  submitBtn.textContent = 'Submit';
  cancelBtn.hidden = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = idInput.value;
  const data = new FormData();
  data.append('title', titleInput.value);
  data.append('description', descInput.value);
  if (fileInput.files[0]) data.append('file', fileInput.files[0]);

  submitBtn.disabled = true;
  try {
    const res = await fetch(id ? `${API}/items/${id}` : `${API}/items`, {
      method: id ? 'PUT' : 'POST',
      body: data,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Request failed');
    show(id ? 'Item updated.' : 'Item created.');
    resetForm();
    loadItems();
  } catch (err) {
    show(err.message, false);
  } finally {
    submitBtn.disabled = false;
  }
});

tbody.addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.delete;

  if (editId) {
    const item = items.find((i) => String(i.id) === editId);
    idInput.value = item.id;
    titleInput.value = item.title;
    descInput.value = item.description || '';
    fileInput.value = '';
    currentFile.textContent = item.original_name ? `Current file: ${item.original_name} (choose a new file to replace it)` : '';
    formTitle.textContent = `Edit item #${item.id}`;
    submitBtn.textContent = 'Update';
    cancelBtn.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (delId && confirm('Delete this item?')) {
    try {
      const res = await fetch(`${API}/items/${delId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      show('Item deleted.');
      loadItems();
    } catch (err) {
      show(err.message, false);
    }
  }
});

cancelBtn.addEventListener('click', () => { resetForm(); show(''); });

loadItems();
