const API_BASE_URL =
  localStorage.getItem('questApiBaseUrl') ||
  window.QUEST_NOTES_API_BASE_URL ||
  'http://localhost:3000/api';
const STATE_KEY = 'quest_notes_state_v1';
const PENDING_KEY = 'quest_notes_pending_sync_v1';

let state = loadLocalState();
let selectedDate = todayKey();
let selectedDeckId = state.flashDecks[0]?.id || 'default-flashcard-deck';
let currentCardIndex = 0;
let showingBack = false;
let editingShopId = null;

const $ = (id) => document.getElementById(id);
const weekdays = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

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

  $('prevDate').addEventListener('click', () => shiftDate(-1));
  $('nextDate').addEventListener('click', () => shiftDate(1));
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
      reward: positiveInt($('taskReward').value, 20),
      done: false,
    });
    $('taskTitle').value = '';
    persistAndSync();
  });

  $('shopForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveShopItem();
  });
  $('shopCancel').addEventListener('click', clearShopForm);

  $('deckForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('deckName').value.trim();
    if (!name) return;
    const deck = { id: newId(), name, createdAt: Date.now(), rewardClaimed: false };
    state.flashDecks.push(deck);
    selectedDeckId = deck.id;
    currentCardIndex = 0;
    showingBack = false;
    $('deckName').value = '';
    persistAndSync();
  });

  $('cardForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const front = $('cardFront').value.trim();
    const back = $('cardBack').value.trim();
    if (!front || !back) return;
    addCards([{ front, back }]);
    $('cardFront').value = '';
    $('cardBack').value = '';
  });

  $('bulkCardForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const cards = parseRawCards($('bulkCards').value);
    if (!cards.length) {
      showToast('Đúng mẫu: từ vựng : nghĩa, mỗi dòng một thẻ.');
      return;
    }
    addCards(cards);
    $('bulkCards').value = '';
  });

  $('toggleImportMenu').addEventListener('click', toggleImportMenu);
  $('excelInput').addEventListener('change', importExcelCards);
  $('flashCard').addEventListener('click', flipCard);
  $('flashCard').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flipCard();
    }
  });
  $('prevCard').addEventListener('click', () => moveCard(-1));
  $('nextCard').addEventListener('click', () => moveCard(1));
  $('toggleMastered').addEventListener('click', toggleCurrentCardMastered);
  $('deleteCard').addEventListener('click', deleteCurrentCard);
  $('claimDeckReward').addEventListener('click', claimDeckReward);

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
  const selected = new Date(`${selectedDate}T00:00:00`);
  $('weekdayLabel').textContent = weekdays[selected.getDay()] || 'Hôm nay';
  $('taskDate').value = selectedDate;

  const tasks = tasksForSelectedDate();
  const completed = tasks.filter((task) => task.done).length;
  const progress = tasks.length ? completed / tasks.length : 0;
  $('taskProgressBar').style.width = `${progress * 100}%`;
  $('taskProgressText').textContent = `Hoàn thành ${completed}/${tasks.length} nhiệm vụ`;

  const list = $('taskList');
  list.innerHTML = tasks.length ? '' : '<div class="empty">Chưa có nhiệm vụ cho ngày này.</div>';

  tasks.forEach((task) => {
    const row = document.createElement('article');
    row.className = `quest-item ${task.done ? 'done' : ''}`;
    row.innerHTML = `
      <button class="quest-toggle" type="button" aria-label="Đổi trạng thái nhiệm vụ">${task.done ? '✓' : '!'}</button>
      <div>
        <div class="pill-row">
          <span class="pill">${task.done ? 'XONG' : 'NHIỆM VỤ'}</span>
          <span class="pill gold">${task.reward} xu</span>
        </div>
        <div class="title"></div>
        <div class="meta">${task.done ? 'Phần thưởng đã nhận' : 'Hoàn thành để thu thập xu'}</div>
      </div>
      <div class="row-actions">
        <button class="ghost edit" type="button">Sửa</button>
        <button class="ghost copy" type="button">Sao chép</button>
        <button class="danger delete" type="button">Xóa</button>
      </div>
    `;
    row.querySelector('.title').textContent = task.title;
    row.querySelector('.quest-toggle').addEventListener('click', () => toggleTask(task.id, !task.done));
    row.querySelector('.edit').addEventListener('click', () => editTask(task.id));
    row.querySelector('.copy').addEventListener('click', () => copyTask(task.id));
    row.querySelector('.delete').addEventListener('click', () => deleteTask(task.id));
    list.appendChild(row);
  });
}

function renderShop() {
  const list = $('shopList');
  list.innerHTML = state.shopItems.length ? '' : '<div class="empty">Cửa hàng đang trống.</div>';

  state.shopItems.forEach((item) => {
    const row = document.createElement('article');
    row.className = `plain-item ${item.bought ? 'done' : ''}`;
    row.innerHTML = `
      <span class="plain-icon">${item.bought ? 'OK' : 'G'}</span>
      <div>
        <div class="title"></div>
        <div class="meta"></div>
      </div>
      <div class="row-actions">
        <button class="gold-button buy" type="button">${item.bought ? 'Đã đổi' : 'Đổi'}</button>
        <button class="ghost edit" type="button">Sửa</button>
        <button class="danger delete" type="button">Xóa</button>
      </div>
    `;
    row.querySelector('.title').textContent = item.name;
    row.querySelector('.meta').textContent = `${item.price} xu${item.note ? ` - ${item.note}` : ''}`;
    row.querySelector('.buy').disabled = item.bought;
    row.querySelector('.buy').addEventListener('click', () => buyItem(item.id));
    row.querySelector('.edit').addEventListener('click', () => editShopItem(item.id));
    row.querySelector('.delete').addEventListener('click', () => deleteShopItem(item.id));
    list.appendChild(row);
  });
}

function renderFlashcards() {
  ensureSelectedDeck();
  const deckList = $('deckList');
  deckList.innerHTML = '';

  state.flashDecks.forEach((deck) => {
    const cards = cardsForDeck(deck.id);
    const mastered = cards.filter((card) => card.mastered).length;
    const row = document.createElement('div');
    row.className = `deck ${deck.id === selectedDeckId ? 'active' : ''}`;
    row.innerHTML = `
      <button class="ghost open" type="button">
        <strong></strong>
        <span class="meta">${mastered}/${cards.length} thẻ</span>
      </button>
      <button class="ghost edit" type="button">Sửa</button>
      <button class="danger delete" type="button">Xóa</button>
    `;
    row.querySelector('strong').textContent = deck.name;
    row.querySelector('.open').addEventListener('click', () => {
      selectedDeckId = deck.id;
      currentCardIndex = 0;
      showingBack = false;
      renderFlashcards();
    });
    row.querySelector('.edit').addEventListener('click', () => editDeck(deck.id));
    row.querySelector('.delete').disabled = state.flashDecks.length <= 1;
    row.querySelector('.delete').addEventListener('click', () => deleteDeck(deck.id));
    deckList.appendChild(row);
  });

  const deck = state.flashDecks.find((item) => item.id === selectedDeckId);
  const cards = cardsForDeck(selectedDeckId);
  if (currentCardIndex >= cards.length) currentCardIndex = Math.max(0, cards.length - 1);
  const card = cards[currentCardIndex];
  const mastered = cards.filter((item) => item.mastered).length;
  const complete = cards.length > 0 && mastered === cards.length;
  const reward = rewardForCards(cards.length);
  const canClaim = Boolean(deck && complete && !deck.rewardClaimed);

  $('activeDeckName').textContent = deck?.name || 'Từ vựng chung';
  $('deckProgressText').textContent = `Tiến độ ${mastered}/${cards.length} thẻ`;
  $('deckRewardText').textContent = deck?.rewardClaimed
    ? 'Đã nhận thưởng bộ này'
    : `Hoàn thành bộ để nhận ${reward} xu`;
  $('deckProgressBar').style.width = `${cards.length ? (mastered / cards.length) * 100 : 0}%`;
  $('claimDeckReward').disabled = !canClaim;
  $('claimDeckReward').textContent = deck?.rewardClaimed ? 'Đã nhận' : 'Nhận xu';

  $('flashCard').classList.toggle('flipped', showingBack);
  $('flashFront').textContent = card?.front || 'Chưa có thẻ';
  $('flashBack').textContent = card?.back || 'Hãy thêm từ vựng';
  $('cardCounter').textContent = cards.length ? `${currentCardIndex + 1}/${cards.length}` : '0/0';
  $('prevCard').disabled = currentCardIndex <= 0;
  $('nextCard').disabled = currentCardIndex >= cards.length - 1;
  $('toggleMastered').disabled = !card;
  $('deleteCard').disabled = !card;
  $('toggleMastered').textContent = 'Đã thuộc';
  $('toggleMastered').classList.toggle('active', Boolean(card?.mastered));
  $('toggleMastered').setAttribute('aria-pressed', String(Boolean(card?.mastered)));

  const list = $('cardList');
  list.innerHTML = cards.length ? '' : '<div class="empty">Bộ này đang trống. Nhập theo mẫu từ vựng : nghĩa để bắt đầu.</div>';
  cards.forEach((item, index) => {
    const row = document.createElement('article');
    row.className = `mini-card ${index === currentCardIndex ? 'active' : ''}`;
    row.innerHTML = `
      <button class="mini-open" type="button">
        <span class="pill gold">${item.mastered ? 'OK' : index + 1}</span>
        <strong></strong>
        <span class="meta">${item.mastered ? 'Đã thuộc' : 'Đang học'}</span>
      </button>
      <details class="mini-menu">
        <summary aria-label="Thao tác thẻ">⋮</summary>
        <div class="mini-menu-panel">
          <button class="ghost edit-card" type="button">Sửa</button>
          <button class="danger delete-card" type="button">Xóa</button>
        </div>
      </details>
    `;
    row.querySelector('strong').textContent = item.front;
    row.querySelector('.mini-open').addEventListener('click', () => {
      currentCardIndex = index;
      showingBack = false;
      renderFlashcards();
    });
    row.querySelector('.edit-card').addEventListener('click', () => editFlashCard(item.id));
    row.querySelector('.delete-card').addEventListener('click', () => deleteFlashCard(item.id));
    list.appendChild(row);
  });
}

function tasksForSelectedDate() {
  return state.tasks
    .filter((task) => task.dateKey === selectedDate)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.title.localeCompare(b.title));
}

function shiftDate(days) {
  const date = new Date(`${selectedDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  selectedDate = date.toISOString().slice(0, 10);
  renderTasks();
}

function toggleTask(id, done) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.done === done) return;
  task.done = done;
  state.coins = Math.max(0, state.coins + (done ? task.reward : -task.reward));
  if (done) showCoinBurst(task.reward);
  persistAndSync();
}

function editTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  const title = window.prompt('Sửa nhiệm vụ', task.title);
  if (!title?.trim()) return;
  const reward = window.prompt('Số xu', String(task.reward));
  const oldReward = task.reward;
  task.title = title.trim();
  task.reward = positiveInt(reward, task.reward);
  if (task.done) state.coins = Math.max(0, state.coins - oldReward + task.reward);
  persistAndSync();
}

function copyTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  const targetDate = window.prompt('Sao chép sang ngày (YYYY-MM-DD)', nextDayKey(selectedDate));
  if (!isDateKey(targetDate)) return;
  state.tasks.push({
    id: newId(),
    title: task.title,
    dateKey: targetDate,
    reward: task.reward,
    done: false,
  });
  showToast(`Đã sao chép sang ${targetDate}.`);
  persistAndSync();
}

function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (task?.done) state.coins = Math.max(0, state.coins - task.reward);
  state.tasks = state.tasks.filter((item) => item.id !== id);
  persistAndSync();
}

function saveShopItem() {
  const name = $('shopName').value.trim();
  if (!name) return;
  const payload = {
    name,
    price: positiveInt($('shopPrice').value, 50),
    note: $('shopNote').value.trim(),
  };

  if (editingShopId) {
    const item = state.shopItems.find((entry) => entry.id === editingShopId);
    if (item) Object.assign(item, payload);
  } else {
    state.shopItems.push({ id: newId(), ...payload, bought: false });
  }

  clearShopForm();
  persistAndSync();
}

function editShopItem(id) {
  const item = state.shopItems.find((entry) => entry.id === id);
  if (!item) return;
  editingShopId = id;
  $('shopName').value = item.name;
  $('shopPrice').value = item.price;
  $('shopNote').value = item.note;
  $('shopSubmit').textContent = 'Lưu';
  $('shopCancel').classList.remove('hidden');
  $('shopName').focus();
}

function clearShopForm() {
  editingShopId = null;
  $('shopForm').reset();
  $('shopPrice').value = 50;
  $('shopCancel').classList.add('hidden');
}

function buyItem(id) {
  const item = state.shopItems.find((entry) => entry.id === id);
  if (!item || item.bought) return;
  if (state.coins < item.price) {
    showToast('Chưa đủ xu để đổi vật phẩm này.');
    return;
  }
  item.bought = true;
  state.coins -= item.price;
  persistAndSync();
}

function deleteShopItem(id) {
  state.shopItems = state.shopItems.filter((item) => item.id !== id);
  persistAndSync();
}

function editDeck(id) {
  const deck = state.flashDecks.find((item) => item.id === id);
  if (!deck) return;
  const name = window.prompt('Sửa tên bộ flashcard', deck.name);
  if (!name?.trim()) return;
  deck.name = name.trim();
  persistAndSync();
}

function deleteDeck(id) {
  if (state.flashDecks.length <= 1) return;
  state.flashDecks = state.flashDecks.filter((deck) => deck.id !== id);
  state.flashCards = state.flashCards.filter((card) => card.deckId !== id);
  ensureSelectedDeck();
  currentCardIndex = 0;
  showingBack = false;
  persistAndSync();
}

function editFlashCard(id) {
  const card = state.flashCards.find((item) => item.id === id);
  if (!card) return;
  const front = window.prompt('Sửa từ vựng', card.front);
  if (!front?.trim()) return;
  const back = window.prompt('Sửa nghĩa', card.back);
  if (!back?.trim()) return;
  card.front = front.trim();
  card.back = back.trim();
  persistAndSync();
}

function deleteFlashCard(id) {
  const card = state.flashCards.find((item) => item.id === id);
  if (!card) return;
  state.flashCards = state.flashCards.filter((item) => item.id !== id);
  const cards = cardsForDeck(selectedDeckId);
  currentCardIndex = Math.min(currentCardIndex, Math.max(0, cards.length - 1));
  showingBack = false;
  persistAndSync();
}

function addCards(cards) {
  const normalized = cards
    .map((card) => ({ front: card.front.trim(), back: card.back.trim() }))
    .filter((card) => card.front && card.back);
  if (!normalized.length) return;
  state.flashCards.push(
    ...normalized.map((card) => ({
      id: newId(),
      deckId: selectedDeckId,
      front: card.front,
      back: card.back,
      mastered: false,
    })),
  );
  const deck = state.flashDecks.find((item) => item.id === selectedDeckId);
  if (deck) deck.rewardClaimed = false;
  showToast(`Đã nhập ${normalized.length} flashcard.`);
  setImportMenuOpen(false);
  persistAndSync();
}

function toggleImportMenu() {
  setImportMenuOpen($('importMenu').classList.contains('hidden'));
}

function setImportMenuOpen(open) {
  $('importMenu').classList.toggle('hidden', !open);
  $('toggleImportMenu').setAttribute('aria-expanded', String(open));
}

function parseRawCards(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes(':') ? ':' : line.includes('\t') ? '\t' : ',';
      const [front, ...rest] = line.split(separator);
      return { front: front || '', back: rest.join(separator) || '' };
    })
    .filter((card) => card.front.trim() && card.back.trim());
}

async function importExcelCards(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!window.XLSX) {
    showToast('Thư viện đọc Excel chưa tải xong. Thử lại sau vài giây.');
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const cards = [];
    workbook.SheetNames.forEach((sheetName) => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: '',
      });
      rows.forEach((row) => {
        const values = row.map((value) => String(value).trim()).filter(Boolean);
        if (!values.length) return;
        if (values.length >= 2) {
          cards.push({ front: values[0], back: values[1] });
        } else if (values[0].includes(':')) {
          cards.push(...parseRawCards(values[0]));
        }
      });
    });
    if (!cards.length) {
      showToast('Không tìm thấy cặp từ vựng/nghĩa trong Excel.');
      return;
    }
    addCards(cards);
  } catch {
    showToast('Không thể đọc file Excel.');
  }
}

function flipCard() {
  if (!cardsForDeck(selectedDeckId).length) return;
  showingBack = !showingBack;
  renderFlashcards();
}

function moveCard(direction) {
  const cards = cardsForDeck(selectedDeckId);
  currentCardIndex = Math.min(Math.max(currentCardIndex + direction, 0), Math.max(0, cards.length - 1));
  showingBack = false;
  renderFlashcards();
}

function toggleCurrentCardMastered() {
  const card = cardsForDeck(selectedDeckId)[currentCardIndex];
  if (!card) return;
  card.mastered = !card.mastered;
  persistAndSync();
}

function deleteCurrentCard() {
  const card = cardsForDeck(selectedDeckId)[currentCardIndex];
  if (!card) return;
  state.flashCards = state.flashCards.filter((item) => item.id !== card.id);
  currentCardIndex = Math.max(0, currentCardIndex - 1);
  showingBack = false;
  persistAndSync();
}

function claimDeckReward() {
  const deck = state.flashDecks.find((item) => item.id === selectedDeckId);
  const cards = cardsForDeck(selectedDeckId);
  if (!deck || deck.rewardClaimed || cards.length === 0 || cards.some((card) => !card.mastered)) return;
  const reward = rewardForCards(cards.length);
  state.coins += reward;
  deck.rewardClaimed = true;
  showCoinBurst(reward);
  showToast(`Đã nhận ${reward} xu cho bộ học này.`);
  persistAndSync();
}

function cardsForDeck(deckId) {
  return state.flashCards.filter((card) => card.deckId === deckId);
}

function rewardForCards(total) {
  return Math.max(20, total * 5);
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
    setSyncStatus('Đang đồng bộ...', 'pending');
    const response = await fetch(`${API_BASE_URL}/quest/state`);
    if (!response.ok) throw new Error('Request failed');
    const payload = await response.json();
    state = normalizeState(payload.data);
    ensureSelectedDeck();
    saveLocalState();
    setSyncStatus('Đã đồng bộ', 'online');
    render();
  } catch {
    setSyncStatus('Offline - dùng dữ liệu máy này', 'offline');
  }
}

async function pushState() {
  try {
    setSyncStatus('Đang đẩy thay đổi...', 'pending');
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
    setSyncStatus('Đã đồng bộ', 'online');
    render();
  } catch {
    setSyncStatus('Offline - sẽ đồng bộ sau', 'offline');
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
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : [],
    shopItems: Array.isArray(raw.shopItems) ? raw.shopItems.map(normalizeShopItem) : [],
    flashDecks: Array.isArray(raw.flashDecks) && raw.flashDecks.length
      ? raw.flashDecks.map(normalizeDeck)
      : [{ id: 'default-flashcard-deck', name: 'Từ vựng chung', createdAt: 0, rewardClaimed: false }],
    flashCards: Array.isArray(raw.flashCards) ? raw.flashCards.map(normalizeCard) : [],
  };
}

function normalizeTask(task = {}) {
  return {
    id: String(task.id || newId()),
    title: String(task.title || ''),
    dateKey: String(task.dateKey || todayKey()),
    reward: Math.max(1, positiveInt(task.reward, 20)),
    done: Boolean(task.done),
  };
}

function normalizeShopItem(item = {}) {
  return {
    id: String(item.id || newId()),
    name: String(item.name || ''),
    price: Math.max(1, positiveInt(item.price, 50)),
    note: String(item.note || ''),
    bought: Boolean(item.bought),
  };
}

function normalizeDeck(deck = {}) {
  return {
    id: String(deck.id || newId()),
    name: String(deck.name || 'Từ vựng chung'),
    createdAt: Number.parseInt(deck.createdAt, 10) || 0,
    rewardClaimed: Boolean(deck.rewardClaimed),
  };
}

function normalizeCard(card = {}) {
  return {
    id: String(card.id || newId()),
    deckId: String(card.deckId || 'default-flashcard-deck'),
    front: String(card.front || ''),
    back: String(card.back || ''),
    mastered: Boolean(card.mastered),
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

function showToast(text) {
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function showCoinBurst(amount) {
  const burst = $('coinBurst');
  burst.innerHTML = '';
  for (let index = 0; index < 14; index += 1) {
    const coin = document.createElement('span');
    coin.className = 'coin-pop';
    coin.textContent = '+';
    const angle = (Math.PI * 2 * index) / 14;
    const distance = 70 + Math.random() * 80;
    coin.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    coin.style.setProperty('--y', `${Math.sin(angle) * distance - 90}px`);
    burst.appendChild(coin);
  }
  showToast(`+${amount} xu`);
  window.setTimeout(() => {
    burst.innerHTML = '';
  }, 900);
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

function nextDayKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}
