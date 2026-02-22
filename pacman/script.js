'use strict';

const REDDIT_POSTS_URL = 'https://www.reddit.com/r/WouldYouRather/top.json?limit=100&t=all';
const API_URL          = 'https://api.truthordarebot.xyz/api/wyr?rating=pg13';

const FALLBACK_QUESTIONS = [
  'Would you rather always be 10 minutes late OR always be 20 minutes early?',
  'Would you rather have the ability to fly OR be invisible?',
  'Would you rather lose all your memories OR never be able to make new ones?',
  'Would you rather only eat sweet food for the rest of your life OR only eat savory food?',
  'Would you rather be able to speak every language OR play every instrument?',
  'Would you rather live without music OR live without television?',
  'Would you rather have unlimited money OR unlimited time?',
  'Would you rather always have to say everything on your mind OR never be able to speak again?',
  'Would you rather live in the past OR live in the future?',
  'Would you rather be able to run at 100 mph OR fly at 10 mph?',
  'Would you rather know how you die OR know when you die?',
  'Would you rather never be able to use a smartphone again OR never be able to use a computer again?',
  'Would you rather have a rewind button in your life OR a pause button?',
  'Would you rather always have to whisper OR always have to shout?',
  'Would you rather be able to teleport anywhere OR be able to read minds?',
  'Would you rather fight one horse-sized duck OR one hundred duck-sized horses?',
  'Would you rather never feel cold again OR never feel hot again?',
  'Would you rather explore the ocean floor OR travel to outer space?',
  'Would you rather have a photographic memory OR be able to forget anything you choose?',
  'Would you rather be the smartest person in the room OR the funniest person in the room?',
  'Would you rather wake up as a new person every day OR stay exactly the same forever?',
  'Would you rather have no social media for a year OR no TV for a year?',
  'Would you rather be able to talk to animals OR be able to speak to the dead?',
  'Would you rather never have to sleep OR never have to eat?',
  'Would you rather always have perfect weather OR always have Wi-Fi?',
  'Would you rather live alone on a deserted island for a year OR share a one-room apartment with 10 strangers?',
  'Would you rather never age physically OR never age mentally?',
  'Would you rather have the ability to time travel to the past OR travel to the future?',
  'Would you rather always be slightly too hot OR always be slightly too cold?',
  'Would you rather have free flights for life OR free food for life?',
];

// ── State ──
let redditPool      = [];   // [{ id, title }]
let redditIndex     = 0;
let seenIds         = new Set();
let fallbackIndex   = 0;
let isLoading       = false;
let isPopupOpen     = false;
let currentOpt1     = '';
let currentOpt2     = '';
let currentPostId   = null;
let commentsPromise = null;  // Promise<Comment[]> — pre-fetched while user reads the question
let sessionCount    = 0;
let streak          = 0;
let questionShownAt = 0;   // timestamp when current question was displayed

// ── DOM refs ──
const opt1El         = document.getElementById('opt1');
const opt2El         = document.getElementById('opt2');
const halfLeft       = document.getElementById('half-left');
const halfRight      = document.getElementById('half-right');
const nextBtn        = document.getElementById('next-btn');
const spinnerLeft    = document.getElementById('spinner-left');
const spinnerRight   = document.getElementById('spinner-right');
const popupOverlay   = document.getElementById('popup-overlay');
const popupResults   = document.getElementById('popup-results');
const popupNextBtn   = document.getElementById('popup-next-btn');
const sessionCounter  = document.getElementById('session-counter');
const themeToggle     = document.getElementById('theme-toggle');
const ringFill        = document.getElementById('progress-ring-fill');
const streakLabel     = document.getElementById('streak-label');

const RING_STEPS      = 10;    // answers per full ring rotation
const STREAK_THRESHOLD = 3000; // ms — picks faster than this count toward streak
const RING_CIRCUMFERENCE = 2 * Math.PI * 60; // ≈ 376.99

// ── Theme ──
const savedTheme = localStorage.getItem('wyr-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeBtn(savedTheme);

function updateThemeBtn(theme) {
  themeToggle.textContent = theme === 'dark' ? '☀ Light' : '◑ Dark';
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('wyr-theme', next);
  updateThemeBtn(next);
});

// ── Utilities ──

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cap(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function splitQuestion(str) {
  const match = str.match(/ or /i);
  if (!match) return [str.replace(/^would you rather\s*/i, ''), '???'];
  let o1 = str.slice(0, match.index).trim();
  let o2 = str.slice(match.index + match[0].length).trim();
  o2 = o2.replace(/\?+$/, '').trim();
  o1 = o1.replace(/^would you rather\s*/i, '');
  return [cap(o1), cap(o2)];
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatScore(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function displayQuestion(opt1, opt2) {
  currentOpt1 = opt1;
  currentOpt2 = opt2;
  opt1El.classList.add('fading');
  opt2El.classList.add('fading');
  setTimeout(() => {
    opt1El.textContent = opt1;
    opt2El.textContent = opt2;
    opt1El.classList.remove('fading');
    opt2El.classList.remove('fading');
    questionShownAt = Date.now(); // start the clock for streak timing
  }, 250);
}

function setLoading(loading) {
  isLoading = loading;
  spinnerLeft.classList.toggle('active', loading);
  spinnerRight.classList.toggle('active', loading);
  nextBtn.disabled = loading;
  if (loading) {
    opt1El.classList.add('fading');
    opt2El.classList.add('fading');
  }
}

function updateRing() {
  const progress = (sessionCount % RING_STEPS) / RING_STEPS;
  ringFill.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);
}

function updateStreak(quick) {
  if (quick) {
    streak++;
  } else {
    streak = 0;
  }

  if (streak >= 2) {
    const wasVisible = streakLabel.classList.contains('visible');
    streakLabel.textContent = `🔥 ${streak}`;
    streakLabel.classList.add('visible');
    if (wasVisible) {
      // bump animation on each new increment
      streakLabel.classList.remove('bump');
      void streakLabel.offsetWidth; // force reflow
      streakLabel.classList.add('bump');
    }
  } else {
    streakLabel.classList.remove('visible', 'bump');
  }
}

function incrementCounter() {
  const quick = (Date.now() - questionShownAt) < STREAK_THRESHOLD;
  sessionCount++;
  sessionCounter.textContent = `${sessionCount} answered`;
  updateRing();
  updateStreak(quick);
}

// ── Reddit posts ──

async function loadRedditPool() {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(REDDIT_POSTS_URL, {
    signal: controller.signal,
    headers: { Accept: 'application/json' },
  });
  clearTimeout(tid);
  if (!res.ok) throw new Error(`Reddit ${res.status}`);

  const json = await res.json();
  const posts = json?.data?.children ?? [];

  const all = posts
    .filter(p => / or /i.test(p?.data?.title ?? ''))
    .map(p => ({ id: p.data.id, title: p.data.title }));

  if (all.length === 0) throw new Error('No valid posts');

  const fresh = all.filter(q => !seenIds.has(q.id));
  if (fresh.length === 0) {
    seenIds.clear();
    redditPool = shuffle(all);
  } else {
    redditPool = shuffle(fresh);
  }
  redditIndex = 0;
  console.log(`Loaded ${redditPool.length} posts from r/WouldYouRather`);
}

async function nextRedditPost() {
  if (redditPool.length === 0 || redditIndex >= redditPool.length) {
    await loadRedditPool();
  }
  while (redditIndex < redditPool.length && seenIds.has(redditPool[redditIndex].id)) {
    redditIndex++;
  }
  if (redditIndex >= redditPool.length) await loadRedditPool();
  return redditPool[redditIndex++];
}

// ── Comments ──
// Pre-fetched in the background while the user reads the question.
// By the time they click, the comments are usually already loaded.

async function fetchTopComments(postId) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(
    `https://www.reddit.com/r/WouldYouRather/comments/${postId}.json?limit=50&sort=top`,
    { signal: controller.signal, headers: { Accept: 'application/json' } }
  );
  clearTimeout(tid);
  if (!res.ok) throw new Error(`Comments ${res.status}`);

  const json = await res.json();
  const children = json[1]?.data?.children ?? [];

  return children
    .filter(c => {
      if (c.kind !== 't1') return false;
      const { body, depth } = c.data;
      if (depth !== 0) return false;
      if (!body || body === '[deleted]' || body === '[removed]') return false;
      // Keep substantive comments — not too short (just "A"), not essays
      if (body.trim().length < 35 || body.trim().length > 500) return false;
      return true;
    })
    .sort((a, b) => b.data.score - a.data.score)
    .slice(0, 3)
    .map(c => ({ text: c.data.body.trim(), score: c.data.score }));
}

function prefetchComments(postId) {
  if (!postId) { commentsPromise = null; return; }
  commentsPromise = fetchTopComments(postId).catch(err => {
    console.warn('Comments failed:', err.message);
    return [];
  });
}

// ── Fallback sources ──

function useFallback() {
  const q = FALLBACK_QUESTIONS[fallbackIndex % FALLBACK_QUESTIONS.length];
  fallbackIndex++;
  currentPostId = null;
  commentsPromise = null;
  const [opt1, opt2] = splitQuestion(q);
  setLoading(false);
  displayQuestion(opt1, opt2);
}

async function useTruthOrDareApi() {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 6000);
  const res = await fetch(API_URL, { signal: controller.signal });
  clearTimeout(tid);
  if (!res.ok) throw new Error(`TruthOrDare ${res.status}`);
  const data = await res.json();
  return data.question;
}

// ── Main fetch ──

async function fetchQuestion() {
  if (isLoading) return;
  setLoading(true);

  // 1. Reddit
  try {
    const post = await nextRedditPost();
    seenIds.add(post.id);
    currentPostId = post.id;
    const [opt1, opt2] = splitQuestion(post.title);
    setLoading(false);
    displayQuestion(opt1, opt2);
    prefetchComments(post.id);  // start loading comments in background
    return;
  } catch (err) {
    console.warn('Reddit failed:', err.message);
  }

  // 2. truthordarebot
  currentPostId = null;
  commentsPromise = null;
  try {
    const q = await useTruthOrDareApi();
    const [opt1, opt2] = splitQuestion(q);
    setLoading(false);
    displayQuestion(opt1, opt2);
    return;
  } catch (err) {
    console.warn('TruthOrDare API failed:', err.message);
  }

  // 3. Hardcoded fallback
  useFallback();
}

// ── Popup ──

function showPopup(chosenSide) {
  isPopupOpen = true;

  // Render immediately with loading state
  popupResults.innerHTML = `<p class="popup-loading">Loading perspectives…</p>`;
  popupOverlay.classList.add('visible');

  // Wait for comments (usually already resolved since we pre-fetched)
  const promise = commentsPromise || Promise.resolve([]);
  promise.then(comments => renderComments(comments, chosenSide));
}

function renderComments(comments, chosenSide) {
  if (!comments || comments.length === 0) {
    popupResults.innerHTML = `
      <p class="popup-no-data">No comments found for this question.</p>
    `;
    return;
  }

  const chosenText = chosenSide === 'left' ? currentOpt1 : currentOpt2;

  const cards = comments.map(c => `
    <div class="comment-card">
      <p class="comment-text">${escapeHtml(c.text)}</p>
      <span class="comment-score">▲ ${formatScore(c.score)}</span>
    </div>
  `).join('');

  popupResults.innerHTML = `
    <p class="popup-your-pick">You chose: <strong>${escapeHtml(chosenText)}</strong></p>
    ${cards}
  `;
}

function closePopup() {
  popupOverlay.classList.remove('visible');
  isPopupOpen = false;
}

// ── Event listeners ──

halfLeft.addEventListener('click', () => {
  if (isLoading || isPopupOpen) return;
  incrementCounter();
  showPopup('left');
});

halfRight.addEventListener('click', () => {
  if (isLoading || isPopupOpen) return;
  incrementCounter();
  showPopup('right');
});

nextBtn.addEventListener('click', () => {
  if (!isPopupOpen) fetchQuestion();
});

popupNextBtn.addEventListener('click', () => {
  closePopup();
  fetchQuestion();
});

popupOverlay.addEventListener('click', e => {
  if (e.target === popupOverlay) {
    closePopup();
    fetchQuestion();
  }
});

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e => {
  if (isPopupOpen) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      closePopup();
      fetchQuestion();
    }
    return;
  }

  if (isLoading) return;

  switch (e.key) {
    case 'ArrowLeft': case 'a': case 'A':
      incrementCounter(); showPopup('left');  break;
    case 'ArrowRight': case 'd': case 'D':
      incrementCounter(); showPopup('right'); break;
    case ' ': case 'n': case 'N':
      e.preventDefault(); fetchQuestion();    break;
  }
});

halfLeft.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && !isLoading && !isPopupOpen) {
    incrementCounter(); showPopup('left');
  }
});

halfRight.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && !isLoading && !isPopupOpen) {
    incrementCounter(); showPopup('right');
  }
});

// ── Initial load ──
fetchQuestion();
