const FLOATIES = ["⭐", "🎈", "✨", "🌈", "💫", "🎀"];

function spawnFloaties() {
  const count = 14;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "floaty";
    el.textContent = FLOATIES[Math.floor(Math.random() * FLOATIES.length)];
    el.style.left = Math.random() * 100 + "vw";
    el.style.animationDuration = 10 + Math.random() * 14 + "s";
    el.style.animationDelay = -Math.random() * 20 + "s";
    el.style.fontSize = 1.4 + Math.random() * 2 + "rem";
    document.body.appendChild(el);
  }
}

function render(filterCategory, searchText) {
  const main = document.getElementById("main-content");
  main.innerHTML = "";

  const categories = Object.keys(CATEGORY_META).filter(
    (c) => filterCategory === "all" || filterCategory === c
  );

  const q = (searchText || "").trim().toLowerCase();
  let anyResult = false;

  categories.forEach((cat) => {
    const meta = CATEGORY_META[cat];
    let items = SITE_DATA.filter((d) => d.category === cat);

    if (q) {
      items = items.filter((d) => {
        const hay = [d.title, d.description, ...(d.tags || [])].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }

    if (items.length === 0) return;
    anyResult = true;

    const section = document.createElement("section");
    section.className = "category-section";

    const heading = document.createElement("h2");
    heading.className = "category-heading";
    heading.innerHTML = `<span class="badge" style="background:${meta.color}">${meta.emoji}</span> ${meta.label}`;
    section.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "card-grid";

    items.forEach((item, idx) => {
      const card = document.createElement("a");
      card.className = "card";
      card.href = item.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.style.animationDelay = idx * 0.05 + "s";

      const tags = (item.tags || [])
        .map((t) => `<span class="tag">#${t}</span>`)
        .join("");

      card.innerHTML = `
        <div class="emoji">${item.emoji || meta.emoji}</div>
        <h3>${item.title}</h3>
        <p class="desc">${item.description || ""}</p>
        <div class="tag-row">${tags}</div>
        <span class="visit" style="color:${meta.color}">サイトへ行く →</span>
      `;

      if (item.zip) {
        const zipBtn = document.createElement("a");
        zipBtn.className = "zip-btn";
        zipBtn.href = item.zip.url;
        zipBtn.download = "";
        zipBtn.textContent = "📦 " + (item.zip.label || "ダウンロード");
        zipBtn.addEventListener("click", (e) => e.stopPropagation());
        card.appendChild(zipBtn);
      }

      grid.appendChild(card);
    });

    section.appendChild(grid);
    main.appendChild(section);
  });

  if (!anyResult) {
    main.innerHTML = `<div class="empty-msg">🔍 見つからなかったよ…！ 別のキーワードを試してね</div>`;
  }
}

function init() {
  spawnFloaties();

  const tabsWrap = document.getElementById("tabs");
  const allBtn = document.createElement("button");
  allBtn.className = "tab-btn active";
  allBtn.textContent = "✨ すべて";
  allBtn.dataset.cat = "all";
  allBtn.style.background = "linear-gradient(90deg, #FF6FA5, #C79CFF)";
  allBtn.style.color = "white";
  tabsWrap.appendChild(allBtn);

  Object.entries(CATEGORY_META).forEach(([key, meta]) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn";
    btn.textContent = `${meta.emoji} ${meta.label}`;
    btn.dataset.cat = key;
    tabsWrap.appendChild(btn);
  });

  let currentCat = "all";
  const searchInput = document.getElementById("search-input");

  tabsWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    currentCat = btn.dataset.cat;

    [...tabsWrap.children].forEach((b) => {
      b.classList.remove("active");
      b.style.background = "";
      b.style.color = "";
    });
    btn.classList.add("active");
    if (currentCat === "all") {
      btn.style.background = "linear-gradient(90deg, #FF6FA5, #C79CFF)";
    } else {
      btn.style.background = CATEGORY_META[currentCat].color;
    }
    btn.style.color = "white";

    render(currentCat, searchInput.value);
  });

  searchInput.addEventListener("input", () => {
    render(currentCat, searchInput.value);
  });

  render("all", "");
}

document.addEventListener("DOMContentLoaded", init);
