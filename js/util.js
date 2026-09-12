export function formatInr(amount) {
  if (amount === null || amount === undefined) return '—';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

export function formatArea(sqft) {
  if (!sqft) return '—';
  return `${Number(sqft).toLocaleString('en-IN')} sqft`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function qs(id) {
  return document.getElementById(id);
}

export function paginationControls(page, total, limit, onChange) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const wrap = document.createElement('div');
  wrap.className = 'pagination';

  const first = document.createElement('button');
  first.textContent = '« First';
  first.disabled = page <= 1;
  first.onclick = () => onChange(1);

  const prev = document.createElement('button');
  prev.textContent = '← Prev';
  prev.disabled = page <= 1;
  prev.onclick = () => onChange(page - 1);

  const label = document.createElement('span');
  label.innerHTML = `Page ${page} of ${totalPages} &nbsp;—&nbsp; <strong>${total.toLocaleString('en-IN')} total records</strong>`;

  const next = document.createElement('button');
  next.textContent = 'Next →';
  next.disabled = page >= totalPages;
  next.onclick = () => onChange(page + 1);

  const last = document.createElement('button');
  last.textContent = 'Last »';
  last.disabled = page >= totalPages;
  last.onclick = () => onChange(totalPages);

  const jumpForm = document.createElement('form');
  jumpForm.style.display = 'inline-flex';
  jumpForm.style.gap = '0.3rem';
  jumpForm.innerHTML = `<input type="number" min="1" max="${totalPages}" placeholder="Page #" style="width:70px;padding:0.3rem;border:1px solid var(--line);border-radius:3px" /><button type="submit">Go</button>`;
  jumpForm.onsubmit = (e) => {
    e.preventDefault();
    const val = Number(jumpForm.querySelector('input').value);
    if (val >= 1 && val <= totalPages) onChange(val);
  };

  wrap.append(first, prev, label, next, last, jumpForm);
  return wrap;
}
