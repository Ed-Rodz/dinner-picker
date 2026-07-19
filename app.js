const MEALDB_API = "https://www.themealdb.com/api/json/v1/1";
const SPOONACULAR_API = "https://api.spoonacular.com/recipes";
// Public by necessity: this is a static site with no backend, so any key here
// is visible to anyone who views source. Free-tier quota abuse is the worst
// case; regenerate from the Spoonacular dashboard if that ever happens.
const SPOONACULAR_KEY = "76698fe3c3164dea88854c372897cba7";

const HISTORY_KEY = "dinnerPickerHistory";
const HISTORY_LIMIT = 10;
const AVOID_LAST = 6; // how many recent picks to try to avoid repeating

// Curated cuisine groups, each backed by whichever underlying values actually
// have recipes in each API. TheMealDB only tags ~28 of its ~190 "area" values
// with any recipes (verified directly against the API); Spoonacular has much
// broader real coverage (including American, French, Indian, Korean), so it's
// used to fill in the cuisines TheMealDB can't cover well on its own.
const CUISINE_GROUPS = {
  "Mexican": { mealdb: ["Mexican"], spoonacular: ["Mexican"] },
  "Latin American": { mealdb: ["Uruguayan"], spoonacular: ["Latin American"] },
  "Caribbean": { mealdb: ["Jamaican"], spoonacular: ["Caribbean"] },
  "Mediterranean": {
    mealdb: ["Spanish", "Italian", "Greek", "Turkish", "Tunisian", "Egyptian", "Moroccan", "Croatian", "Portuguese"],
    spoonacular: ["Mediterranean"],
  },
  "Italian": { mealdb: ["Italian"], spoonacular: ["Italian"] },
  "Chinese": { mealdb: ["Chinese"], spoonacular: ["Chinese"] },
  "Japanese": { mealdb: ["Japanese"], spoonacular: ["Japanese"] },
  "Thai": { mealdb: ["Thai"], spoonacular: ["Thai"] },
  "Southeast Asian": { mealdb: ["Vietnamese", "Malaysian", "Filipino"], spoonacular: ["Vietnamese"] },
  "British & Irish": { mealdb: ["British", "Irish"], spoonacular: ["British", "Irish"] },
  "Eastern European": { mealdb: ["Polish", "Russian", "Ukrainian"], spoonacular: ["Eastern European"] },
  "Middle Eastern & North African": {
    mealdb: ["Saudi Arabian", "Syrian", "Algerian", "Egyptian", "Tunisian", "Moroccan"],
    spoonacular: ["Middle Eastern", "African"],
  },
  "American": { mealdb: ["American"], spoonacular: ["American", "Southern"] },
  "French": { mealdb: ["French"], spoonacular: ["French"] },
  "Indian": { mealdb: ["Indian"], spoonacular: ["Indian"] },
  "Korean": { mealdb: ["South Korean"], spoonacular: ["Korean"] },
};

const cuisineSelect = document.getElementById("cuisine");
const categorySelect = document.getElementById("category");
const findBtn = document.getElementById("findBtn");
const rerollBtn = document.getElementById("rerollBtn");
const cookedBtn = document.getElementById("cookedBtn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const historyListEl = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistory");

let currentCandidates = [];
let currentMeal = null;

init();

async function init() {
  renderHistory();
  fillSelect(cuisineSelect, Object.keys(CUISINE_GROUPS), false);
  try {
    const categories = await fetchJson(`${MEALDB_API}/list.php?c=list`);
    fillSelect(categorySelect, categories.meals.map(m => m.strCategory));
  } catch (err) {
    setStatus("Couldn't load filter options — check your internet connection.", true);
  }
}

function fillSelect(select, values, sort = true) {
  (sort ? [...values].sort() : values).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

findBtn.addEventListener("click", () => findMeal({ freshSearch: true }));
rerollBtn.addEventListener("click", () => findMeal({ freshSearch: false }));
cookedBtn.addEventListener("click", () => {
  if (currentMeal) addToHistory(currentMeal);
});
clearHistoryBtn.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

async function findMeal({ freshSearch }) {
  setStatus("Looking for something good…");
  resultEl.classList.add("hidden");
  findBtn.disabled = true;
  rerollBtn.disabled = true;

  try {
    if (freshSearch || currentCandidates.length === 0) {
      currentCandidates = await getCandidates();
    }

    if (currentCandidates.length === 0) {
      setStatus("No meals matched those filters — try loosening them.", true);
      return;
    }

    const history = getHistory().map(h => h.key);
    const pick = pickMeal(currentCandidates, history);
    currentCandidates = currentCandidates.filter(c => c.key !== pick.key);

    currentMeal = await fetchMealDetail(pick);
    renderMeal(currentMeal);
    setStatus("");
  } catch (err) {
    setStatus("Something went wrong fetching a recipe. Try again.", true);
  } finally {
    findBtn.disabled = false;
    rerollBtn.disabled = false;
  }
}

async function getCandidates() {
  const cuisine = cuisineSelect.value;
  const category = categorySelect.value;

  if (!cuisine && !category) {
    const random = await fetchJson(`${MEALDB_API}/random.php`);
    return random.meals.map(normalizeMealDbSummary);
  }

  if (cuisine && category) {
    const [mealdbByArea, mealdbByCategory] = await Promise.all([
      fetchMealDbForCuisine(cuisine),
      fetchJson(`${MEALDB_API}/filter.php?c=${encodeURIComponent(category)}`),
    ]);
    const categoryIds = new Set((mealdbByCategory.meals || []).map(m => m.idMeal));
    return mealdbByArea.filter(m => categoryIds.has(m.id));
  }

  if (cuisine) {
    const [mealdbResults, spoonacularResults] = await Promise.all([
      fetchMealDbForCuisine(cuisine),
      fetchSpoonacularForCuisine(cuisine),
    ]);
    return [...mealdbResults, ...spoonacularResults];
  }

  const result = await fetchJson(`${MEALDB_API}/filter.php?c=${encodeURIComponent(category)}`);
  return (result.meals || []).map(normalizeMealDbSummary);
}

async function fetchMealDbForCuisine(cuisine) {
  const areas = CUISINE_GROUPS[cuisine]?.mealdb || [];
  if (areas.length === 0) return [];
  const results = await Promise.all(
    areas.map(a => fetchJson(`${MEALDB_API}/filter.php?a=${encodeURIComponent(a)}`))
  );
  const seen = new Set();
  const meals = [];
  for (const result of results) {
    for (const meal of result.meals || []) {
      const normalized = normalizeMealDbSummary(meal);
      if (!seen.has(normalized.key)) {
        seen.add(normalized.key);
        meals.push(normalized);
      }
    }
  }
  return meals;
}

async function fetchSpoonacularForCuisine(cuisine) {
  const cuisines = CUISINE_GROUPS[cuisine]?.spoonacular || [];
  if (cuisines.length === 0) return [];
  const results = await Promise.all(
    cuisines.map(c =>
      fetchJson(`${SPOONACULAR_API}/complexSearch?apiKey=${SPOONACULAR_KEY}&cuisine=${encodeURIComponent(c)}&number=20`)
    )
  );
  const seen = new Set();
  const meals = [];
  for (const result of results) {
    for (const item of result.results || []) {
      const normalized = normalizeSpoonacularSummary(item);
      if (!seen.has(normalized.key)) {
        seen.add(normalized.key);
        meals.push(normalized);
      }
    }
  }
  return meals;
}

function normalizeMealDbSummary(meal) {
  return { source: "mealdb", id: meal.idMeal, key: `mealdb:${meal.idMeal}`, title: meal.strMeal, image: meal.strMealThumb };
}

function normalizeSpoonacularSummary(recipe) {
  return { source: "spoonacular", id: String(recipe.id), key: `spoonacular:${recipe.id}`, title: recipe.title, image: recipe.image };
}

function pickMeal(candidates, historyKeys) {
  const fresh = candidates.filter(c => !historyKeys.slice(0, AVOID_LAST).includes(c.key));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function fetchMealDetail(pick) {
  if (pick.source === "mealdb") {
    const detail = await fetchJson(`${MEALDB_API}/lookup.php?i=${pick.id}`);
    return normalizeMealDbDetail(detail.meals[0]);
  }
  const detail = await fetchJson(`${SPOONACULAR_API}/${pick.id}/information?apiKey=${SPOONACULAR_KEY}&includeNutrition=false`);
  return normalizeSpoonacularDetail(detail);
}

function normalizeMealDbDetail(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const ing = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    if (ing && ing.trim()) {
      ingredients.push(`${measure ? measure.trim() + " " : ""}${ing.trim()}`);
    }
  }
  return {
    key: `mealdb:${meal.idMeal}`,
    title: meal.strMeal,
    image: meal.strMealThumb,
    area: meal.strArea,
    category: meal.strCategory,
    ingredients,
    instructions: meal.strInstructions,
    videoUrl: meal.strYoutube || null,
    sourceUrl: null,
  };
}

function normalizeSpoonacularDetail(meal) {
  const ingredients = (meal.extendedIngredients || []).map(i => i.original);
  let instructions = meal.instructions ? stripHtml(meal.instructions) : "";
  if (!instructions && meal.analyzedInstructions?.[0]?.steps) {
    instructions = meal.analyzedInstructions[0].steps.map(s => s.step).join("\n");
  }
  if (!instructions) instructions = "No instructions provided — check the original recipe link below.";
  return {
    key: `spoonacular:${meal.id}`,
    title: meal.title,
    image: meal.image,
    area: meal.cuisines?.[0] || "",
    category: meal.dishTypes?.[0] || "",
    ingredients,
    instructions,
    videoUrl: null,
    sourceUrl: meal.sourceUrl || null,
  };
}

function stripHtml(html) {
  return new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
}

function renderMeal(meal) {
  document.getElementById("mealImg").src = meal.image;
  document.getElementById("mealImg").alt = meal.title;
  document.getElementById("mealName").textContent = meal.title;
  document.getElementById("mealArea").textContent = meal.area;
  document.getElementById("mealCategory").textContent = meal.category;
  document.getElementById("instructions").textContent = meal.instructions;

  const ingredientsEl = document.getElementById("ingredients");
  ingredientsEl.innerHTML = "";
  meal.ingredients.forEach(text => {
    const li = document.createElement("li");
    li.textContent = text;
    ingredientsEl.appendChild(li);
  });

  const linkEl = document.getElementById("externalLink");
  if (meal.videoUrl) {
    linkEl.href = meal.videoUrl;
    linkEl.textContent = "Watch video";
    linkEl.classList.remove("hidden");
  } else if (meal.sourceUrl) {
    linkEl.href = meal.sourceUrl;
    linkEl.textContent = "View original recipe";
    linkEl.classList.remove("hidden");
  } else {
    linkEl.classList.add("hidden");
  }

  resultEl.classList.remove("hidden");
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function addToHistory(meal) {
  const history = getHistory();
  history.unshift({ key: meal.key, name: meal.title, date: new Date().toISOString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  renderHistory();
  setStatus(`Added "${meal.title}" to history. Enjoy!`);
}

function renderHistory() {
  const history = getHistory();
  historyListEl.innerHTML = "";
  if (history.length === 0) {
    historyListEl.innerHTML = "<li>Nothing cooked yet.</li>";
    return;
  }
  history.forEach(h => {
    const li = document.createElement("li");
    const date = new Date(h.date).toLocaleDateString();
    li.textContent = `${h.name} — ${date}`;
    historyListEl.appendChild(li);
  });
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}
