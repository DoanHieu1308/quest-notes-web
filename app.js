const API_BASE_URL =
  localStorage.getItem('questApiBaseUrl') ||
  window.QUEST_NOTES_API_BASE_URL ||
  'http://localhost:3000/api';
const STATE_KEY = 'quest_notes_state_v1';
const PENDING_KEY = 'quest_notes_pending_sync_v1';

let state = loadLocalState();
let selectedDate = todayKey();
let selectedDeckId = state.flashDecks[0]?.id || 'default-flashcard-deck';

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  $('taskDate').value = selectedDate;
  bindEvents();
  render();
  await syncFromServer();
});

function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => selectView(tab.dataset.view));
  });

  $('taskDate').addEventListener('change', (event) => {
    selectedDate = event.target.value || todayKey();
    renderTasks();
  });

  $('taskForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('taskTitle').value.trim();
    if (!title) return;
    state.tasks.push({
      id: newId(),
      title,
      dateKey: selectedDate,
      reward: positiveInt($('taskReward').value, 10),
      done: false,
    });
    $('taskTitle').value = '';
    persistAndSync();
  });

  $('shopForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('shopName').value.trim();
    if (!name) return;
    state.shopItems.push({
      id: newId(),
      name,
      price: positiveInt($('shopPrice').value, 50),
      note: $('shopNote').value.trim(),
      bought: false,
    });
    event.target.reset();
    $('shopPrice').value = 50;
    persistAndSync();
  });

  $('deckForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('deckName').value.trim();
    if (!name) return;
    const deck = {
      id: newId(),
      name,
      createdAt: Date.now(),
      rewardClaimed: false,
    };
    state.flashDecks.push(deck);
    selectedDeckId = deck.id;
    $('deckName').value = '';
    persistAndSync();
  });

  $('cardForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const front = $('cardFront').value.trim();
    const back = $('cardBack').value.trim();
    if (!front || !back) return;
    state.flashCards.push({
      id: newId(),
      deckId: selectedDeckId,
      front,
      back,
      mastered: false,
    });
    $('cardFront').value = '';
    $('cardBack').value = '';
    persistAndSync();
  });

  window.addEventListener('online', syncFromServer);
}

function selectView(view) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `${view}View`);
  });
}

function render() {
  $('coinCount').textContent = state.coins;
  renderTasks();
  renderShop();
  renderFlashcards();
}

function renderTasks() {
  const list = $('taskList');
  const tasks = state.tasks
    .filter((task) => task.dateKey === selectedDate)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.title.localeCompare(b.title));

  list.innerHTML = tasks.length
    ? ''
    : '<div class="item"><span class="meta">Chua co nhiem vu cho ngay nay.</span></div>';

  tasks.forEach((task) => {
    const row = document.createElement('div');
    row.className = `item ${task.done ? 'done' : ''}`;
    row.innerHTML = `
      <input type="checkbox" ${task.done ? 'checked' : ''} aria-label="Done" />
      <div>
        <div class="title"></div>
        <div class="meta">${task.reward} xu</div>
      </div>
      <button class="ghost">Sua</button>
      <button class="danger">Xoa</button>
    `;
    row.querySelector('.title').textContent = task.title;
    row.querySelector('input').addEventListener('change', (event) => toggleTask(task.id, event.target.checked));
    row.querySelector('.ghost').addEventListener('click', () => editTask(task.id));
    row.querySelector('.danger').addEventListener('click', () => deleteTask(task.id));
    list.appendChild(row);
  });
}

function renderShop() {
  const list = $('shopList');
  list.innerHTML = state.shopItems.length
    ? ''
    : '<div class="item"><span class="meta">Chua co phan thuong.</span></div>';

  state.shopItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = `item ${item.bought ? 'done' : ''}`;
    row.innerHTML = `
      <span class="meta">${item.bought ? 'Da doi' : 'Moi'}</span>
      <div>
        <div class="title"></div>
        <div class="meta"></div>
      </div>
      <button class="ghost">Doi</button>
      <button class="danger">Xoa</button>
    `;
    row.querySelector('.title').textContent = item.name;
    row.querySelectorAll('.meta')[1].textContent = `${item.price} xu${item.note ? ` - ${item.note}` : ''}`;
    row.querySelector('.ghost').addEventListener('click', () => buyItem(item.id));
    row.querySelector('.danger').addEventListener('click', () => deleteShopItem(item.id));
    list.appendChild(row);
  });
}

function renderFlashcards() {
  const deckList = $('deckList');
  deckList.innerHTML = '';
  state.flashDecks.forEach((deck) => {
    const button = document.createElement('button');
    button.className = `deck ${deck.id === selectedDeckId ? 'active' : ''}`;
    button.textContent = deck.name;
    button.addEventListener('click', () => {
      selectedDeckId = deck.id;
      renderFlashcards();
    });
    deckList.appendChild(button);
  });

  const cards = state.flashCards.filter((card) => card.deckId === selectedDeckId);
  const list = $('cardList');
  list.innerHTML = cards.length
    ? ''
    : '<div class="item"><span class="meta">Chua co flashcard trong bo nay.</span></div>';

  cards.forEach((card) => {
    const row = document.createElement('div');
    row.className = `item ${card.mastered ? 'done' : ''}`;
    row.innerHTML = `
      <input type="checkbox" ${card.mastered ? 'checked' : ''} aria-label="Mastered" />
      <div>
        <div class="title"></div>
        <div class="meta"></div>
      </div>
      <button class="ghost">Thuong</button>
      <button class="danger">Xoa</button>
    `;
    row.querySelector('.title').textContent = card.front;
    row.querySelector('.meta').textContent = card.back;
    row.querySelector('input').addEventListener('change', () => toggleCard(card.id));
    row.querySelector('.ghost').addEventListener('click', claimDeckReward);
    row.querySelector('.danger').addEventListener('click', () => deleteCard(card.id));
    list.appendChild(row);
  });
}

function toggleTask(id, done) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.done === done) return;
  task.done = done;
  state.coins = Math.max(0, state.coins + (done ? task.reward : -task.reward));
  persistAndSync();
}

function editTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  const title = window.prompt('Sua nhiem vu', task.title);
  if (!title?.trim()) return;
  const reward = window.prompt('So xu', String(task.reward));
  task.title = title.trim();
  task.reward = positiveInt(reward, task.reward);
  persistAndSync();
}

function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (task?.done) state.coins = Math.max(0, state.coins - task.reward);
  state.tasks = state.tasks.filter((item) => item.id !== id);
  persistAndSync();
}

function buyItem(id) {
  const item = state.shopItems.find((entry) => entry.id === id);
  if (!item || item.bought || state.coins < item.price) return;
  item.bought = true;
  state.coins -= item.price;
  persistAndSync();
}

function deleteShopItem(id) {
  state.shopItems = state.shopItems.filter((item) => item.id !== id);
  persistAndSync();
}

function toggleCard(id) {
  const card = state.flashCards.find((item) => item.id === id);
  if (!card) return;
  card.mastered = !card.mastered;
  persistAndSync();
}

function deleteCard(id) {
  state.flashCards = state.flashCards.filter((card) => card.id !== id);
  persistAndSync();
}

function claimDeckReward() {
  const deck = state.flashDecks.find((item) => item.id === selectedDeckId);
  const cards = state.flashCards.filter((card) => card.deckId === selectedDeckId);
  if (!deck || deck.rewardClaimed || cards.length === 0 || cards.some((card) => !card.mastered)) return;
  state.coins += Math.max(20, cards.length * 5);
  deck.rewardClaimed = true;
  persistAndSync();
}

async function persistAndSync() {
  saveLocalState();
  localStorage.setItem(PENDING_KEY, '1');
  render();
  await pushState();
}

async function syncFromServer() {
  if (localStorage.getItem(PENDING_KEY) === '1') {
    await pushState();
    return;
  }

  try {
    setSyncStatus('Dang dong bo...', 'pending');
    const response = await fetch(`${API_BASE_URL}/quest/state`);
    if (!response.ok) throw new Error('Request failed');
    const payload = await response.json();
    state = normalizeState(payload.data);
    ensureSelectedDeck();
    saveLocalState();
    setSyncStatus('Da dong bo', 'online');
    render();
  } catch {
    setSyncStatus('Offline - dung du lieu may nay', 'offline');
  }
}

async function pushState() {
  try {
    setSyncStatus('Dang day thay doi...', 'pending');
    const response = await fetch(`${API_BASE_URL}/quest/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    if (!response.ok) throw new Error('Request failed');
    const payload = await response.json();
    state = normalizeState(payload.data);
    ensureSelectedDeck();
    saveLocalState();
    localStorage.removeItem(PENDING_KEY);
    setSyncStatus('Da dong bo', 'online');
    render();
  } catch {
    setSyncStatus('Offline - se dong bo sau', 'offline');
  }
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeState({});
  }
}

function saveLocalState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function normalizeState(raw = {}) {
  return {
    coins: positiveInt(raw.coins, 0),
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    shopItems: Array.isArray(raw.shopItems) ? raw.shopItems : [],
    flashDecks: Array.isArray(raw.flashDecks) && raw.flashDecks.length
      ? raw.flashDecks
      : [{ id: 'default-flashcard-deck', name: 'Tu vung chung', createdAt: 0, rewardClaimed: false }],
    flashCards: Array.isArray(raw.flashCards) ? raw.flashCards : [],
  };
}

function ensureSelectedDeck() {
  if (!state.flashDecks.some((deck) => deck.id === selectedDeckId)) {
    selectedDeckId = state.flashDecks[0]?.id || 'default-flashcard-deck';
  }
}

function setSyncStatus(text, status) {
  $('syncText').textContent = text;
  $('syncDot').className = `sync-dot ${status === 'online' ? 'online' : status === 'offline' ? 'offline' : ''}`;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
