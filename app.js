const API = "https://www.themealdb.com/api/json/v1/1";
const HISTORY_KEY = "dinnerPickerHistory";
const HISTORY_LIMIT = 10;
const AVOID_LAST = 6; // how many recent picks to try to avoid repeating

// Curated cuisine groups. TheMealDB's free API only has recipes tagged
// against ~28 of its ~190 "area" values (checked directly against the API —
// e.g. American, French, Indian, and Korean currently return zero recipes),
// so each group below only combines areas that actually have data.
const CUISINE_GROUPS = {
  "Mexican": ["Mexican"],
  "Latin American": ["Uruguayan"],
  "Caribbean": ["Jamaican"],
  "Mediterranean": [
    "Spanish", "Italian", "Greek", "Turkish", "Tunisian", "Egyptian",
    "Moroccan", "Croatian", "Portuguese",
  ],
  "Italian": ["Italian"],
  "Chinese": ["Chinese"],
  "Japanese": ["Japanese"],
  "Thai": ["Thai"],
  "Southeast Asian": ["Vietnamese", "Malaysian", "Filipino"],
  "British & Irish": ["British", "Irish"],
  "Eastern European": ["Polish", "Russian", "Ukrainian"],
  "Middle Eastern & North African": [
    "Saudi Arabian", "Syrian", "Algerian", "Egyptian", "Tunisian", "Moroccan",
  ],
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
    const categories = await fetchJson(`${API}/list.php?c=list`);
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

    const history = getHistory().map(h => h.id);
    const pick = pickMeal(currentCandidates, history);
    currentCandidates = currentCandidates.filter(c => c.idMeal !== pick.idMeal);

    const detail = await fetchJson(`${API}/lookup.php?i=${pick.idMeal}`);
    currentMeal = detail.meals[0];
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
    const random = await fetchJson(`${API}/random.php`);
    return random.meals;
  }

  const byArea = cuisine ? await fetchMealsForCuisine(cuisine) : null;

  if (cuisine && category) {
    const byCategory = await fetchJson(`${API}/filter.php?c=${encodeURIComponent(category)}`);
    const categoryIds = new Set((byCategory.meals || []).map(m => m.idMeal));
    return byArea.filter(m => categoryIds.has(m.idMeal));
  }

  if (cuisine) return byArea;

  const result = await fetchJson(`${API}/filter.php?c=${encodeURIComponent(category)}`);
  return result.meals || [];
}

async function fetchMealsForCuisine(cuisine) {
  const areas = CUISINE_GROUPS[cuisine] || [cuisine];
  const results = await Promise.all(
    areas.map(a => fetchJson(`${API}/filter.php?a=${encodeURIComponent(a)}`))
  );
  const seen = new Set();
  const meals = [];
  for (const result of results) {
    for (const meal of result.meals || []) {
      if (!seen.has(meal.idMeal)) {
        seen.add(meal.idMeal);
        meals.push(meal);
      }
    }
  }
  return meals;
}

function pickMeal(candidates, historyIds) {
  const fresh = candidates.filter(c => !historyIds.slice(0, AVOID_LAST).includes(c.idMeal));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

function renderMeal(meal) {
  document.getElementById("mealImg").src = meal.strMealThumb;
  document.getElementById("mealImg").alt = meal.strMeal;
  document.getElementById("mealName").textContent = meal.strMeal;
  document.getElementById("mealArea").textContent = meal.strArea;
  document.getElementById("mealCategory").textContent = meal.strCategory;
  document.getElementById("instructions").textContent = meal.strInstructions;

  const ingredientsEl = document.getElementById("ingredients");
  ingredientsEl.innerHTML = "";
  for (let i = 1; i <= 20; i++) {
    const ing = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    if (ing && ing.trim()) {
      const li = document.createElement("li");
      li.textContent = `${measure ? measure.trim() + " " : ""}${ing.trim()}`;
      ingredientsEl.appendChild(li);
    }
  }

  const ytLink = document.getElementById("youtubeLink");
  if (meal.strYoutube) {
    ytLink.href = meal.strYoutube;
    ytLink.classList.remove("hidden");
  } else {
    ytLink.classList.add("hidden");
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
  history.unshift({ id: meal.idMeal, name: meal.strMeal, date: new Date().toISOString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  renderHistory();
  setStatus(`Added "${meal.strMeal}" to history. Enjoy!`);
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
