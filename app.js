const API_BASE_URL =
  localStorage.getItem('questApiBaseUrl') ||
  window.QUEST_NOTES_API_BASE_URL ||
  'https://quest-notes-be.vercel.app/api';
const STATE_KEY = 'quest_notes_state_v1';
const PENDING_KEY = 'quest_notes_pending_sync_v1';

let state = loadLocalState();
let selectedDate = todayKey();
let selectedDeckId = state.flashDecks[0]?.id || 'default-flashcard-deck';
let currentCardIndex = 0;
let showingBack = false;
let showingMeaning = false;
let editingShopId = null;
let activeActionButton = null;

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
    runActionWithLoading(event.submitter, async () => {
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
      await persistAndSync();
    });
  });

  $('shopForm').addEventListener('submit', (event) => {
    event.preventDefault();
    runActionWithLoading(event.submitter, () => saveShopItem());
  });
  $('shopCancel').addEventListener('click', clearShopForm);

  $('deckForm').addEventListener('submit', (event) => {
    event.preventDefault();
    runActionWithLoading(event.submitter, async () => {
      const name = $('deckName').value.trim();
      if (!name) return;
      const deck = { id: newId(), name, createdAt: Date.now(), rewardClaimed: false };
      state.flashDecks.push(deck);
      selectedDeckId = deck.id;
      currentCardIndex = 0;
      showingBack = false;
      showingMeaning = false;
      $('deckName').value = '';
      await persistAndSync();
    });
  });

  $('cardForm').addEventListener('submit', (event) => {
    event.preventDefault();
    runActionWithLoading(event.submitter, async () => {
      const front = $('cardFront').value.trim();
      const frontPhonetic = $('cardFrontPhonetic').value.trim();
      const back = $('cardBack').value.trim();
      const backPhonetic = $('cardBackPhonetic').value.trim();
      const meaning = $('cardMeaning').value.trim();
      const hasFront = Boolean(front || frontPhonetic);
      const hasBack = Boolean(back || backPhonetic || meaning);
      if (!hasFront || !hasBack) return;
      if (hasFlashcardFront(selectedDeckId, front, frontPhonetic)) {
        showToast(`Từ "${front || frontPhonetic}" đã có trong bộ này.`);
        return;
      }
      await addCards([{ frontText: front, frontPhonetic, backText: back, backPhonetic, meaning }], { single: true });
      $('cardFront').value = '';
      $('cardFrontPhonetic').value = '';
      $('cardBack').value = '';
      $('cardBackPhonetic').value = '';
      $('cardMeaning').value = '';
    });
  });

  $('bulkCardForm').addEventListener('submit', (event) => {
    event.preventDefault();
    runActionWithLoading(event.submitter, async () => {
      const cards = parseRawCards($('bulkCards').value);
      if (!cards.length) {
        showToast('Đúng mẫu: từ vựng : nghĩa : phiên âm, mỗi dòng một thẻ.');
        return;
      }
      await addCards(cards);
      $('bulkCards').value = '';
    });
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
  $('toggleMeaning').addEventListener('click', (event) => {
    event.stopPropagation();
    showingMeaning = !showingMeaning;
    renderFlashcards();
  });
  $('toggleMastered').addEventListener('click', (event) => {
    runActionWithLoading(event.currentTarget, toggleCurrentCardMastered);
  });
  $('deleteCard').addEventListener('click', (event) => {
    runActionWithLoading(event.currentTarget, deleteCurrentCard);
  });
  $('claimDeckReward').addEventListener('click', (event) => {
    runActionWithLoading(event.currentTarget, claimDeckReward);
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
    row.querySelector('.quest-toggle').addEventListener('click', (event) => {
      runActionWithLoading(event.currentTarget, () => toggleTask(task.id, !task.done));
    });
    row.querySelector('.edit').addEventListener('click', () => editTask(task.id));
    row.querySelector('.copy').addEventListener('click', () => copyTask(task.id));
    row.querySelector('.delete').addEventListener('click', (event) => {
      runActionWithLoading(event.currentTarget, () => deleteTask(task.id));
    });
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
    row.querySelector('.buy').addEventListener('click', (event) => {
      runActionWithLoading(event.currentTarget, () => buyItem(item.id));
    });
    row.querySelector('.edit').addEventListener('click', () => editShopItem(item.id));
    row.querySelector('.delete').addEventListener('click', (event) => {
      runActionWithLoading(event.currentTarget, () => deleteShopItem(item.id));
    });
    list.appendChild(row);
  });
}

function renderFlashFace(element, card, backSide) {
  if (!card) {
    element.textContent = backSide ? 'Hãy thêm từ vựng' : 'Chưa có thẻ';
    return;
  }
  const text = backSide ? card.backText : card.frontText;
  const phonetic = backSide ? card.backPhonetic : card.frontPhonetic;
  element.textContent = phonetic ? `${text}\n[${stripOuterBrackets(phonetic)}]` : text;
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
      showingMeaning = false;
      renderFlashcards();
    });
    row.querySelector('.edit').addEventListener('click', () => editDeck(deck.id));
    row.querySelector('.delete').disabled = state.flashDecks.length <= 1;
    row.querySelector('.delete').addEventListener('click', (event) => {
      runActionWithLoading(event.currentTarget, () => deleteDeck(deck.id));
    });
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

  const normalizedCard = card ? normalizeNewFlashcard(card) : null;
  $('flashCard').classList.toggle('flipped', showingBack);
  renderFlashFace($('flashFront'), normalizedCard, false);
  renderFlashFace($('flashBack'), normalizedCard, true);
  const canShowMeaning = Boolean(showingBack && normalizedCard?.meaning);
  $('toggleMeaning').classList.toggle('hidden', !canShowMeaning);
  $('toggleMeaning').textContent = showingMeaning ? 'Ẩn nghĩa' : 'Bật nghĩa';
  $('flashMeaning').classList.toggle('hidden', !canShowMeaning || !showingMeaning);
  $('flashMeaning').textContent = canShowMeaning && showingMeaning ? normalizedCard.meaning : '';

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
      showingMeaning = false;
      renderFlashcards();
    });
    row.querySelector('.edit-card').addEventListener('click', (event) => {
      runActionWithLoading(event.currentTarget, () => editFlashCard(item.id));
    });
    row.querySelector('.delete-card').addEventListener('click', (event) => {
      runActionWithLoading(event.currentTarget, () => deleteFlashCard(item.id));
    });
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
  return persistAndSync();
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
  return persistAndSync();
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
  return persistAndSync();
}

function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (task?.done) state.coins = Math.max(0, state.coins - task.reward);
  state.tasks = state.tasks.filter((item) => item.id !== id);
  return persistAndSync();
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
  return persistAndSync();
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
  return persistAndSync();
}

function deleteShopItem(id) {
  state.shopItems = state.shopItems.filter((item) => item.id !== id);
  return persistAndSync();
}

function editDeck(id) {
  const deck = state.flashDecks.find((item) => item.id === id);
  if (!deck) return;
  const name = window.prompt('Sửa tên bộ flashcard', deck.name);
  if (!name?.trim()) return;
  deck.name = name.trim();
  return persistAndSync();
}

function deleteDeck(id) {
  if (state.flashDecks.length <= 1) return;
  state.flashDecks = state.flashDecks.filter((deck) => deck.id !== id);
  state.flashCards = state.flashCards.filter((card) => card.deckId !== id);
  ensureSelectedDeck();
  currentCardIndex = 0;
  showingBack = false;
  showingMeaning = false;
  return persistAndSync();
}

function editFlashCard(id) {
  const card = state.flashCards.find((item) => item.id === id);
  if (!card) return;
  const current = normalizeNewFlashcard(card);
  const frontText = window.prompt('Sửa mặt trước', current.frontText);
  if (!frontText?.trim()) return;
  const frontPhonetic = window.prompt('Sửa phiên âm mặt trước', current.frontPhonetic);
  const backText = window.prompt('Sửa mặt sau', current.backText);
  if (!backText?.trim()) return;
  const backPhonetic = window.prompt('Sửa phiên âm mặt sau', current.backPhonetic);
  const meaning = window.prompt('Sửa nghĩa tiếng Việt', current.meaning);
  Object.assign(
    card,
    normalizeNewFlashcard({ frontText, frontPhonetic, backText, backPhonetic, meaning }),
  );
  return persistAndSync();
}

function deleteFlashCard(id) {
  const card = state.flashCards.find((item) => item.id === id);
  if (!card) return;
  state.flashCards = state.flashCards.filter((item) => item.id !== id);
  const cards = cardsForDeck(selectedDeckId);
  currentCardIndex = Math.min(currentCardIndex, Math.max(0, cards.length - 1));
  showingBack = false;
  showingMeaning = false;
  return persistAndSync();
}

function addCards(cards, { single = false } = {}) {
  const normalized = cards
    .map(normalizeNewFlashcard)
    .filter(hasFlashcardContent);
  const knownFronts = new Set(
    cardsForDeck(selectedDeckId).map((card) =>
      frontKey(card.frontText || card.front, card.frontPhonetic),
    ),
  );
  const newCards = [];
  normalized.forEach((card) => {
    const key = frontKey(card.frontText || card.front, card.frontPhonetic);
    if (knownFronts.has(key)) return;
    knownFronts.add(key);
    newCards.push(card);
  });

  if (!newCards.length) {
    showToast(single ? 'Từ vựng đã có trong bộ này.' : 'Không có từ mới để thêm.');
    return false;
  }
  state.flashCards.push(
    ...newCards.map((card) => ({
      id: newId(),
      deckId: selectedDeckId,
      front: card.front,
      back: card.back,
      frontText: card.frontText,
      frontPhonetic: card.frontPhonetic,
      backText: card.backText,
      backPhonetic: card.backPhonetic,
      meaning: card.meaning,
      mastered: false,
    })),
  );
  const deck = state.flashDecks.find((item) => item.id === selectedDeckId);
  if (deck) deck.rewardClaimed = false;
  const skipped = normalized.length - newCards.length;
  showToast(
    skipped > 0
      ? `Đã nhập ${newCards.length} flashcard, bỏ qua ${skipped} từ đã có.`
      : `Đã nhập ${newCards.length} flashcard.`,
  );
  setImportMenuOpen(false);
  return persistAndSync().then(() => true);
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
      const [frontText = '', frontPhonetic = '', backText = '', backPhonetic = '', ...rest] = line.split(separator);
      return {
        frontText,
        frontPhonetic,
        backText,
        backPhonetic,
        meaning: rest.join(separator) || '',
      };
    })
    .map(normalizeNewFlashcard)
    .filter(hasFlashcardContent);
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
        const frontText = String(row[0] || '').trim();
        const frontPhonetic = String(row[1] || '').trim();
        const backText = String(row[2] || '').trim();
        const backPhonetic = String(row[3] || '').trim();
        const meaning = String(row[4] || '').trim();
        if (!frontText) return;
        if (isFlashcardHeaderRow(frontText, frontPhonetic, backText, backPhonetic, meaning)) return;
        if (backText) {
          cards.push({ frontText, frontPhonetic, backText, backPhonetic, meaning });
        } else if (frontText.includes(':')) {
          cards.push(...parseRawCards(frontText));
        }
      });
    });
    if (!cards.length) {
      showToast('Không tìm thấy cặp từ vựng trong Excel.');
      return;
    }
    addCards(cards);
  } catch {
    showToast('Không thể đọc file Excel.');
  }
}

function normalizeNewFlashcard(card = {}) {
  const legacy = parseLegacyCard(card);
  const frontText = String(card.frontText || card.front || legacy.frontText || '').trim();
  const frontPhonetic = stripOuterBrackets(card.frontPhonetic || legacy.frontPhonetic || '');
  const backFields = normalizeBackFields(
    card.backText || legacy.backText || '',
    card.backPhonetic || legacy.backPhonetic || '',
    card.meaning || legacy.meaning || '',
  );
  const backText = backFields.backText;
  const backPhonetic = backFields.backPhonetic;
  const meaning = backFields.meaning;
  const front = flashcardSideText(frontText, frontPhonetic);
  const back = flashcardBackText(backText, backPhonetic, meaning);
  return { front, back, frontText, frontPhonetic, backText, backPhonetic, meaning };
}

function normalizeBackFields(rawBackText, rawBackPhonetic, rawMeaning) {
  const parsed = parseBackTextLines(rawBackText);
  const hasBackStructure = Boolean(parsed.phonetic || parsed.meaning);
  return {
    backText: hasBackStructure ? parsed.text : String(rawBackText || '').trim(),
    backPhonetic: stripOuterBrackets(rawBackPhonetic || (hasBackStructure ? parsed.phonetic : '')),
    meaning: String(rawMeaning || parsed.meaning || '').trim(),
  };
}

function parseBackTextLines(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { text: '', phonetic: '', meaning: '' };
  const phoneticIndex = lines.findIndex(
    (line) => line.startsWith('[') && line.endsWith(']') && line.length > 1,
  );
  if (phoneticIndex >= 0) {
    return {
      text: lines.slice(0, phoneticIndex).join('\n'),
      phonetic: stripOuterBrackets(lines[phoneticIndex]),
      meaning: lines.slice(phoneticIndex + 1).join('\n'),
    };
  }
  return {
    text: lines[0],
    phonetic: '',
    meaning: lines.slice(1).join('\n'),
  };
}

function flashcardSideText(text, phonetic) {
  const parts = [];
  if (text) parts.push(text);
  if (phonetic) parts.push(`[${stripOuterBrackets(phonetic)}]`);
  return parts.join('\n');
}

function flashcardBackText(text, phonetic, meaning) {
  return [flashcardSideText(text, phonetic), meaning]
    .filter((part) => String(part || '').trim())
    .join('\n');
}

function parseLegacyCard(card = {}) {
  const frontSide = parseSide(card.front || '');
  const backLines = String(card.back || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const backSide = parseSide(backLines.slice(0, 2).join('\n'));
  const hasStructuredBack = Boolean(card.backText || card.backPhonetic);
  const meaning = card.meaning || (backLines.length > 2 ? backLines.slice(2).join('\n') : '');
  return {
    frontText: frontSide.text,
    frontPhonetic: frontSide.phonetic,
    backText: hasStructuredBack ? card.backText || backSide.text || '' : '',
    backPhonetic: hasStructuredBack
      ? card.backPhonetic || backSide.phonetic || card.phonetic || ''
      : '',
    meaning: meaning || (!hasStructuredBack ? backSide.text : ''),
  };
}

function parseSide(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { text: '', phonetic: '' };
  const last = lines.at(-1);
  const hasPhonetic = last.startsWith('[') && last.endsWith(']') && last.length > 1;
  return {
    text: hasPhonetic ? lines.slice(0, -1).join('\n') : lines.join('\n'),
    phonetic: hasPhonetic ? stripOuterBrackets(last) : '',
  };
}

function stripOuterBrackets(value) {
  const trimmed = String(value || '').trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 1
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function isFlashcardHeaderRow(frontText, frontPhonetic, backText, backPhonetic, meaning) {
  const normalized = [frontText, frontPhonetic, backText, backPhonetic, meaning]
    .map((value) => String(value || '').trim().toLowerCase())
    .join('|');
  return normalized === 'từ vựng mặt trước|phiên âm mặt trước|từ vựng mặt sau|phiên âm mặt sau|nghĩa'
    || normalized === 'front|front phonetic|back|back phonetic|meaning';
}

function flipCard() {
  if (!cardsForDeck(selectedDeckId).length) return;
  showingMeaning = false;
  showingBack = !showingBack;
  renderFlashcards();
}

function moveCard(direction) {
  const cards = cardsForDeck(selectedDeckId);
  currentCardIndex = Math.min(Math.max(currentCardIndex + direction, 0), Math.max(0, cards.length - 1));
  showingBack = false;
  showingMeaning = false;
  renderFlashcards();
}

function toggleCurrentCardMastered() {
  const card = cardsForDeck(selectedDeckId)[currentCardIndex];
  if (!card) return;
  card.mastered = !card.mastered;
  return persistAndSync();
}

function deleteCurrentCard() {
  const card = cardsForDeck(selectedDeckId)[currentCardIndex];
  if (!card) return;
  state.flashCards = state.flashCards.filter((item) => item.id !== card.id);
  currentCardIndex = Math.max(0, currentCardIndex - 1);
  showingBack = false;
  showingMeaning = false;
  return persistAndSync();
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
  return persistAndSync();
}

function cardsForDeck(deckId) {
  return state.flashCards.filter((card) => card.deckId === deckId);
}

function hasFlashcardFront(deckId, front, phonetic = '') {
  const key = frontKey(front, phonetic);
  return cardsForDeck(deckId).some(
    (card) => frontKey(card.frontText || card.front, card.frontPhonetic) === key,
  );
}

function hasFlashcardContent(card) {
  const hasFront = Boolean(card.frontText || card.frontPhonetic);
  const hasBack = Boolean(card.backText || card.backPhonetic || card.meaning);
  return hasFront && hasBack;
}

function frontKey(front, phonetic = '') {
  const value = String(front || '').trim() || String(phonetic || '').trim();
  return value.replace(/\s+/g, ' ').toLowerCase();
}

function rewardForCards(total) {
  return Math.max(20, total * 5);
}

async function runActionWithLoading(button, action) {
  if (!(button instanceof HTMLButtonElement) || button.classList.contains('is-loading')) {
    await action();
    return;
  }

  activeActionButton = button;
  button.disabled = true;
  button.classList.add('is-loading');
  try {
    await action();
  } finally {
    button.classList.remove('is-loading');
    button.disabled = false;
    activeActionButton = null;
  }
}

async function persistAndSync() {
  saveLocalState();
  localStorage.setItem(PENDING_KEY, '1');
  if (activeActionButton) {
    await pushState();
    render();
    return;
  }
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
  const normalized = normalizeNewFlashcard(card);
  return {
    id: String(card.id || newId()),
    deckId: String(card.deckId || 'default-flashcard-deck'),
    front: normalized.front,
    back: normalized.back,
    frontText: normalized.frontText,
    frontPhonetic: normalized.frontPhonetic,
    backText: normalized.backText,
    backPhonetic: normalized.backPhonetic,
    meaning: normalized.meaning,
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
