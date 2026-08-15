const DATA_URL = "./data/gaokao-30-cards-v0.1.json";
const STORAGE_KEY = "word-bridge-profile-v3";
const SESSION_SIZE = 5;

const appMain = document.querySelector("#appMain");
const headerStatus = document.querySelector("#headerStatus");
const wordListDialog = document.querySelector("#wordListDialog");

let cards = [];
let view = "home";
let session = null;
let profile = loadProfile();

function emptyProfile() {
  return {
    version: 3,
    anchorKnowledge: {},
    cardProgress: {},
    sessions: []
  };
}

function loadProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...emptyProfile(), ...stored };
  } catch {
    return emptyProfile();
  }
}

function saveProfile() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);
}

function cardProgress(cardId) {
  return {
    mastery: 0,
    studyCount: 0,
    reviewCount: 0,
    reviewLevel: 0,
    correctRecallCount: 0,
    selectedAnchor: null,
    lastStudiedAt: null,
    nextReviewAt: null,
    ...profile.cardProgress[cardId]
  };
}

function anchorsFor(card) {
  const candidates = Array.isArray(card.anchor_candidates) && card.anchor_candidates.length
    ? card.anchor_candidates
    : [{ word: card.anchor, meaning: "熟词入口", priority: 1 }];
  return [...candidates].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

function lessonFor(card, anchor) {
  return {
    transform: anchor.transform || card.transform,
    bridge: anchor.bridge || card.bridge,
    recallPrompt: anchor.recall_prompt || card.recall_prompt,
    factBoundary: anchor.fact_boundary || card.fact_boundary || card.warning
  };
}

function knownAnchorCount() {
  return Object.values(profile.anchorKnowledge).filter(Boolean).length;
}

function dueReviewCount() {
  return dueCards().length;
}

function dueCards() {
  const now = Date.now();
  return cards.filter(card => {
    const dueAt = cardProgress(card.id).nextReviewAt;
    return dueAt && new Date(dueAt).getTime() <= now;
  }).sort((a, b) => new Date(cardProgress(a.id).nextReviewAt) - new Date(cardProgress(b.id).nextReviewAt));
}

function learnedCount() {
  return cards.filter(card => cardProgress(card.id).studyCount > 0).length;
}

function setHeader(text) {
  headerStatus.textContent = text;
}

function render() {
  if (view === "home") renderHome();
  if (view === "diagnostic") renderDiagnostic();
  if (view === "learn") renderLearning();
  if (view === "review") renderReview();
  if (view === "complete") renderComplete();
}

function renderHome() {
  setHeader("高中词汇 · 熟词桥第一组");
  const known = knownAnchorCount();
  const learned = learnedCount();
  const due = dueReviewCount();
  appMain.innerHTML = `
    <section class="home-view">
      <div class="home-copy">
        <p class="module-name">高中词汇 · 熟词桥第一组</p>
        <h1>先找出你认识的词，<br />再学5个新词。</h1>
        <p class="home-intro">不是给所有人同一套联想。系统先确认你的旧知识，再为每个新词选择你真正认识的入口。</p>
        <div class="home-actions">
          ${due ? `<button id="startReview" class="primary-button large-button" type="button">开始复习 ${Math.min(due, SESSION_SIZE)} 词</button>` : ""}
          <button id="startSession" class="${due ? "secondary-button" : "primary-button"} large-button" type="button">${due ? "继续学习新词" : "开始5词学习"}</button>
          ${known ? '<button id="reviewProfile" class="secondary-button large-button" type="button">查看熟词档案</button>' : ""}
        </div>
        <p class="privacy-note">${due ? `共有 ${due} 个单词已经到期，复习时沿用上次选择的熟词桥。` : "首次使用会先进行约1分钟的熟词诊断。"}</p>
      </div>

      <aside class="home-summary" aria-label="学习概况">
        <div class="summary-row"><strong>${known}</strong><span>已确认熟词</span></div>
        <div class="summary-row"><strong>${learned}</strong><span>已学习新词</span></div>
        <div class="summary-row"><strong>${due}</strong><span>当前待复习</span></div>
        <div class="method-path" aria-label="学习方法">
          <span>熟词诊断</span><i>→</i><span>动态选桥</span><i>→</i><span>主动回忆</span>
        </div>
      </aside>
    </section>

    <section class="product-principle">
      <strong>核心原则</strong>
      <p>科学关系负责解释，记忆桥负责好记；两者可以协作，但不会混为一谈。</p>
    </section>`;

  document.querySelector("#startSession").addEventListener("click", startSession);
  document.querySelector("#startReview")?.addEventListener("click", startReviewSession);
  document.querySelector("#reviewProfile")?.addEventListener("click", openWordList);
}

function startSession() {
  const dueIds = new Set(dueCards().map(card => card.id));
  const unlearned = cards.filter(card => cardProgress(card.id).studyCount === 0);
  const unfinished = cards.filter(card => cardProgress(card.id).studyCount > 0 && cardProgress(card.id).mastery < 3 && !dueIds.has(card.id));
  const completed = cards.filter(card => cardProgress(card.id).mastery === 3 && !dueIds.has(card.id));
  const dueLast = cards.filter(card => dueIds.has(card.id));
  session = {
    id: `session-${Date.now()}`,
    mode: "learn",
    startedAt: Date.now(),
    queue: [...unlearned, ...unfinished, ...completed, ...dueLast],
    scanIndex: 0,
    candidateIndex: 0,
    selected: [],
    skipped: [],
    currentIndex: 0,
    learningStage: "guess",
    feedback: null,
    results: [],
    completedAt: null
  };
  view = "diagnostic";
  advanceDiagnostic();
}

function startReviewSession() {
  const reviewCards = dueCards().slice(0, SESSION_SIZE);
  if (!reviewCards.length) return goHome();

  session = {
    id: `review-${Date.now()}`,
    mode: "review",
    startedAt: Date.now(),
    selected: reviewCards.map(card => {
      const progress = cardProgress(card.id);
      const anchors = anchorsFor(card);
      return {
        card,
        anchor: anchors.find(candidate => candidate.word === progress.selectedAnchor) || anchors[0]
      };
    }),
    currentIndex: 0,
    reviewStage: "recall",
    feedback: null,
    results: [],
    completedAt: null
  };
  view = "review";
  render();
}

function currentReviewItem() {
  return session?.selected[session.currentIndex] ?? null;
}

function ensureReviewResult(card, anchor) {
  let result = session.results.find(item => item.cardId === card.id);
  if (!result) {
    result = {
      cardId: card.id,
      target: card.target,
      anchor: anchor.word,
      startedAt: Date.now(),
      firstAttemptCorrect: false,
      bridgeViewed: false,
      retryCorrect: false,
      answerRevealed: false,
      outcome: null,
      status: null,
      durationMs: 0
    };
    session.results.push(result);
  }
  return result;
}

function renderReview() {
  const item = currentReviewItem();
  if (!item) return finishSession();
  const { card, anchor } = item;
  const lesson = lessonFor(card, anchor);
  const result = ensureReviewResult(card, anchor);
  setHeader(`到期复习 · ${session.currentIndex + 1}/${session.selected.length}`);

  appMain.innerHTML = `
    <section class="flow-view learning-view review-view">
      <div class="flow-toolbar">
        <button id="quitReview" class="back-button" type="button">← 结束复习</button>
        <div class="flow-progress" aria-label="本轮复习进度">
          <span>${session.currentIndex + 1} / ${session.selected.length}</span>
          <div><i style="width:${((session.currentIndex + 1) / session.selected.length) * 100}%"></i></div>
        </div>
      </div>

      <div class="learning-layout">
        <article class="learning-surface review-surface">
          <div class="learning-meta"><span>到期复习</span><span>${escapeHtml(evidenceText(card))}</span></div>
          <div id="reviewContent"></div>
        </article>

        <aside class="session-rail">
          <span>本轮复习</span>
          <ol>${session.selected.map((selected, index) => `
            <li class="${index === session.currentIndex ? "active" : ""} ${index < session.currentIndex ? "done" : ""}">
              <i>${index < session.currentIndex ? "✓" : index + 1}</i>
              <div><strong>${index <= session.currentIndex ? escapeHtml(selected.anchor.word) : "待复习"}</strong><small>${index < session.currentIndex ? escapeHtml(selected.card.target) : index === session.currentIndex ? "正在回忆" : ""}</small></div>
            </li>`).join("")}</ol>
        </aside>
      </div>
    </section>`;

  document.querySelector("#quitReview").addEventListener("click", finishSession);
  const content = document.querySelector("#reviewContent");

  if (session.reviewStage === "bridge") {
    content.innerHTML = `
      <div class="step-copy compact-copy"><h1>看一遍词桥，再马上回忆。</h1></div>
      <div class="bridge-stage bridge-stage-complete">
        <div class="bridge-word known-word"><strong>${escapeHtml(anchor.word)}</strong><span>${escapeHtml(anchor.meaning)}</span></div>
        <div class="bridge-connector"><i></i><span>${escapeHtml(lesson.transform)}</span></div>
        <div class="bridge-word target-bridge-word"><strong>${escapeHtml(card.target)}</strong><span>${escapeHtml(card.meaning)}</span></div>
      </div>
      <div class="memory-line"><span>一句记忆</span><p>${escapeHtml(lesson.bridge)}</p></div>
      <div class="surface-actions"><button id="retryReview" class="primary-button" type="button">遮住答案，再写一次</button></div>`;
    document.querySelector("#retryReview").addEventListener("click", () => {
      session.reviewStage = "retry";
      session.feedback = null;
      renderReview();
    });
    return;
  }

  if (session.reviewStage === "result") {
    const resultCopy = result.outcome === "independent"
      ? ["独立记住", "没有查看词桥就拼写正确，复习间隔向后推进。", "correct"]
      : result.outcome === "recovered"
        ? ["借助词桥找回", "词桥帮助你重新想起了单词，10分钟后再确认一次。", "recovered"]
        : ["仍需复习", "这次还没有独立写出，10分钟后它会再次出现。", "review"];
    content.innerHTML = `
      <div class="review-result ${resultCopy[2]}">
        <span>${resultCopy[0]}</span>
        <strong>${escapeHtml(card.target)}</strong>
        <p>${resultCopy[1]}</p>
      </div>
      <div class="surface-actions"><button id="nextReviewWord" class="primary-button" type="button">${session.currentIndex + 1 >= session.selected.length ? "查看复习结果" : "复习下一词"}</button></div>`;
    document.querySelector("#nextReviewWord").addEventListener("click", finishReviewCard);
    return;
  }

  const isRetry = session.reviewStage === "retry";
  content.innerHTML = `
    <div class="step-copy">
      <p class="context-label">${isRetry ? "再次回忆" : "先独立回忆"}</p>
      <h1>${isRetry ? "遮住答案，再写一次。" : "只看提示，写出目标词。"}</h1>
    </div>
    <div class="recall-cue"><strong>${escapeHtml(anchor.word)}</strong><i>→</i><span>${escapeHtml(card.meaning)}</span></div>
    <p class="recall-prompt">${escapeHtml(lesson.recallPrompt)}</p>
    <form id="reviewForm" class="answer-form">
      <label for="reviewInput">完整拼写目标词</label>
      <input id="reviewInput" class="answer-input" autocomplete="off" autocapitalize="none" spellcheck="false" />
    </form>
    ${feedbackHtml()}
    <div class="surface-actions">
      <button id="checkReview" class="primary-button" type="button">检查拼写</button>
      ${isRetry ? '<button id="revealReviewAnswer" class="secondary-button" type="button">查看答案</button>' : ""}
    </div>`;

  const check = () => {
    const value = document.querySelector("#reviewInput").value.trim().toLowerCase();
    if (!value) return;
    if (value === card.target.toLowerCase()) {
      if (isRetry) {
        result.retryCorrect = true;
        result.outcome = "recovered";
        result.status = "review";
      } else {
        result.firstAttemptCorrect = true;
        result.outcome = "independent";
        result.status = "remembered";
      }
      session.reviewStage = "result";
      session.feedback = null;
    } else if (isRetry) {
      setSessionFeedback("拼写仍不正确。可以再试一次，或查看答案。", "incorrect");
    } else {
      result.bridgeViewed = true;
      session.reviewStage = "bridge";
      session.feedback = null;
    }
    renderReview();
  };

  document.querySelector("#reviewForm").addEventListener("submit", event => { event.preventDefault(); check(); });
  document.querySelector("#checkReview").addEventListener("click", check);
  document.querySelector("#revealReviewAnswer")?.addEventListener("click", () => {
    result.answerRevealed = true;
    result.outcome = "review";
    result.status = "review";
    session.reviewStage = "result";
    renderReview();
  });
  requestAnimationFrame(() => document.querySelector("#reviewInput")?.focus());
}

function finishReviewCard() {
  const { card, anchor } = currentReviewItem();
  const result = ensureReviewResult(card, anchor);
  result.durationMs = Math.max(0, Date.now() - result.startedAt);

  const previous = cardProgress(card.id);
  const schedule = card.review_schedule_minutes || [10, 1440, 10080];
  const nextLevel = result.outcome === "independent"
    ? Math.min((previous.reviewLevel ?? 0) + 1, schedule.length - 1)
    : 0;
  const now = new Date();
  profile.cardProgress[card.id] = {
    ...previous,
    mastery: result.outcome === "independent" ? 3 : result.outcome === "recovered" ? 2 : 1,
    studyCount: previous.studyCount + 1,
    reviewCount: previous.reviewCount + 1,
    reviewLevel: nextLevel,
    correctRecallCount: previous.correctRecallCount + (result.outcome === "independent" ? 1 : 0),
    selectedAnchor: anchor.word,
    lastStudiedAt: now.toISOString(),
    nextReviewAt: new Date(now.getTime() + schedule[nextLevel] * 60 * 1000).toISOString()
  };
  saveProfile();

  session.currentIndex += 1;
  session.reviewStage = "recall";
  session.feedback = null;
  if (session.currentIndex >= session.selected.length) finishSession();
  else renderReview();
}

function currentDiagnosticCard() {
  return session?.queue[session.scanIndex] ?? null;
}

function advanceDiagnostic() {
  if (!session) return;

  while (session.selected.length < SESSION_SIZE && session.scanIndex < session.queue.length) {
    const card = currentDiagnosticCard();
    const candidates = anchorsFor(card);
    const knownCandidate = candidates.find(candidate => profile.anchorKnowledge[candidate.word] === true);

    if (knownCandidate) {
      session.selected.push({ card, anchor: knownCandidate, reused: true });
      session.scanIndex += 1;
      session.candidateIndex = 0;
      continue;
    }

    while (
      session.candidateIndex < candidates.length &&
      profile.anchorKnowledge[candidates[session.candidateIndex].word] === false
    ) {
      session.candidateIndex += 1;
    }

    if (session.candidateIndex < candidates.length) {
      render();
      return;
    }

    session.skipped.push({ target: card.target, reason: "no_known_anchor" });
    session.scanIndex += 1;
    session.candidateIndex = 0;
  }

  if (session.selected.length) {
    view = "learn";
    session.currentIndex = 0;
    session.learningStage = "guess";
    session.feedback = null;
    render();
    return;
  }

  renderNoAnchorMatch();
}

function renderDiagnostic() {
  const card = currentDiagnosticCard();
  if (!card) return advanceDiagnostic();
  const candidates = anchorsFor(card);
  const candidate = candidates[session.candidateIndex];
  const isAlternative = session.candidateIndex > 0;
  setHeader(`熟词诊断 · 已选 ${session.selected.length}/${SESSION_SIZE}`);

  appMain.innerHTML = `
    <section class="flow-view diagnostic-view">
      <div class="flow-toolbar">
        <button id="cancelSession" class="back-button" type="button">← 返回首页</button>
        <div class="flow-progress" aria-label="本轮选词进度">
          <span>${session.selected.length} / ${SESSION_SIZE}</span>
          <div><i style="width:${(session.selected.length / SESSION_SIZE) * 100}%"></i></div>
        </div>
      </div>

      <div class="diagnostic-layout">
        <div class="diagnostic-task">
          <p class="context-label">${isAlternative ? "换一个入口" : "建立你的熟词档案"}</p>
          <h1>你认识这个词吗？</h1>
          <p>如果你能说出它的大致意思，就算认识。</p>
          <div class="anchor-focus">
            <strong>${escapeHtml(candidate.word)}</strong>
            <span>熟词候选 ${session.candidateIndex + 1}/${candidates.length}</span>
          </div>
          <div class="decision-actions">
            <button id="knowAnchor" class="primary-button decision-button" type="button">认识，使用它</button>
            <button id="dontKnowAnchor" class="secondary-button decision-button" type="button">不认识</button>
          </div>
        </div>

        <aside class="selection-rail">
          <span>本轮已找到的入口</span>
          <ol>${Array.from({ length: SESSION_SIZE }, (_, index) => {
            const item = session.selected[index];
            return `<li class="${item ? "filled" : ""}">${item
              ? `<strong>${escapeHtml(item.anchor.word)}</strong><small>通向一个新词</small>`
              : `<strong>${index + 1}</strong><small>等待选择</small>`}</li>`;
          }).join("")}</ol>
          <p>目标词暂时隐藏，避免你用“是否认识新词”代替熟词判断。</p>
        </aside>
      </div>
    </section>`;

  document.querySelector("#cancelSession").addEventListener("click", goHome);
  document.querySelector("#knowAnchor").addEventListener("click", () => chooseAnchor(true));
  document.querySelector("#dontKnowAnchor").addEventListener("click", () => chooseAnchor(false));
}

function chooseAnchor(isKnown) {
  const card = currentDiagnosticCard();
  const candidate = anchorsFor(card)[session.candidateIndex];
  profile.anchorKnowledge[candidate.word] = isKnown;
  saveProfile();

  if (isKnown) {
    session.selected.push({ card, anchor: candidate, reused: false });
    session.scanIndex += 1;
    session.candidateIndex = 0;
  } else {
    session.candidateIndex += 1;
  }
  advanceDiagnostic();
}

function renderNoAnchorMatch() {
  setHeader("熟词诊断");
  appMain.innerHTML = `
    <section class="empty-view">
      <h1>暂时没有找到合适的熟词入口</h1>
      <p>这不代表你学不会，只说明当前30词内容还没有覆盖你的旧知识。我们不会强行给你一条陌生的记忆桥。</p>
      <div class="home-actions">
        <button id="resetAndRetry" class="primary-button large-button" type="button">重新诊断</button>
        <button id="emptyGoHome" class="secondary-button large-button" type="button">返回首页</button>
      </div>
    </section>`;
  document.querySelector("#resetAndRetry").addEventListener("click", () => {
    profile.anchorKnowledge = {};
    saveProfile();
    startSession();
  });
  document.querySelector("#emptyGoHome").addEventListener("click", goHome);
}

function currentLearningItem() {
  return session.selected[session.currentIndex];
}

function evidenceText(card) {
  if (card.evidence_level === "L1") return "关系明确";
  if (card.evidence_level === "L2") return "关系有边界";
  return "助记联想";
}

function renderLearning() {
  const item = currentLearningItem();
  if (!item) return finishSession();
  const { card, anchor } = item;
  setHeader(`本轮学习 · ${session.currentIndex + 1}/${session.selected.length}`);

  appMain.innerHTML = `
    <section class="flow-view learning-view">
      <div class="flow-toolbar">
        <button id="quitLearning" class="back-button" type="button">← 结束本轮</button>
        <div class="flow-progress" aria-label="本轮学习进度">
          <span>${session.currentIndex + 1} / ${session.selected.length}</span>
          <div><i style="width:${((session.currentIndex + 1) / session.selected.length) * 100}%"></i></div>
        </div>
      </div>

      <div class="learning-layout">
        <article class="learning-surface">
          <div class="learning-meta">
            <span>步骤 ${learningStageNumber(session.learningStage)}/3</span>
            <span>${escapeHtml(evidenceText(card))}</span>
          </div>
          <div id="learningContent"></div>
        </article>

        <aside class="session-rail">
          <span>本轮5词</span>
          <ol>${session.selected.map((selected, index) => `
            <li class="${index === session.currentIndex ? "active" : ""} ${index < session.currentIndex ? "done" : ""}">
              <i>${index < session.currentIndex ? "✓" : index + 1}</i>
              <div><strong>${index <= session.currentIndex ? escapeHtml(selected.anchor.word) : "待解锁"}</strong><small>${index < session.currentIndex ? escapeHtml(selected.card.target) : index === session.currentIndex ? "正在学习" : ""}</small></div>
            </li>`).join("")}</ol>
        </aside>
      </div>
    </section>`;

  document.querySelector("#quitLearning").addEventListener("click", finishSession);
  if (session.learningStage === "guess") renderGuessStep(card, anchor);
  if (session.learningStage === "reveal") renderRevealStep(card, anchor);
  if (session.learningStage === "recall") renderRecallStep(card, anchor);
}

function learningStageNumber(stage) {
  return { guess: 1, reveal: 2, recall: 3 }[stage] ?? 1;
}

function learningContent() {
  return document.querySelector("#learningContent");
}

function setSessionFeedback(message, type) {
  session.feedback = { message, type };
}

function feedbackHtml() {
  if (!session.feedback) return "";
  return `<div class="feedback ${session.feedback.type}">${escapeHtml(session.feedback.message)}</div>`;
}

function renderGuessStep(card, anchor) {
  const lesson = lessonFor(card, anchor);
  learningContent().innerHTML = `
    <div class="step-copy">
      <p class="context-label">从你认识的词出发</p>
      <h1>沿着变化，猜一个新词。</h1>
    </div>
    <div class="bridge-stage bridge-stage-open">
      <div class="bridge-word known-word"><strong>${escapeHtml(anchor.word)}</strong><span>${escapeHtml(anchor.meaning)}</span></div>
      <div class="bridge-connector"><i></i><span>观察变化</span></div>
      <div class="bridge-word unknown-word"><strong>?</strong><span>${escapeHtml(card.meaning)}</span></div>
    </div>
    <p class="transform-hint">${escapeHtml(lesson.transform)}</p>
    <form id="guessForm" class="answer-form">
      <label for="guessInput">写出你想到的英文单词</label>
      <input id="guessInput" class="answer-input" autocomplete="off" autocapitalize="none" spellcheck="false" />
    </form>
    ${feedbackHtml()}
    <div class="surface-actions">
      <button id="submitGuess" class="primary-button" type="button">提交猜测</button>
      <button id="skipGuess" class="secondary-button" type="button">暂时不知道</button>
    </div>`;

  const submit = () => {
    const input = document.querySelector("#guessInput");
    const value = input.value.trim().toLowerCase();
    if (!value) return;
    const result = ensureSessionResult(card, anchor);
    result.guessAttempts += 1;
    if (value === card.target.toLowerCase()) {
      result.guessCorrect = true;
      session.learningStage = "reveal";
      setSessionFeedback("猜对了。现在把这条联系压缩成一座清晰的记忆桥。", "correct");
      renderLearning();
    } else {
      setSessionFeedback("还没有对。再看一次字母或构词变化，也可以直接查看记忆桥。", "incorrect");
      renderLearning();
      requestAnimationFrame(() => {
        const nextInput = document.querySelector("#guessInput");
        nextInput?.focus();
      });
    }
  };
  document.querySelector("#guessForm").addEventListener("submit", event => { event.preventDefault(); submit(); });
  document.querySelector("#submitGuess").addEventListener("click", submit);
  document.querySelector("#skipGuess").addEventListener("click", () => {
    ensureSessionResult(card, anchor).guessSkipped = true;
    session.learningStage = "reveal";
    session.feedback = null;
    renderLearning();
  });
  requestAnimationFrame(() => document.querySelector("#guessInput")?.focus());
}

function renderRevealStep(card, anchor) {
  const lesson = lessonFor(card, anchor);
  learningContent().innerHTML = `
    <div class="step-copy compact-copy">
      <p class="context-label">你的记忆桥</p>
      <h1>先记住最短路径。</h1>
    </div>
    <div class="bridge-stage bridge-stage-complete">
      <div class="bridge-word known-word"><strong>${escapeHtml(anchor.word)}</strong><span>${escapeHtml(anchor.meaning)}</span></div>
      <div class="bridge-connector"><i></i><span>${escapeHtml(lesson.transform)}</span></div>
      <div class="bridge-word target-bridge-word"><strong>${escapeHtml(card.target)}</strong><span>${escapeHtml(card.meaning)}</span></div>
    </div>
    <div class="memory-line"><span>一句记忆</span><p>${escapeHtml(lesson.bridge)}</p></div>
    <details class="explanation-details">
      <summary>为什么可以这样关联？</summary>
      <div class="explanation-grid">
        <div><span>事实边界</span><p>${escapeHtml(lesson.factBoundary)}</p></div>
        <div><span>易混辨析</span><p>${escapeHtml(card.confusion_note || card.warning)}</p></div>
        <div class="wide"><span>例句</span><p class="example-text">${escapeHtml(card.example)}</p><small>${escapeHtml(card.example_translation)}</small></div>
      </div>
    </details>
    ${feedbackHtml()}
    <div class="surface-actions">
      <button id="startRecall" class="primary-button" type="button">遮住答案，马上回忆</button>
    </div>`;
  document.querySelector("#startRecall").addEventListener("click", () => {
    session.learningStage = "recall";
    session.feedback = null;
    renderLearning();
  });
}

function renderRecallStep(card, anchor) {
  const result = ensureSessionResult(card, anchor);
  const lesson = lessonFor(card, anchor);
  const answered = result.recallAnswered;
  learningContent().innerHTML = `
    <div class="step-copy">
      <p class="context-label">主动回忆</p>
      <h1>不看答案，再写一次新词。</h1>
    </div>
    <div class="recall-cue">
      <strong>${escapeHtml(anchor.word)}</strong><i>→</i><span>${escapeHtml(card.meaning)}</span>
    </div>
    <p class="recall-prompt">${escapeHtml(lesson.recallPrompt)}</p>
    <form id="recallForm" class="answer-form">
      <label for="recallInput">完整拼写目标词</label>
      <input id="recallInput" class="answer-input" autocomplete="off" autocapitalize="none" spellcheck="false" ${answered ? "disabled" : ""} />
    </form>
    ${feedbackHtml()}
    <div id="recallActions" class="surface-actions"></div>`;

  const actionArea = document.querySelector("#recallActions");
  if (answered) {
    actionArea.innerHTML = `
      <button id="rememberedWord" class="primary-button" type="button">记住了</button>
      <button id="reviewWord" class="secondary-button" type="button">还需复习</button>`;
    document.querySelector("#rememberedWord").addEventListener("click", () => finishCurrentCard("remembered"));
    document.querySelector("#reviewWord").addEventListener("click", () => finishCurrentCard("review"));
    return;
  }

  actionArea.innerHTML = `
    <button id="checkRecall" class="primary-button" type="button">检查拼写</button>
    <button id="showRecallAnswer" class="secondary-button" type="button">查看答案</button>`;

  const check = () => {
    const input = document.querySelector("#recallInput");
    const value = input.value.trim().toLowerCase();
    if (!value) return;
    result.recallAttempts += 1;
    if (value === card.target.toLowerCase()) {
      result.recallCorrect = true;
      result.recallAnswered = true;
      setSessionFeedback(`拼写正确：${card.target}`, "correct");
    } else {
      setSessionFeedback(`还差一点。提示：${lesson.transform}`, "incorrect");
    }
    renderLearning();
    requestAnimationFrame(() => document.querySelector("#recallInput")?.focus());
  };

  document.querySelector("#recallForm").addEventListener("submit", event => { event.preventDefault(); check(); });
  document.querySelector("#checkRecall").addEventListener("click", check);
  document.querySelector("#showRecallAnswer").addEventListener("click", () => {
    result.recallAnswered = true;
    result.answerRevealed = true;
    setSessionFeedback(`答案是 ${card.target}。请读一遍，再诚实判断是否需要复习。`, "incorrect");
    renderLearning();
  });
  requestAnimationFrame(() => document.querySelector("#recallInput")?.focus());
}

function ensureSessionResult(card, anchor) {
  let result = session.results.find(item => item.cardId === card.id);
  if (!result) {
    result = {
      cardId: card.id,
      target: card.target,
      anchor: anchor.word,
      startedAt: Date.now(),
      guessAttempts: 0,
      guessCorrect: false,
      guessSkipped: false,
      recallAttempts: 0,
      recallCorrect: false,
      recallAnswered: false,
      answerRevealed: false,
      status: null,
      durationMs: 0
    };
    session.results.push(result);
  }
  return result;
}

function finishCurrentCard(status) {
  const { card, anchor } = currentLearningItem();
  const result = ensureSessionResult(card, anchor);
  result.status = status;
  result.durationMs = Math.max(0, Date.now() - result.startedAt);

  const now = new Date();
  const delayMinutes = status === "remembered"
    ? (card.review_schedule_minutes?.[1] ?? 1440)
    : (card.review_schedule_minutes?.[0] ?? 10);
  const previous = cardProgress(card.id);
  profile.cardProgress[card.id] = {
    ...previous,
    mastery: status === "remembered" ? 3 : 1,
    studyCount: previous.studyCount + 1,
    reviewLevel: status === "remembered" ? 1 : 0,
    correctRecallCount: previous.correctRecallCount + (result.recallCorrect ? 1 : 0),
    selectedAnchor: anchor.word,
    lastStudiedAt: now.toISOString(),
    nextReviewAt: new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString()
  };
  saveProfile();

  session.currentIndex += 1;
  session.learningStage = "guess";
  session.feedback = null;
  if (session.currentIndex >= session.selected.length) finishSession();
  else renderLearning();
}

function finishSession() {
  if (!session) return goHome();
  if (!session.completedAt) {
    session.completedAt = Date.now();
    profile.sessions.unshift({
      id: session.id,
      mode: session.mode || "learn",
      startedAt: new Date(session.startedAt).toISOString(),
      completedAt: new Date(session.completedAt).toISOString(),
      selectedWords: session.selected.map(item => item.card.target),
      skippedTargets: (session.skipped ?? []).map(item => item.target),
      results: session.results.map(result => ({ ...result }))
    });
    profile.sessions = profile.sessions.slice(0, 30);
    saveProfile();
  }
  view = "complete";
  render();
}

function renderComplete() {
  const results = session?.results ?? [];
  if (session?.mode === "review") return renderReviewComplete(results);
  const remembered = results.filter(result => result.status === "remembered").length;
  const review = results.filter(result => result.status === "review").length;
  const minutes = Math.max(1, Math.round(((session?.completedAt ?? Date.now()) - (session?.startedAt ?? Date.now())) / 60000));
  setHeader("本轮完成");

  appMain.innerHTML = `
    <section class="complete-view">
      <div class="complete-mark">✓</div>
      <p class="context-label">本轮完成</p>
      <h1>你已经搭好 ${results.length} 座词桥。</h1>
      <p class="complete-copy">记忆不是一次判定。需要复习的词会更早回来，已经记住的词会在一天后再次确认。</p>

      <div class="completion-stats">
        <div><strong>${remembered}</strong><span>暂时记住</span></div>
        <div><strong>${review}</strong><span>需要复习</span></div>
        <div><strong>${minutes}</strong><span>本轮分钟</span></div>
      </div>

      <div class="result-list">
        ${results.length ? results.map(result => `
          <div>
            <span><strong>${escapeHtml(result.anchor)}</strong><i>→</i><strong>${escapeHtml(result.target)}</strong></span>
            <em class="${result.status === "remembered" ? "remembered" : "review"}">${result.status === "remembered" ? "已记住" : "待复习"}</em>
          </div>`).join("") : '<p class="empty-result">本轮尚未完成任何单词。</p>'}
      </div>

      <div class="home-actions centered-actions">
        <button id="completeHome" class="primary-button large-button" type="button">返回首页</button>
        <button id="anotherSession" class="secondary-button large-button" type="button">再学5词</button>
      </div>
    </section>`;

  document.querySelector("#completeHome").addEventListener("click", goHome);
  document.querySelector("#anotherSession").addEventListener("click", startSession);
}

function renderReviewComplete(results) {
  const independent = results.filter(result => result.outcome === "independent").length;
  const recovered = results.filter(result => result.outcome === "recovered").length;
  const review = results.filter(result => result.outcome === "review").length;
  setHeader("复习完成");

  appMain.innerHTML = `
    <section class="complete-view review-complete-view">
      <div class="complete-mark">✓</div>
      <p class="context-label">复习完成</p>
      <h1>完成 ${results.length} 个到期单词。</h1>
      <p class="complete-copy">独立写出的词会延长复习间隔；借助词桥找回或仍未写出的词，会在10分钟后再次确认。</p>

      <div class="completion-stats">
        <div><strong>${independent}</strong><span>独立记住</span></div>
        <div><strong>${recovered}</strong><span>词桥找回</span></div>
        <div><strong>${review}</strong><span>仍需复习</span></div>
      </div>

      <div class="result-list">
        ${results.length ? results.map(result => `
          <div>
            <span><strong>${escapeHtml(result.anchor)}</strong><i>→</i><strong>${escapeHtml(result.target)}</strong></span>
            <em class="${result.outcome === "independent" ? "remembered" : "review"}">${result.outcome === "independent" ? "独立记住" : result.outcome === "recovered" ? "词桥找回" : "待复习"}</em>
          </div>`).join("") : '<p class="empty-result">本轮尚未完成任何复习。</p>'}
      </div>

      <div class="home-actions centered-actions">
        <button id="reviewCompleteHome" class="primary-button large-button" type="button">返回首页</button>
        ${dueReviewCount() ? '<button id="continueReview" class="secondary-button large-button" type="button">继续复习</button>' : ""}
      </div>
    </section>`;

  document.querySelector("#reviewCompleteHome").addEventListener("click", goHome);
  document.querySelector("#continueReview")?.addEventListener("click", startReviewSession);
}

function goHome() {
  view = "home";
  session = null;
  render();
}

function openWordList() {
  renderWordGrid();
  wordListDialog.showModal();
}

function renderWordGrid() {
  const grid = document.querySelector("#wordGrid");
  grid.innerHTML = cards.map(card => {
    const item = cardProgress(card.id);
    const status = item.studyCount
      ? item.mastery === 3 ? "已记住" : "待复习"
      : "未学习";
    return `<div class="word-tile" data-status="${item.mastery}">
      <strong>${escapeHtml(card.target)}</strong>
      <span>${escapeHtml(item.selectedAnchor || card.anchor)} → ${status}</span>
    </div>`;
  }).join("");
}

document.querySelector("#goHome").addEventListener("click", goHome);
document.querySelector("#openWordList").addEventListener("click", openWordList);
document.querySelector("#closeWordList").addEventListener("click", () => wordListDialog.close());
document.querySelector("#resetAnchors").addEventListener("click", () => {
  if (!confirm("确定重新建立熟词档案吗？学习过的新词记录会保留。")) return;
  profile.anchorKnowledge = {};
  saveProfile();
  wordListDialog.close();
  goHome();
});
document.querySelector("#resetAll").addEventListener("click", () => {
  if (!confirm("确定清空熟词档案和全部学习记录吗？")) return;
  profile = emptyProfile();
  saveProfile();
  wordListDialog.close();
  goHome();
});

try {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  cards = data.cards;
  render();
} catch (error) {
  setHeader("数据加载失败");
  appMain.innerHTML = `
    <section class="empty-view">
      <h1>暂时无法读取词卡</h1>
      <p>${escapeHtml(error.message)}。请通过项目本地服务器打开本页面。</p>
    </section>`;
}
