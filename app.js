import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = window.NOVELCHAIN_ENV || {};
const supabase = env.SUPABASE_URL && env.SUPABASE_ANON_KEY ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY) : null;
const $ = (selector) => document.querySelector(selector);
const els = {
  configNotice: $("#configNotice"), authView: $("#authView"), authForm: $("#authForm"), authEmail: $("#authEmail"),
  authPassword: $("#authPassword"), signupButton: $("#signupButton"), accountBar: $("#accountBar"),
  accountEmail: $("#accountEmail"), logoutButton: $("#logoutButton"), lobbyView: $("#lobbyView"), gameView: $("#gameView"),
  createRoomForm: $("#createRoomForm"), joinRoomForm: $("#joinRoomForm"), createName: $("#createName"),
  joinName: $("#joinName"), roomTitle: $("#roomTitle"), maxLines: $("#maxLines"), allowEdits: $("#allowEdits"),
  roomCode: $("#roomCode"), activeRoomCode: $("#activeRoomCode"), activeRoomTitle: $("#activeRoomTitle"),
  ruleText: $("#ruleText"), playerList: $("#playerList"), storyHeading: $("#storyHeading"), storyLines: $("#storyLines"),
  lineForm: $("#lineForm"), lineInput: $("#lineInput"), lineHint: $("#lineHint"), hostSettings: $("#hostSettings"),
  hostMaxLines: $("#hostMaxLines"), hostAllowEdits: $("#hostAllowEdits"), completeButton: $("#completeButton"),
  leaveButton: $("#leaveButton"), historyButton: $("#historyButton"), historyDialog: $("#historyDialog"),
  closeHistory: $("#closeHistory"), historyList: $("#historyList"), downloadTxt: $("#downloadTxt"), downloadPdf: $("#downloadPdf"),
  chatMessages: $("#chatMessages"), chatForm: $("#chatForm"), chatInput: $("#chatInput"), toast: $("#toast"),
  rejoinCard: $("#rejoinCard"), rejoinTitle: $("#rejoinTitle"), rejoinMeta: $("#rejoinMeta"), rejoinButton: $("#rejoinButton"),
  readerView: $("#readerView"), closeReader: $("#closeReader"), readerTxt: $("#readerTxt"), readerPdf: $("#readerPdf"),
  readerMeta: $("#readerMeta"), readerTitle: $("#readerTitle"), readerLines: $("#readerLines"),
};
const state = { session: null, user: null, room: null, player: null, players: [], lines: [], chatMessages: [], channel: null, lastTurnKey: "", readerStory: null };
const rejoinWindowMs = 30 * 60 * 1000;
const clientId = localStorage.getItem("novelchain.clientId") || crypto.randomUUID();
localStorage.setItem("novelchain.clientId", clientId);

if (!supabase) els.configNotice.classList.remove("hidden");
els.authForm.addEventListener("submit", login);
els.signupButton.addEventListener("click", signup);
els.logoutButton.addEventListener("click", logout);
els.createRoomForm.addEventListener("submit", createRoom);
els.joinRoomForm.addEventListener("submit", joinRoom);
els.lineForm.addEventListener("submit", addLine);
els.chatForm.addEventListener("submit", sendChat);
els.hostSettings.addEventListener("submit", saveSettings);
els.completeButton.addEventListener("click", completeRoom);
els.leaveButton.addEventListener("click", leaveRoom);
els.historyButton.addEventListener("click", openHistory);
els.closeHistory.addEventListener("click", () => els.historyDialog.close());
els.downloadTxt.addEventListener("click", downloadTxt);
els.downloadPdf.addEventListener("click", downloadPdf);
els.rejoinButton.addEventListener("click", rejoinRecentRoom);
els.closeReader.addEventListener("click", closeReader);
els.readerTxt.addEventListener("click", () => downloadStory(state.readerStory, "txt"));
els.readerPdf.addEventListener("click", () => downloadStory(state.readerStory, "pdf"));
initAuth();

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}
function needSupabase() { if (supabase) return true; toast("Supabase env is missing."); return false; }
function needUser() { if (state.user) return true; toast("Please login first."); return false; }
function hostKey(code) { return localStorage.getItem(`novelchain.host.${code}`); }
function isHost() { return state.room && hostKey(state.room.code) === state.room.host_key; }
function codeValue(value) { return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function initAuth() {
  if (!supabase) return renderAuth();
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;
  renderAuth();
  supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    if (!state.user && state.room) leaveRoom();
    renderAuth();
  });
}
function renderAuth() {
  const signedIn = Boolean(state.user);
  els.authView.classList.toggle("hidden", signedIn);
  els.accountBar.classList.toggle("hidden", !signedIn);
  const inRoom = Boolean(state.room);
  els.lobbyView.classList.toggle("hidden", !signedIn || inRoom);
  els.accountEmail.textContent = state.user?.email || "";
  renderRejoin();
}
async function login(event) {
  event.preventDefault();
  if (!needSupabase()) return;
  const { error } = await supabase.auth.signInWithPassword({ email: els.authEmail.value.trim(), password: els.authPassword.value });
  toast(error ? error.message : "Logged in.");
}
async function signup() {
  if (!needSupabase() || !els.authForm.reportValidity()) return;
  const { error } = await supabase.auth.signUp({ email: els.authEmail.value.trim(), password: els.authPassword.value });
  toast(error ? error.message : "Signed up.");
}
async function logout() {
  if (!needSupabase()) return;
  await supabase.auth.signOut();
  toast("Logged out.");
}

async function createRoom(event) {
  event.preventDefault();
  if (!needSupabase() || !needUser()) return;
  const key = crypto.randomUUID();
  const room = {
    code: newCode(), title: els.roomTitle.value.trim(), owner_id: state.user.id, host_key: key,
    host_name: els.createName.value.trim(), max_lines_per_player: Number(els.maxLines.value), allow_edits: els.allowEdits.checked,
  };
  const { data, error } = await supabase.from("rooms").insert(room).select().single();
  if (error) return toast(error.message);
  localStorage.setItem(`novelchain.host.${data.code}`, key);
  enterRoom(data, els.createName.value.trim());
}
async function joinRoom(event) {
  event.preventDefault();
  if (!needSupabase() || !needUser()) return;
  const { data, error } = await supabase.from("rooms").select("*").eq("code", codeValue(els.roomCode.value)).maybeSingle();
  if (error || !data) return toast("Room not found.");
  enterRoom(data, els.joinName.value.trim());
}
async function enterRoom(room, playerName) {
  const existing = await supabase.from("players").select("*").eq("room_id", room.id).eq("user_id", state.user.id).maybeSingle();
  let player = existing.data;
  if (!player) {
    const res = await supabase.from("players").insert({ room_id: room.id, user_id: state.user.id, client_id: clientId, name: playerName }).select().single();
    if (res.error) return toast(res.error.message);
    player = res.data;
  } else if (player.name !== playerName) {
    const res = await supabase.from("players").update({ name: playerName }).eq("id", player.id).select().single();
    player = res.data || player;
  }
  state.room = room;
  state.player = player;
  saveRecentRoom(room, player.name);
  els.lobbyView.classList.add("hidden");
  els.rejoinCard.classList.add("hidden");
  els.readerView.classList.add("hidden");
  els.gameView.classList.remove("hidden");
  await loadRoom();
  subscribeRoom();
  render();
}
async function loadRoom() {
  if (!state.room) return;
  const [room, players, lines, chat] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", state.room.id).single(),
    supabase.from("players").select("*").eq("room_id", state.room.id).order("created_at"),
    supabase.from("lines").select("*").eq("room_id", state.room.id).order("position"),
    supabase.from("chat_messages").select("*").eq("room_id", state.room.id).order("created_at").limit(80),
  ]);
  if (!room.error) state.room = room.data;
  if (!players.error) state.players = players.data;
  if (!lines.error) state.lines = lines.data;
  if (!chat.error) state.chatMessages = chat.data;
}
function subscribeRoom() {
  if (state.channel) supabase.removeChannel(state.channel);
  const filter = `room_id=eq.${state.room.id}`;
  state.channel = supabase.channel(`room-${state.room.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${state.room.id}` }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "lines", filter }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter }, reload)
    .subscribe();
}
async function reload() { await loadRoom(); render(); }

function eligiblePlayers() {
  return state.players.filter((player) => state.lines.filter((line) => line.player_id === player.id).length < state.room.max_lines_per_player);
}
function currentTurn() {
  if (!state.room || state.room.status === "completed") return null;
  const eligible = eligiblePlayers();
  if (!eligible.length) return null;
  const last = state.lines.at(-1);
  if (!last) return eligible[0];
  const start = Math.max(0, state.players.findIndex((player) => player.id === last.player_id) + 1);
  for (let i = 0; i < state.players.length; i += 1) {
    const player = state.players[(start + i) % state.players.length];
    if (eligible.some((item) => item.id === player.id)) return player;
  }
  return null;
}
function notifyTurn(player) {
  if (!player || player.id !== state.player?.id) return;
  const key = `${state.room.id}:${state.lines.length}:${player.id}`;
  if (state.lastTurnKey === key) return;
  state.lastTurnKey = key;
  toast("Your turn.");
}
async function addLine(event) {
  event.preventDefault();
  const turn = currentTurn();
  const ownCount = state.lines.filter((line) => line.player_id === state.player.id).length;
  if (state.room.status === "completed") return toast("This story is complete.");
  if (ownCount >= state.room.max_lines_per_player) return toast("No lines left.");
  if (turn?.id !== state.player.id) return toast(turn ? `${turn.name}'s turn.` : "No active turn.");
  const content = els.lineInput.value.trim();
  if (!content) return;
  for (let i = 0; i < 3; i += 1) {
    if (i) await loadRoom();
    const position = state.lines.length ? Math.max(...state.lines.map((line) => line.position)) + 1 : 1;
    const res = await supabase
      .from("lines")
      .insert({ room_id: state.room.id, player_id: state.player.id, user_id: state.user.id, player_name: state.player.name, content, position })
      .select()
      .single();
    if (!res.error) {
      els.lineInput.value = "";
      state.lines = [...state.lines.filter((line) => line.id !== res.data.id), res.data].sort((a, b) => a.position - b.position);
      render();
      await loadRoom();
      render();
      return;
    }
    if (!res.error.message.includes("duplicate key")) return toast(res.error.message);
  }
  toast("Try again.");
}
async function sendChat(event) {
  event.preventDefault();
  const content = els.chatInput.value.trim();
  if (!content) return;
  const { error } = await supabase.from("chat_messages").insert({ room_id: state.room.id, user_id: state.user.id, player_id: state.player.id, player_name: state.player.name, content });
  if (error) return toast(error.message);
  els.chatInput.value = "";
}
async function saveSettings(event) {
  event.preventDefault();
  if (!isHost()) return;
  const { error } = await supabase.from("rooms").update({ max_lines_per_player: Number(els.hostMaxLines.value), allow_edits: els.hostAllowEdits.checked, updated_at: new Date().toISOString() }).eq("id", state.room.id);
  toast(error ? error.message : "Saved.");
}
async function completeRoom() {
  if (!isHost()) return;
  const { error } = await supabase.from("rooms").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", state.room.id);
  toast(error ? error.message : "Saved to History.");
}
async function updateLine(line, content) {
  if (!state.room.allow_edits || line.player_id !== state.player.id) return;
  const { error } = await supabase.from("lines").update({ content, updated_at: new Date().toISOString() }).eq("id", line.id);
  if (error) toast(error.message);
}

function render() {
  const ownCount = state.lines.filter((line) => line.player_id === state.player?.id).length;
  const remaining = Math.max(state.room.max_lines_per_player - ownCount, 0);
  const turn = currentTurn();
  const canWrite = remaining > 0 && turn?.id === state.player?.id && state.room.status !== "completed";
  els.activeRoomCode.textContent = state.room.code;
  els.activeRoomTitle.textContent = state.room.title;
  els.storyHeading.textContent = state.room.status === "completed" ? "완성된 소설" : "함께 쓰는 중";
  els.ruleText.textContent = `사람당 ${state.room.max_lines_per_player}줄 · 수정 ${state.room.allow_edits ? "가능" : "불가"}`;
  els.lineHint.textContent = state.room.status === "completed" ? "완성된 소설입니다." : canWrite ? `당신의 차례 · 남은 줄 ${remaining}` : turn ? `${turn.name}님의 차례 · 내 남은 줄 ${remaining}` : "모든 줄을 사용했습니다.";
  els.hostSettings.classList.toggle("hidden", !isHost());
  els.hostMaxLines.value = state.room.max_lines_per_player;
  els.hostAllowEdits.checked = state.room.allow_edits;
  els.lineForm.classList.toggle("locked", !canWrite);
  els.lineForm.classList.toggle("is-turn", canWrite);
  els.lineInput.disabled = !canWrite;
  els.lineForm.querySelector("button").disabled = !canWrite;
  notifyTurn(turn);
  renderPlayers(turn);
  renderLines();
  renderChat();
}
function renderPlayers(turn) {
  els.playerList.replaceChildren(...state.players.map((player) => {
    const li = document.createElement("li");
    const count = state.lines.filter((line) => line.player_id === player.id).length;
    li.classList.toggle("current-turn", turn?.id === player.id);
    li.innerHTML = `<span>${escapeHtml(player.name)}</span><strong>${count}/${state.room.max_lines_per_player}</strong>`;
    return li;
  }));
}
function renderLines() {
  if (!state.lines.length) {
    const li = document.createElement("li");
    li.className = "empty-line";
    li.textContent = "아직 첫 문장이 없습니다.";
    els.storyLines.replaceChildren(li);
    return;
  }
  els.storyLines.replaceChildren(...state.lines.map((line) => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="line-meta"><span>${escapeHtml(line.player_name)}</span><time>${formatTime(line.created_at)}</time></div><p>${escapeHtml(line.content)}</p>`;
    if (state.room.allow_edits && line.player_id === state.player?.id && state.room.status !== "completed") {
      const button = document.createElement("button");
      button.className = "ghost compact";
      button.type = "button";
      button.textContent = "수정";
      button.addEventListener("click", () => {
        const next = prompt("문장을 수정하세요.", line.content);
        if (next?.trim()) updateLine(line, next.trim());
      });
      li.append(button);
    }
    return li;
  }));
}
function renderChat() {
  if (!state.chatMessages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-chat";
    empty.textContent = "아직 채팅이 없습니다.";
    els.chatMessages.replaceChildren(empty);
    return;
  }
  els.chatMessages.replaceChildren(...state.chatMessages.map((message) => {
    const item = document.createElement("article");
    item.className = "chat-message";
    item.classList.toggle("mine", message.user_id === state.user?.id);
    item.innerHTML = `<div><strong>${escapeHtml(message.player_name)}</strong><time>${formatTime(message.created_at)}</time></div><p>${escapeHtml(message.content)}</p>`;
    return item;
  }));
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function recentRoomKey() { return `novelchain.recent.${state.user?.id || "guest"}`; }
function getRecentRoom() {
  if (!state.user) return null;
  try {
    const recent = JSON.parse(localStorage.getItem(recentRoomKey()) || "null");
    if (!recent || Date.now() - recent.savedAt > rejoinWindowMs) {
      localStorage.removeItem(recentRoomKey());
      return null;
    }
    return recent;
  } catch {
    return null;
  }
}
function saveRecentRoom(room, playerName) {
  if (!state.user || !room?.id) return;
  localStorage.setItem(recentRoomKey(), JSON.stringify({
    roomId: room.id,
    code: room.code,
    title: room.title,
    playerName,
    savedAt: Date.now(),
  }));
}
function renderRejoin() {
  const recent = getRecentRoom();
  const show = Boolean(state.user && !state.room && recent);
  els.rejoinCard.classList.toggle("hidden", !show);
  if (!show) return;
  const minutesLeft = Math.max(1, Math.ceil((rejoinWindowMs - (Date.now() - recent.savedAt)) / 60000));
  els.rejoinTitle.textContent = recent.title || "최근 방";
  els.rejoinMeta.textContent = `${recent.code} · ${minutesLeft}분 안에 다시 접속 가능`;
}
async function rejoinRecentRoom() {
  if (!needSupabase() || !needUser()) return;
  const recent = getRecentRoom();
  if (!recent) return renderAuth();
  const { data, error } = await supabase.from("rooms").select("*").eq("id", recent.roomId).maybeSingle();
  if (error || !data) {
    localStorage.removeItem(recentRoomKey());
    renderAuth();
    return toast("다시 접속할 방을 찾지 못했습니다.");
  }
  await enterRoom(data, recent.playerName || "작가");
}
async function deleteHistoryRoom(roomId) {
  const rpc = await supabase.rpc("delete_completed_room", { target_room_id: roomId });
  if (!rpc.error) return rpc;
  return supabase.from("rooms").delete().eq("id", roomId).eq("owner_id", state.user.id).eq("status", "completed");
}
function openReader(story) {
  state.readerStory = story;
  if (els.historyDialog.open) els.historyDialog.close();
  if (state.channel) supabase.removeChannel(state.channel);
  state.channel = null;
  els.authView.classList.add("hidden");
  els.lobbyView.classList.add("hidden");
  els.gameView.classList.add("hidden");
  els.rejoinCard.classList.add("hidden");
  els.readerView.classList.remove("hidden");
  els.readerMeta.textContent = `${story.code} · ${formatDate(story.completed_at || story.created_at)}`;
  els.readerTitle.textContent = story.title;
  els.readerLines.replaceChildren(...story.lines.map((line) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(line.player_name)}</span><p>${escapeHtml(line.content)}</p>`;
    return li;
  }));
}
function closeReader() {
  state.readerStory = null;
  els.readerView.classList.add("hidden");
  if (state.room) {
    els.gameView.classList.remove("hidden");
    subscribeRoom();
    reload();
  } else {
    renderAuth();
  }
}

async function openHistory() {
  if (!needSupabase() || !needUser()) return;
  els.historyList.textContent = "불러오는 중...";
  if (!els.historyDialog.open) els.historyDialog.showModal();
  await loadHistory();
}
async function loadHistory() {
  const { data, error } = await supabase.from("rooms").select("id, code, title, owner_id, completed_at, created_at, lines(content, position, player_name)").eq("status", "completed").order("completed_at", { ascending: false }).limit(20);
  if (error) { els.historyList.textContent = error.message; return; }
  renderHistory(data || []);
}
function renderHistory(rooms) {
  if (!rooms.length) { els.historyList.textContent = "완성된 소설이 아직 없습니다."; return; }
  els.historyList.replaceChildren(...rooms.map((room) => {
    const item = document.createElement("article");
    const lines = [...(room.lines || [])].sort((a, b) => a.position - b.position);
    const story = { ...room, lines };
    item.className = "history-item";
    item.innerHTML = `<div class="history-title"><strong>${escapeHtml(room.title)}</strong><span>${escapeHtml(room.code)} · ${formatDate(room.completed_at || room.created_at)} · ${lines.length}줄</span></div><div class="history-actions"><button class="secondary compact history-read" type="button">크게 보기</button>${room.owner_id === state.user?.id ? '<button class="danger compact history-delete" type="button">삭제</button>' : ""}</div>`;
    item.querySelector(".history-read").addEventListener("click", () => openReader(story));
    item.querySelector(".history-delete")?.addEventListener("click", async () => {
      if (!confirm(`'${room.title}'을(를) 삭제할까요?`)) return;
      const { error } = await deleteHistoryRoom(room.id);
      toast(error ? error.message : "Deleted.");
      if (!error) await loadHistory();
    });
    return item;
  }));
}
function leaveRoom() {
  if (state.room && state.player) saveRecentRoom(state.room, state.player.name);
  if (state.channel) supabase.removeChannel(state.channel);
  Object.assign(state, { room: null, player: null, players: [], lines: [], chatMessages: [], channel: null, lastTurnKey: "" });
  els.gameView.classList.add("hidden");
  renderAuth();
}
function currentStory() { return state.room ? { ...state.room, lines: state.lines } : null; }
function storyText(story) { return `${story?.title || "NovelChain"}\n\n${(story?.lines || []).map((line) => line.content).join("\n")}\n`; }
function downloadTxt() {
  downloadStory(currentStory(), "txt");
}
function downloadPdf() {
  downloadStory(currentStory(), "pdf");
}
function downloadStory(story, type) {
  if (!story) return;
  if (type === "txt") {
    const blob = new Blob([storyText(story)], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${story.code}-${slugify(story.title)}.txt`);
    return;
  }
  const PDF = window.jspdf?.jsPDF;
  if (!PDF) return toast("PDF unavailable.");
  const doc = new PDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  renderStoryCanvases(story, pageWidth, pageHeight).forEach((canvas, index) => {
    if (index) doc.addPage();
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, pageHeight);
  });
  doc.save(`${story.code}-${slugify(story.title)}.pdf`);
}
function renderStoryCanvases(story, pageWidth, pageHeight) {
  const scale = 2, margin = 48, contentWidth = (pageWidth - margin * 2) * scale, lineHeight = 24 * scale, pages = [];
  let canvas, ctx, y;
  const newPage = () => {
    canvas = document.createElement("canvas"); canvas.width = pageWidth * scale; canvas.height = pageHeight * scale;
    ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.textBaseline = "top"; y = margin * scale; pages.push(canvas);
  };
  const draw = (text, font, color, gap = 8 * scale) => {
    ctx.font = font; ctx.fillStyle = color;
    const lines = String(text).split(/(\s+)/).reduce((acc, word) => {
      const next = (acc.current || "") + word;
      if (ctx.measureText(next).width > contentWidth && acc.current) { acc.lines.push(acc.current.trimEnd()); acc.current = word.trimStart(); } else acc.current = next;
      return acc;
    }, { lines: [], current: "" });
    if (lines.current) lines.lines.push(lines.current.trimEnd());
    lines.lines.forEach((line) => { if (y + lineHeight > (pageHeight - margin) * scale) newPage(); ctx.fillText(line, margin * scale, y); y += lineHeight; });
    y += gap;
  };
  newPage();
  draw(story.title, `700 ${24 * scale}px system-ui, sans-serif`, "#181a20", 20 * scale);
  story.lines.forEach((line, index) => draw(`${index + 1}. ${line.content}`, `400 ${15 * scale}px system-ui, sans-serif`, "#262b34", 10 * scale));
  return pages;
}
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function formatTime(value) { return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatDate(value) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function slugify(value) { return codeValue(value).slice(0, 32) || "novel"; }
