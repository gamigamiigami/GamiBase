const FLOATIES = ["⭐", "🎈", "✨", "🌈", "💫", "🎀"];

function spawnFloaties() {
  const count = 10;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "floaty";
    el.textContent = FLOATIES[Math.floor(Math.random() * FLOATIES.length)];
    el.style.left = Math.random() * 100 + "vw";
    el.style.animationDuration = 10 + Math.random() * 14 + "s";
    el.style.animationDelay = -Math.random() * 20 + "s";
    el.style.fontSize = 1.2 + Math.random() * 1.6 + "rem";
    document.body.appendChild(el);
  }
}

function cardHTML(item, meta) {
  const tags = (item.tags || []).map((t) => `<span class="tag">#${t}</span>`).join("");
  const zip = item.zip
    ? `<a class="zip-btn" href="${item.zip.url}" download onclick="event.stopPropagation()">📦 ${item.zip.label || "ダウンロード"}</a>`
    : "";
  return `
    <a class="card" href="${item.url}" target="_blank" rel="noopener noreferrer">
      <div class="emoji">${item.emoji || meta.emoji}</div>
      <h3>${item.title}</h3>
      <p class="desc">${item.description || ""}</p>
      <div class="tag-row">${tags}</div>
      <span class="visit" style="color:${meta.color}">サイトへ行く →</span>
      ${zip}
    </a>
  `;
}

function renderFolders() {
  const grid = document.getElementById("folder-grid");
  grid.innerHTML = "";

  Object.entries(CATEGORY_META).forEach(([key, meta]) => {
    const count = SITE_DATA.filter((d) => d.category === key).length;
    const folder = document.createElement("button");
    folder.className = "folder";
    folder.style.setProperty("--folder-color", meta.color);
    folder.innerHTML = `
      <span class="folder-icon">${meta.emoji}</span>
      <span class="folder-label">${meta.label}</span>
      <span class="folder-count">${count}件</span>
    `;
    folder.addEventListener("click", () => openFolder(key));
    grid.appendChild(folder);
  });
}

function openFolder(catKey) {
  const meta = CATEGORY_META[catKey];
  const items = SITE_DATA.filter((d) => d.category === catKey);

  document.getElementById("modal-title").innerHTML = `${meta.emoji} ${meta.label}`;
  const content = document.getElementById("modal-content");

  if (items.length === 0) {
    content.innerHTML = `<div class="empty-msg">まだ何もないよ、これから増やそう！</div>`;
  } else {
    content.innerHTML = `<div class="card-grid">${items.map((i) => cardHTML(i, meta)).join("")}</div>`;
  }

  const overlay = document.getElementById("modal-overlay");
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.remove("open");
  setTimeout(() => { overlay.hidden = true; }, 200);
}

function runSearch(q) {
  const resultsWrap = document.getElementById("search-results");
  const resultsContent = document.getElementById("search-results-content");
  const stage = document.querySelector(".stage");

  const query = q.trim().toLowerCase();
  if (!query) {
    resultsWrap.hidden = true;
    stage.style.display = "";
    return;
  }

  stage.style.display = "none";
  resultsWrap.hidden = false;

  let html = "";
  Object.entries(CATEGORY_META).forEach(([key, meta]) => {
    const items = SITE_DATA.filter((d) => {
      if (d.category !== key) return false;
      const hay = [d.title, d.description, ...(d.tags || [])].join(" ").toLowerCase();
      return hay.includes(query);
    });
    if (items.length === 0) return;
    html += `
      <section class="category-section">
        <h2 class="category-heading"><span class="badge" style="background:${meta.color}">${meta.emoji}</span> ${meta.label}</h2>
        <div class="card-grid">${items.map((i) => cardHTML(i, meta)).join("")}</div>
      </section>
    `;
  });

  resultsContent.innerHTML = html || `<div class="empty-msg">🔍 見つからなかったよ…！ 別のキーワードを試してね</div>`;
}

function init() {
  spawnFloaties();
  renderFolders();

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  const searchInput = document.getElementById("search-input");
  searchInput.addEventListener("input", () => runSearch(searchInput.value));

  document.getElementById("search-close").addEventListener("click", () => {
    searchInput.value = "";
    runSearch("");
  });
}

document.addEventListener("DOMContentLoaded", init);
