import { auth, db } from './firebase.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged,
  signOut 
} from "firebase/auth";
import { 
  doc, setDoc, getDoc, updateDoc, arrayUnion 
} from "firebase/firestore";

// --- STATE ---
let currentUser = null;
let userData = {
  cycleLength: 28,
  periodLength: 5,
  periodDates: [], 
  dailyLogs: {}    
};
let currentCalendarDate = new Date();
let selectedModalDateStr = "";
const DEFAULT_API_KEY = ""; // GitHub güvenlik gereği boş bırakıldı, ayarlardan girilebilir.

// Data Lists for Chips
const flowOptions = ["Ağır", "Orta", "Hafif", "Yok"];
const painOptions = ["Yoğun", "Orta", "Hafif", "Yok"];
const moodOptions = ["Duygusal", "Sakin", "Sıkılmış", "Sinirli"];
const dischargeOptions = ["Akıntı yok", "Kaygan", "Lekelenme", "Olağandışı", "Sulu", "Yapışkan", "Yumurta akı"];
const sexOptions = ["İlişki yok", "Korunmalı ilişki", "Korunmasız ilişki"];
const symptomsList = ["Akne", "Aşermeler", "Baş ağrısı", "Bel ağrısı", "Bulantı", "Gece terlemeleri", "Göğüs hassasiyeti", "Halsizlik", "İshal", "Kabızlık", "Karın ağrısı", "Kas ağrısı", "Kaşıntı", "Kramp", "PMS", "Şişkinlik", "Uykusuzluk", "Her şey yolunda"];

// Modal State
let selectedFlow = "";
let selectedPain = "";
let selectedMood = "";
let selectedDischarge = "";
let selectedSex = "";
let selectedSymptoms = [];

// --- DOM ELEMENTS ---
const screens = {
  auth: document.getElementById('auth-screen'),
  main: document.getElementById('main-screen')
};

// Auth Elements
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const toRegisterBtn = document.getElementById('to-register');
const toLoginBtn = document.getElementById('to-login');

// Main Dashboard Elements
const statusText = document.getElementById('status-text');
const logoutBtn = document.getElementById('logout-btn');
const settingsBtn = document.getElementById('settings-btn');
const aiNoteCard = document.getElementById('ai-note-card');
const aiNoteText = document.getElementById('ai-note-text');

// Settings Modal Elements
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const apiKeyInput = document.getElementById('api-key-input');

// Selected Date Elements
const selectedDateTitle = document.getElementById('selected-date-title');
const dateSummaryContent = document.getElementById('date-summary-content');
const openSymptomModalBtn = document.getElementById('open-symptom-modal-btn');

// Calendar Elements
const calendarMonthYear = document.getElementById('calendar-month-year');
const calendarGrid = document.getElementById('calendar-grid');
const prevMonthBtn = document.getElementById('prev-month-btn');
const nextMonthBtn = document.getElementById('next-month-btn');

// Modal Elements
const symptomModal = document.getElementById('symptom-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const modalDateText = document.getElementById('modal-date-text');
const togglePeriodBtn = document.getElementById('toggle-period-btn');
const saveSymptomsBtn = document.getElementById('save-symptoms-btn');

// Chip Containers
const flowChipsContainer = document.getElementById('flow-chips');
const painChipsContainer = document.getElementById('pain-chips');
const moodChipsContainer = document.getElementById('mood-chips');
const dischargeChipsContainer = document.getElementById('discharge-chips');
const sexChipsContainer = document.getElementById('sex-chips');
const symptomsChipsContainer = document.getElementById('symptoms-chips');

// Helpers
const loader = document.getElementById('global-loader');
const toast = document.getElementById('notification-toast');
const toastMessage = document.getElementById('toast-message');

function showLoader() { loader.style.display = 'flex'; }
function hideLoader() { loader.style.display = 'none'; }
function showToast(msg) {
  toastMessage.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

function switchScreen(screenName) {
  Object.values(screens).forEach(s => s.style.display = 'none');
  screens[screenName].style.display = 'block';
  if(screenName === 'main') {
    updateDashboard();
    renderCalendar();
    
    // Default select today
    const todayStr = new Date().toISOString().split('T')[0];
    selectDateForSummary(todayStr);
  }
}

// --- INIT CHIPS ---
function renderSingleSelectChips(container, options, selectedValue, onSelect) {
  container.innerHTML = '';
  options.forEach(opt => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    if (opt === selectedValue) chip.classList.add('selected');
    chip.innerText = opt;
    chip.addEventListener('click', () => {
      // Toggle off if already selected, otherwise select
      const newValue = (selectedValue === opt) ? "" : opt;
      onSelect(newValue);
      renderSingleSelectChips(container, options, newValue, onSelect);
    });
    container.appendChild(chip);
  });
}

function renderMultiSelectChips(container, options, selectedValues, onSelect) {
  container.innerHTML = '';
  options.forEach(opt => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    if (selectedValues.includes(opt)) chip.classList.add('selected');
    chip.innerText = opt;
    chip.addEventListener('click', () => {
      let newValues = [...selectedValues];
      
      if (opt === "Her şey yolunda") {
        newValues = ["Her şey yolunda"];
      } else {
        // Remove "Her şey yolunda" if it was selected
        newValues = newValues.filter(v => v !== "Her şey yolunda");
        
        if (newValues.includes(opt)) {
          newValues = newValues.filter(v => v !== opt);
        } else {
          newValues.push(opt);
        }
      }
      onSelect(newValues);
      renderMultiSelectChips(container, options, newValues, onSelect);
    });
    container.appendChild(chip);
  });
}

// --- MOCK FALLBACK FOR FIREBASE ---
const isMock = auth.app.options.apiKey === "YOUR_API_KEY";

// AUTO LOGIN FOR MOCK USERS (Solves the F5 refresh issue)
if (isMock) {
  const stored = localStorage.getItem('mockUser');
  if (stored) {
    userData = JSON.parse(stored);
    if (!userData.dailyLogs) userData.dailyLogs = {};
    currentUser = { uid: 'mock-user-1' };
    switchScreen('main');
  }
}

// --- AUTH LOGIC ---
toRegisterBtn.addEventListener('click', () => {
  loginForm.style.display = 'none';
  registerForm.style.display = 'flex';
});
toLoginBtn.addEventListener('click', () => {
  registerForm.style.display = 'none';
  loginForm.style.display = 'flex';
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  
  showLoader();
  try {
    if (isMock) {
      currentUser = { uid: 'mock-user-1' };
      userData = { cycleLength: 28, periodLength: 5, periodDates: [], dailyLogs: {} };
      localStorage.setItem('mockUser', JSON.stringify(userData));
      switchScreen('main');
    } else {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      currentUser = userCredential.user;
      userData = { cycleLength: 28, periodLength: 5, periodDates: [], dailyLogs: {} };
      await setDoc(doc(db, "users", currentUser.uid), userData);
    }
    showToast("Aramıza hoş geldin! 🌸");
  } catch (error) {
    showToast("Hata: " + error.message);
  }
  hideLoader();
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  
  showLoader();
  try {
    if (isMock) {
      const stored = localStorage.getItem('mockUser');
      if(stored) userData = JSON.parse(stored);
      if(!userData.dailyLogs) userData.dailyLogs = {};
      currentUser = { uid: 'mock-user-1' };
      switchScreen('main');
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    showToast("Tekrar hoş geldin! ✨");
  } catch (error) {
    showToast("Hata: " + error.message);
  }
  hideLoader();
});

logoutBtn.addEventListener('click', async () => {
  if (!isMock) await signOut(auth);
  currentUser = null;
  if(isMock) localStorage.removeItem('mockUser'); // Optional: keep it or clear it. If user wants permanent stay, we shouldn't clear on refresh, but logout should clear it.
  switchScreen('auth');
});

if (!isMock) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
          const data = docSnap.data();
          userData = {
            cycleLength: data.cycleLength || 28,
            periodLength: data.periodLength || 5,
            periodDates: data.periodDates || [],
            dailyLogs: data.dailyLogs || {}
          };
        }
      } catch (err) {
        console.error("Firestore Error:", err);
        showToast("Veritabanı Hatası! Firebase kurallarını (Rules) kontrol edin.");
      }
      switchScreen('main');
    } else {
      switchScreen('auth');
    }
  });
}

// --- DASHBOARD LOGIC ---
function updateDashboard() {
  if (userData.periodDates.length === 0) {
    statusText.innerHTML = "<strong>Kayıt Yok</strong><br>Takvime tıklayarak regli gününü ekleyebilirsin.";
    return;
  }

  const lastPeriodStr = userData.periodDates[userData.periodDates.length - 1];
  const lastPeriodDate = new Date(lastPeriodStr);
  const today = new Date();
  
  today.setHours(0,0,0,0);
  lastPeriodDate.setHours(0,0,0,0);

  const diffTime = today - lastPeriodDate;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const nextPeriod = new Date(lastPeriodDate);
  nextPeriod.setDate(nextPeriod.getDate() + userData.cycleLength);

  if (diffDays >= 0 && diffDays < userData.periodLength) {
    statusText.innerHTML = `Reglinin <strong>${diffDays + 1}. Günü</strong><br>Kendine iyi bak 💖`;
  } else {
    const daysLeft = Math.ceil((nextPeriod - today) / (1000 * 60 * 60 * 24));
    if (daysLeft === 0) {
      statusText.innerHTML = "<strong>Bugün!</strong><br>Tahmini regli günün geldi 🌸";
    } else if (daysLeft < 0) {
      statusText.innerHTML = `<strong>${Math.abs(daysLeft)} Gün Gecikti</strong><br>Stres yapma 🧘‍♀️`;
    } else {
      statusText.innerHTML = `Sıradaki regline <strong>${daysLeft} Gün Kaldı</strong>`;
    }
  }
}

// --- SETTINGS LOGIC ---
settingsBtn.addEventListener('click', () => {
  apiKeyInput.value = localStorage.getItem('geminiApiKey') || DEFAULT_API_KEY;
  settingsModal.style.display = 'flex';
});
closeSettingsBtn.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});
saveSettingsBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem('geminiApiKey', key);
  } else {
    localStorage.removeItem('geminiApiKey');
  }
  settingsModal.style.display = 'none';
  showToast("Ayarlar kaydedildi!");
  
  // Refresh AI note if a date is selected
  if (selectedModalDateStr) {
    updateAINote(selectedModalDateStr);
  }
});

// --- DATE SUMMARY & AI NOTE LOGIC ---
function selectDateForSummary(dateStr) {
  selectedModalDateStr = dateStr;
  const dObj = new Date(dateStr);
  const todayStr = new Date().toISOString().split('T')[0];
  
  if (dateStr === todayStr) {
    selectedDateTitle.innerText = "Bugün";
    openSymptomModalBtn.innerText = "Bugün Nasıl Hissediyorsun? ✨";
  } else {
    selectedDateTitle.innerText = `${dObj.getDate()} ${["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"][dObj.getMonth()]}`;
    openSymptomModalBtn.innerText = "Bu Günü Düzenle ✏️";
  }

  const log = userData.dailyLogs[dateStr];
  let summaryHtml = "";

  if (userData.periodDates.includes(dateStr)) {
    summaryHtml += `<p style="color: var(--accent-color); font-weight: bold; margin-bottom: 10px;">🩸 Regli Başlangıcı</p>`;
  }

  if (log && (log.flow || log.pain || log.mood || log.discharge || log.sex || log.symptoms.length > 0)) {
    if (log.flow) summaryHtml += `<p><strong>Akıntı:</strong> ${log.flow}</p>`;
    if (log.pain) summaryHtml += `<p><strong>Ağrı:</strong> ${log.pain}</p>`;
    if (log.mood) summaryHtml += `<p><strong>Ruh Hali:</strong> ${log.mood}</p>`;
    if (log.discharge) summaryHtml += `<p><strong>Vajinal:</strong> ${log.discharge}</p>`;
    if (log.sex) summaryHtml += `<p><strong>İlişki:</strong> ${log.sex}</p>`;
    if (log.symptoms && log.symptoms.length > 0) {
      summaryHtml += `<p style="margin-top: 10px;"><strong>Semptomlar:</strong></p><div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px;">`;
      log.symptoms.forEach(s => {
        summaryHtml += `<span style="background: rgba(255,255,255,0.8); border-radius: 12px; padding: 2px 8px; font-size: 0.8rem; border: 1px solid var(--glass-border);">${s}</span>`;
      });
      summaryHtml += `</div>`;
    }
    dateSummaryContent.innerHTML = summaryHtml;
  } else {
    if (!userData.periodDates.includes(dateStr)) {
      dateSummaryContent.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">Henüz bir veri girmedin.</p>`;
    }
  }

  updateAINote(dateStr);
}

async function updateAINote(dateStr) {
  const log = userData.dailyLogs[dateStr];
  if (!log) {
    aiNoteCard.style.display = 'none';
    return;
  }
  
  const apiKey = localStorage.getItem('geminiApiKey') || DEFAULT_API_KEY;
  
  // Kural Tabanlı Fallback Mantığı
  const getRuleBasedNote = () => {
    if (log.symptoms && log.symptoms.includes("Kramp") || log.pain === "Yoğun" || log.pain === "Orta") {
      return "Krampların için sıcak su torbası ve papatya çayı harika bir ikilidir. Biraz dinlenmeyi hak ettin! ☕💖";
    } else if (log.symptoms && log.symptoms.includes("Şişkinlik")) {
      return "Şişkinlik hissediyorsan bol bol su içmeyi ve tuzlu yiyeceklerden uzak durmayı unutma. 💧";
    } else if (log.mood === "Sinirli" || log.mood === "Sıkılmış") {
      return "Bugün ruh halin biraz dalgalı gibi. Kendine vakit ayır, sevdiğin bir müziği aç ve derin bir nefes al. 🎶✨";
    } else if (log.mood === "Duygusal") {
      return "Duygusal hissetmen çok normal, hormonların şu an dans ediyor. Kendine şefkatli davran. 🌸";
    } else if (log.symptoms && log.symptoms.includes("Her şey yolunda")) {
      return "Harika! Bugün her şeyin yolunda olmasına çok sevindim. Günün tadını çıkar! 🌟";
    } else if (log.symptoms && log.symptoms.includes("Akne")) {
      return "Cildin şu sıralar hassas olabilir. Bol su içip yüzünü nazikçe temizlemeyi unutma. ✨";
    } else if (log.flow === "Ağır") {
      return "Yoğun bir gün geçiriyorsun. Demir açısından zengin beslenmeye (ıspanak, pekmez vb.) özen göster! 💪";
    } else {
      return "Bugün nasılsın? Girdiğin verilere göre gerçek yapay zeka tavsiyesi almak için Ayarlar'dan Gemini API anahtarını ekleyebilirsin! ✨";
    }
  };

  if (!apiKey) {
    aiNoteText.innerText = getRuleBasedNote();
    aiNoteCard.style.display = 'block';
    return;
  }

  // Gerçek AI İsteği
  aiNoteText.innerText = "Pinky düşünüyor... 🌸";
  aiNoteCard.style.display = 'block';

  const promptText = `
Sen 'Pinky' adında, çok tatlı, şefkatli ve anlayışlı bir kadın sağlığı ve regli takip asistanısın.
Kullanıcı bugüne ait şu verileri girdi:
Akıntı: ${log.flow || "Belirtilmedi"}
Ağrı: ${log.pain || "Belirtilmedi"}
Ruh Hali: ${log.mood || "Belirtilmedi"}
Semptomlar: ${log.symptoms ? log.symptoms.join(', ') : "Belirtilmedi"}

Ona durumuna uygun, tıbbi tavsiye yerine geçmeyen, çok içten, şefkatli, destekleyici ve içinde bol emoji olan kısa bir not yaz. 
Kural: Kesinlikle 2 kısa cümleyi geçme. Sadece mesajı ver.
`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }]
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API Hatası: ${response.status} - ${errText}`);
    }
    
    const data = await response.json();
    const aiMessage = data.candidates[0].content.parts[0].text;
    aiNoteText.innerText = aiMessage.replace(/\*/g, ''); // Temizle
  } catch (error) {
    // Fallback to rule-based logic if API fails
    console.error("AI API Error:", error);
    aiNoteText.innerText = getRuleBasedNote();
  }
}

// Open modal button
openSymptomModalBtn.addEventListener('click', () => {
  openModal(selectedModalDateStr);
});


// --- CALENDAR LOGIC ---
prevMonthBtn.addEventListener('click', () => {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  renderCalendar();
});
nextMonthBtn.addEventListener('click', () => {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  renderCalendar();
});

function renderCalendar() {
  calendarGrid.innerHTML = '';
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  calendarMonthYear.innerText = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  let startDay = firstDay === 0 ? 6 : firstDay - 1;

  for (let i = 0; i < startDay; i++) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'calendar-day empty';
    calendarGrid.appendChild(emptyDiv);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'calendar-day';
    dayDiv.innerText = d;

    const currentCheckDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const checkDate = new Date(currentCheckDateStr);
    checkDate.setHours(0,0,0,0);
    
    // Check Statuses
    if (userData.periodDates.length > 0) {
      userData.periodDates.forEach(startDateStr => {
        const startDate = new Date(startDateStr);
        startDate.setHours(0,0,0,0);

        const diffDays = Math.round((checkDate - startDate) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays < userData.periodLength) {
          dayDiv.classList.add('period');
        }

        const predictedDate = new Date(startDate);
        predictedDate.setDate(predictedDate.getDate() + userData.cycleLength);
        const pDiffDays = Math.round((checkDate - predictedDate) / (1000 * 60 * 60 * 24));
        if (pDiffDays >= 0 && pDiffDays < userData.periodLength && checkDate > new Date()) {
          dayDiv.classList.add('prediction');
        }

        const ovulationDate = new Date(predictedDate);
        ovulationDate.setDate(ovulationDate.getDate() - 14);
        
        const fertileDiff = Math.round((checkDate - ovulationDate) / (1000 * 60 * 60 * 24));
        if (fertileDiff >= -5 && fertileDiff <= 1) {
          dayDiv.classList.add('fertile');
        }
        if (fertileDiff === 0) { 
          dayDiv.classList.add('ovulation');
        }

        const pmsStart = new Date(predictedDate);
        pmsStart.setDate(pmsStart.getDate() - 4);
        const pmsDiff = Math.round((checkDate - pmsStart) / (1000 * 60 * 60 * 24));
        if (pmsDiff >= 0 && pmsDiff <= 3) {
          dayDiv.classList.add('pms');
        }
      });
    }

    if (userData.dailyLogs && userData.dailyLogs[currentCheckDateStr]) {
       // Optional visual indicator for days with logs
       dayDiv.style.fontWeight = "900";
       dayDiv.style.textDecoration = "underline";
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (currentCheckDateStr === todayStr) {
      dayDiv.classList.add('today');
    }
    
    if (currentCheckDateStr === selectedModalDateStr) {
      dayDiv.style.border = "2px solid var(--accent-color)";
    }

    dayDiv.addEventListener('click', () => {
      selectDateForSummary(currentCheckDateStr);
      renderCalendar(); // To update the selected border
    });

    calendarGrid.appendChild(dayDiv);
  }
}

// --- MODAL LOGIC ---
function openModal(dateStr) {
  const dObj = new Date(dateStr);
  modalDateText.innerText = `${dObj.getDate()} ${["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"][dObj.getMonth()]}`;

  // Reset State
  selectedFlow = "";
  selectedPain = "";
  selectedMood = "";
  selectedDischarge = "";
  selectedSex = "";
  selectedSymptoms = [];

  // Load existing log
  if (userData.dailyLogs && userData.dailyLogs[dateStr]) {
    const log = userData.dailyLogs[dateStr];
    selectedFlow = log.flow || "";
    selectedPain = log.pain || "";
    selectedMood = log.mood || "";
    selectedDischarge = log.discharge || "";
    selectedSex = log.sex || "";
    if (log.symptoms) selectedSymptoms = [...log.symptoms];
  }

  // Render Chip Groups
  renderSingleSelectChips(flowChipsContainer, flowOptions, selectedFlow, val => selectedFlow = val);
  renderSingleSelectChips(painChipsContainer, painOptions, selectedPain, val => selectedPain = val);
  renderSingleSelectChips(moodChipsContainer, moodOptions, selectedMood, val => selectedMood = val);
  renderSingleSelectChips(dischargeChipsContainer, dischargeOptions, selectedDischarge, val => selectedDischarge = val);
  renderSingleSelectChips(sexChipsContainer, sexOptions, selectedSex, val => selectedSex = val);
  renderMultiSelectChips(symptomsChipsContainer, symptomsList, selectedSymptoms, val => selectedSymptoms = val);

  // Set Button state for Period start toggle
  if (userData.periodDates.includes(dateStr)) {
    togglePeriodBtn.innerText = "Kaldır: Regli Başlangıcı";
    togglePeriodBtn.classList.add('secondary-btn');
    togglePeriodBtn.classList.remove('primary-btn');
  } else {
    togglePeriodBtn.innerText = "Regli Başlangıcı Olarak İşaretle 🩸";
    togglePeriodBtn.classList.remove('secondary-btn');
    togglePeriodBtn.classList.add('primary-btn');
  }

  symptomModal.style.display = 'flex';
}

closeModalBtn.addEventListener('click', () => {
  symptomModal.style.display = 'none';
});

togglePeriodBtn.addEventListener('click', async () => {
  if (userData.periodDates.includes(selectedModalDateStr)) {
    userData.periodDates = userData.periodDates.filter(d => d !== selectedModalDateStr);
    togglePeriodBtn.innerText = "Regli Başlangıcı Olarak İşaretle 🩸";
    togglePeriodBtn.classList.remove('secondary-btn');
    togglePeriodBtn.classList.add('primary-btn');
  } else {
    userData.periodDates.push(selectedModalDateStr);
    userData.periodDates.sort();
    togglePeriodBtn.innerText = "Kaldır: Regli Başlangıcı";
    togglePeriodBtn.classList.add('secondary-btn');
    togglePeriodBtn.classList.remove('primary-btn');
  }
  
  await saveUserData();
  updateDashboard();
  renderCalendar();
  selectDateForSummary(selectedModalDateStr);
  showToast("Regli durumu güncellendi!");
});

saveSymptomsBtn.addEventListener('click', async () => {
  if (!userData.dailyLogs) userData.dailyLogs = {};
  
  userData.dailyLogs[selectedModalDateStr] = {
    flow: selectedFlow,
    pain: selectedPain,
    mood: selectedMood,
    discharge: selectedDischarge,
    sex: selectedSex,
    symptoms: [...selectedSymptoms]
  };

  showLoader();
  await saveUserData();
  symptomModal.style.display = 'none';
  
  selectDateForSummary(selectedModalDateStr);
  renderCalendar();
  hideLoader();
  showToast("Günlük detaylar kaydedildi! 🌸");
});

async function saveUserData() {
  if (isMock) {
    localStorage.setItem('mockUser', JSON.stringify(userData));
  } else {
    try {
      const userRef = doc(db, "users", currentUser.uid);
      await setDoc(userRef, userData, { merge: true });
    } catch (err) {
      console.error(err);
      showToast("Veritabanına kaydedilemedi! Kuralları (Rules) kontrol edin.");
    }
  }
}
