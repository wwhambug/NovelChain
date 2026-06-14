import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = window.NOVELCHAIN_ENV || {};
const supabase = env.SUPABASE_URL && env.SUPABASE_ANON_KEY ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY) : null;
const $ = (selector) => document.querySelector(selector);
const els = {
  configNotice: $("#configNotice"), authView: $("#authView"), authForm: $("#authForm"), authEmail: $("#authEmail"),
  authPassword: $("#authPassword"), signupButton: $("#signupButton"), accountBar: $("#accountBar"),
  accountEmail: $("#accountEmail"), logoutButton: $("#logoutButton"), lobbyView: $("#lobbyView"), gameView: $("#gameView"),
  myButton: $("#myButton"), myDialog: $("#myDialog"), closeMy: $("#closeMy"), profileForm: $("#profileForm"),
  profileNickname: $("#profileNickname"), anonymousLength: $("#anonymousLength"), friendForm: $("#friendForm"),
  friendNickname: $("#friendNickname"), friendList: $("#friendList"), createRoomForm: $("#createRoomForm"),
  joinRoomForm: $("#joinRoomForm"), createName: $("#createName"), createAnonymous: $("#createAnonymous"),
  joinName: $("#joinName"), joinAnonymous: $("#joinAnonymous"), roomTitle: $("#roomTitle"), maxLines: $("#maxLines"), allowEdits: $("#allowEdits"),
  roomCode: $("#roomCode"), activeRoomCode: $("#activeRoomCode"), activeRoomTitle: $("#activeRoomTitle"),
  ruleText: $("#ruleText"), playerList: $("#playerList"), storyHeading: $("#storyHeading"), storyLines: $("#storyLines"),
  lineForm: $("#lineForm"), lineInput: $("#lineInput"), lineHint: $("#lineHint"), hostSettings: $("#hostSettings"),
  hostMaxLines: $("#hostMaxLines"), hostAllowEdits: $("#hostAllowEdits"), completeButton: $("#completeButton"),
  copyInviteButton: $("#copyInviteButton"), roomFriendList: $("#roomFriendList"),
  leaveButton: $("#leaveButton"), historyButton: $("#historyButton"), historyDialog: $("#historyDialog"),
  closeHistory: $("#closeHistory"), historyList: $("#historyList"), downloadTxt: $("#downloadTxt"), downloadPdf: $("#downloadPdf"),
  chatMessages: $("#chatMessages"), chatForm: $("#chatForm"), chatInput: $("#chatInput"), toast: $("#toast"),
  rejoinCard: $("#rejoinCard"), rejoinTitle: $("#rejoinTitle"), rejoinMeta: $("#rejoinMeta"), rejoinButton: $("#rejoinButton"),
  readerView: $("#readerView"), closeReader: $("#closeReader"), readerTxt: $("#readerTxt"), readerPdf: $("#readerPdf"),
  readerMeta: $("#readerMeta"), readerTitle: $("#readerTitle"), readerLines: $("#readerLines"),
};
const state = {
  session: null, user: null, profile: null, friends: [], room: null, player: null, players: [], lines: [],
  chatMessages: [], reactions: [], reviews: [], channel: null, lastTurnKey: "", readerStory: null,
};
const rejoinWindowMs = 30 * 60 * 1000;
const reactionChoices = ["오", "???????????", "예?", "좋은데?", "트롤하지마라", "님천재?"];
const clientId = localStorage.getItem("novelchain.clientId") || crypto.randomUUID();
localStorage.setItem("novelchain.clientId", clientId);

if (!supabase) els.configNotice.classList.remove("hidden");
els.authForm.addEventListener("submit", login);
els.signupButton.addEventListener("click", signup);
els.logoutButton.addEventListener("click", logout);
els.myButton.addEventListener("click", openMy);
els.closeMy.addEventListener("click", () => els.myDialog.close());
els.profileForm.addEventListener("submit", saveProfile);
els.friendForm.addEventListener("submit", addFriend);
els.createRoomForm.addEventListener("submit", createRoom);
els.joinRoomForm.addEventListener("submit", joinRoom);
els.createAnonymous.addEventListener("change", () => syncNameInput("create"));
els.joinAnonymous.addEventListener("change", () => syncNameInput("join"));
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
els.copyInviteButton.addEventListener("click", copyInvite);
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
function randomToken(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function defaultNickname() {
  const base = (state.user?.email || "writer").split("@")[0].replace(/[^a-zA-Z0-9가-힣_-]/g, "").slice(0, 12) || "writer";
  return `${base}-${randomToken(4)}`;
}

async function initAuth() {
  if (!supabase) return renderAuth();
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;
  if (state.user) await ensureProfile();
  renderAuth();
  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    state.profile = null;
    state.friends = [];
    if (state.user) await ensureProfile();
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
  els.accountEmail.textContent = state.profile?.nickname ? `${state.profile.nickname} · ${state.user?.email || ""}` : state.user?.email || "";
  if (signedIn) {
    const name = state.profile?.nickname || "";
    if (!els.createAnonymous.checked && !els.createName.value) els.createName.value = name;
    if (!els.joinAnonymous.checked && !els.joinName.value) els.joinName.value = name;
  }
  renderRejoin();
}
async function ensureProfile() {
  if (!needSupabase() || !state.user) return null;
  const existing = await supabase.from("profiles").select("*").eq("user_id", state.user.id).maybeSingle();
  if (existing.data) {
    state.profile = existing.data;
    await loadFriends();
    return state.profile;
  }
  for (let i = 0; i < 4; i += 1) {
    const { data, error } = await supabase
      .from("profiles")
      .insert({ user_id: state.user.id, nickname: defaultNickname(), anonymous_token_length: 6 })
      .select()
      .single();
    if (!error) {
      state.profile = data;
      await loadFriends();
      return data;
    }
    if (!error.message.toLowerCase().includes("duplicate")) {
      toast(error.message);
      return null;
    }
  }
  toast("프로필 닉네임 생성에 실패했습니다.");
  return null;
}
function openMy() {
  if (!needUser()) return;
  els.profileNickname.value = state.profile?.nickname || "";
  els.anonymousLength.value = state.profile?.anonymous_token_length || 6;
  renderFriends();
  if (!els.myDialog.open) els.myDialog.showModal();
}
async function saveProfile(event) {
  event.preventDefault();
  if (!needUser()) return;
  const nickname = els.profileNickname.value.trim();
  const anonymous_token_length = Number(els.anonymousLength.value);
  const { data, error } = await supabase
    .from("profiles")
    .update({ nickname, anonymous_token_length, updated_at: new Date().toISOString() })
    .eq("user_id", state.user.id)
    .select()
    .single();
  if (error) return toast(error.message);
  state.profile = data;
  syncNameInput("create");
  syncNameInput("join");
  renderAuth();
  toast("프로필 저장 완료.");
}
async function loadFriends() {
  if (!state.user) return;
  const { data, error } = await supabase
    .from("friendships")
    .select("*, requester:profiles!friendships_requester_id_fkey(user_id,nickname), addressee:profiles!friendships_addressee_id_fkey(user_id,nickname)")
    .or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`)
    .order("created_at", { ascending: false });
  state.friends = error ? [] : data || [];
}
async function addFriend(event) {
  event.preventDefault();
  const nickname = els.friendNickname.value.trim();
  if (!nickname) return;
  const found = await supabase.from("profiles").select("user_id,nickname").eq("nickname", nickname).maybeSingle();
  if (found.error || !found.data) return toast("친구 닉네임을 찾지 못했습니다.");
  if (found.data.user_id === state.user.id) return toast("자기 자신은 추가할 수 없습니다.");
  const reverse = state.friends.find((friend) => friend.requester_id === found.data.user_id && friend.addressee_id === state.user.id);
  if (reverse?.status === "pending") {
    const { error } = await supabase.from("friendships").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", reverse.id);
    if (error) return toast(error.message);
  } else {
    const { error } = await supabase.from("friendships").insert({ requester_id: state.user.id, addressee_id: found.data.user_id });
    if (error) return toast(error.message);
  }
  els.friendNickname.value = "";
  await loadFriends();
  renderFriends();
  renderRoomFriends();
  toast("친구 목록을 갱신했습니다.");
}
async function acceptFriend(friendId) {
  const { error } = await supabase.from("friendships").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", friendId);
  if (error) return toast(error.message);
  await loadFriends();
  renderFriends();
  renderRoomFriends();
}
function friendProfile(friend) {
  return friend.requester_id === state.user?.id ? friend.addressee : friend.requester;
}
function renderFriends() {
  if (!els.friendList) return;
  if (!state.friends.length) {
    els.friendList.textContent = "아직 친구가 없습니다.";
    return;
  }
  els.friendList.replaceChildren(...state.friends.map((friend) => {
    const item = document.createElement("div");
    const profile = friendProfile(friend);
    const incoming = friend.addressee_id === state.user?.id && friend.status === "pending";
    item.className = "friend-item";
    item.innerHTML = `<span>${escapeHtml(profile?.nickname || "알 수 없음")}</span><strong>${friend.status === "accepted" ? "친구" : "대기"}</strong>`;
    if (incoming) {
      const button = document.createElement("button");
      button.className = "secondary compact";
      button.type = "button";
      button.textContent = "수락";
      button.addEventListener("click", () => acceptFriend(friend.id));
      item.append(button);
    }
    return item;
  }));
}
function acceptedFriends() {
  return state.friends.filter((friend) => friend.status === "accepted").map(friendProfile).filter(Boolean);
}
function renderRoomFriends() {
  if (!els.roomFriendList) return;
  const friends = acceptedFriends();
  if (!friends.length) {
    els.roomFriendList.textContent = "My에서 친구를 추가하면 방 코드 초대가 쉬워집니다.";
    return;
  }
  els.roomFriendList.replaceChildren(...friends.map((friend) => {
    const item = document.createElement("button");
    item.className = "ghost compact friend-invite";
    item.type = "button";
    item.textContent = friend.nickname;
    item.addEventListener("click", () => copyInvite(friend.nickname));
    return item;
  }));
}
async function copyInvite(friendName = "") {
  if (!state.room) return;
  const target = friendName ? `${friendName}님, ` : "";
  const text = `${target}NovelChain 방 ${state.room.title}에 초대합니다. 방 코드: ${state.room.code}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("초대 문구를 복사했습니다.");
  } catch {
    toast(text);
  }
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
  const playerName = selectedPlayerName("create");
  const key = crypto.randomUUID();
  const room = {
    code: newCode(), title: els.roomTitle.value.trim(), owner_id: state.user.id, host_key: key,
    host_name: playerName, max_lines_per_player: Number(els.maxLines.value), allow_edits: els.allowEdits.checked,
  };
  const { data, error } = await supabase.from("rooms").insert(room).select().single();
  if (error) return toast(error.message);
  localStorage.setItem(`novelchain.host.${data.code}`, key);
  enterRoom(data, playerName);
}
async function joinRoom(event) {
  event.preventDefault();
  if (!needSupabase() || !needUser()) return;
  const { data, error } = await supabase.from("rooms").select("*").eq("code", codeValue(els.roomCode.value)).maybeSingle();
  if (error || !data) return toast("Room not found.");
  enterRoom(data, selectedPlayerName("join"));
}
function selectedPlayerName(type) {
  const anonymous = type === "create" ? els.createAnonymous.checked : els.joinAnonymous.checked;
  const input = type === "create" ? els.createName : els.joinName;
  if (anonymous) return `익명-${randomToken(Number(state.profile?.anonymous_token_length) || 6)}`;
  return input.value.trim() || state.profile?.nickname || "작가";
}
function syncNameInput(type) {
  const anonymous = type === "create" ? els.createAnonymous.checked : els.joinAnonymous.checked;
  const input = type === "create" ? els.createName : els.joinName;
  input.disabled = anonymous;
  input.required = !anonymous;
  input.value = anonymous ? `익명-${"X".repeat(Number(state.profile?.anonymous_token_length) || 6)}` : state.profile?.nickname || "";
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
  const [room, players, lines, chat, reactions, reviews] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", state.room.id).single(),
    supabase.from("players").select("*").eq("room_id", state.room.id).order("created_at"),
    supabase.from("lines").select("*").eq("room_id", state.room.id).order("position"),
    supabase.from("chat_messages").select("*").eq("room_id", state.room.id).order("created_at").limit(80),
    supabase.from("line_reactions").select("*").eq("room_id", state.room.id),
    supabase.from("line_reviews").select("*").eq("room_id", state.room.id),
  ]);
  if (!room.error) state.room = room.data;
  if (!players.error) state.players = players.data;
  if (!lines.error) state.lines = lines.data;
  if (!chat.error) state.chatMessages = chat.data;
  if (!reactions.error) state.reactions = reactions.data;
  if (!reviews.error) state.reviews = reviews.data;
}
function subscribeRoom() {
  if (state.channel) supabase.removeChannel(state.channel);
  const filter = `room_id=eq.${state.room.id}`;
  state.channel = supabase.channel(`room-${state.room.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${state.room.id}` }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "lines", filter }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "line_reactions", filter }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "line_reviews", filter }, reload)
    .subscribe();
}
async function reload() { await loadRoom(); render(); }

function currentStreak() {
  const last = state.lines.at(-1);
  if (!last) return 0;
  let count = 0;
  for (let i = state.lines.length - 1; i >= 0; i -= 1) {
    if (state.lines[i].player_id !== last.player_id) break;
    count += 1;
  }
  return count;
}
function currentTurn() {
  if (!state.room || state.room.status === "completed") return null;
  if (state.players.length < 2) return null;
  const last = state.lines.at(-1);
  if (!last) return state.players[0] || null;
  if (currentStreak() < state.room.max_lines_per_player) return state.players.find((player) => player.id === last.player_id) || null;
  const start = Math.max(0, state.players.findIndex((player) => player.id === last.player_id) + 1);
  for (let i = 0; i < state.players.length; i += 1) {
    const player = state.players[(start + i) % state.players.length];
    if (player.id !== last.player_id) return player;
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
  if (state.players.length < 2) return toast("2명 이상 들어와야 시작할 수 있습니다.");
  if (hasPendingRevision()) return toast("개연성 심사를 통과하지 못한 문장을 먼저 수정하세요.");
  const turn = currentTurn();
  if (state.room.status === "completed") return toast("This story is complete.");
  if (turn?.id === state.player.id && state.lines.at(-1)?.player_id === state.player.id && currentStreak() >= state.room.max_lines_per_player) return toast("이번 턴의 줄 수를 모두 썼습니다.");
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
  if (line.player_id !== state.player.id) return;
  if (!line.needs_revision && !state.room.allow_edits) return;
  if (!line.needs_revision && state.lines.some((item) => item.position > line.position)) return toast("이야기가 이어진 뒤에는 수정할 수 없습니다.");
  const { error } = await supabase.from("lines").update({ content, needs_revision: false, updated_at: new Date().toISOString() }).eq("id", line.id);
  if (error) return toast(error.message);
  await loadRoom();
  render();
}
function hasPendingRevision() {
  return state.lines.some((line) => line.user_id === state.user?.id && line.needs_revision);
}

function render() {
  const turn = currentTurn();
  const turnStreak = state.lines.at(-1)?.player_id === turn?.id ? currentStreak() : 0;
  const remaining = Math.max(state.room.max_lines_per_player - turnStreak, 0);
  const pendingRevision = hasPendingRevision();
  const canWrite = remaining > 0 && turn?.id === state.player?.id && state.room.status !== "completed" && !pendingRevision;
  els.activeRoomCode.textContent = state.room.code;
  els.activeRoomTitle.textContent = state.room.title;
  els.storyHeading.textContent = state.room.status === "completed" ? "완성된 소설" : "함께 쓰는 중";
  els.ruleText.textContent = `턴당 최대 ${state.room.max_lines_per_player}줄 · 전체 길이 무제한 · 수정 ${state.room.allow_edits ? "가능" : "불가"}`;
  els.lineHint.textContent = state.room.status === "completed"
    ? "완성된 소설입니다."
    : pendingRevision
      ? "개연성 심사를 통과하지 못한 문장을 먼저 수정해야 합니다."
    : state.players.length < 2
      ? "2명 이상 들어오면 첫 문장을 쓸 수 있습니다."
      : canWrite
        ? `당신의 차례 · 이번 턴 남은 줄 ${remaining}`
        : turn
          ? `${turn.name}님의 차례 · 이번 턴 남은 줄 ${remaining}`
          : "다음 턴을 기다리는 중입니다.";
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
  renderRoomFriends();
}
function renderPlayers(turn) {
  els.playerList.replaceChildren(...state.players.map((player) => {
    const li = document.createElement("li");
    const count = state.lines.filter((line) => line.player_id === player.id).length;
    li.classList.toggle("current-turn", turn?.id === player.id);
    li.innerHTML = `<span>${escapeHtml(player.name)}</span><strong>${count}줄</strong>`;
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
    li.classList.toggle("needs-revision", Boolean(line.needs_revision));
    li.innerHTML = `<div class="line-meta"><span>${escapeHtml(line.player_name)}${line.needs_revision ? '<strong class="revision-badge">수정 필요</strong>' : ""}</span><time>${formatTime(line.created_at)}</time></div><p>${escapeHtml(line.content)}</p>`;
    const storyContinued = state.lines.some((item) => item.position > line.position);
    if (((state.room.allow_edits && !storyContinued) || line.needs_revision) && line.player_id === state.player?.id && state.room.status !== "completed") {
      const button = document.createElement("button");
      button.className = "ghost compact";
      button.type = "button";
      button.textContent = line.needs_revision ? "개연성 수정" : "수정";
      button.addEventListener("click", () => {
        const next = prompt("문장을 수정하세요.", line.content);
        if (next?.trim()) updateLine(line, next.trim());
      });
      li.append(button);
    }
    li.append(renderReactionBar(line));
    li.append(renderReviewBar(line));
    return li;
  }));
}
function renderReactionBar(line) {
  const wrap = document.createElement("div");
  wrap.className = "reaction-bar";
  const totals = state.reactions
    .filter((reaction) => reaction.line_id === line.id)
    .reduce((acc, reaction) => {
      acc[reaction.reaction] = (acc[reaction.reaction] || 0) + reaction.count;
      return acc;
    }, {});
  reactionChoices.forEach((reaction) => {
    const button = document.createElement("button");
    button.className = "reaction-button";
    button.type = "button";
    button.textContent = totals[reaction] ? `${reaction} ${totals[reaction]}` : reaction;
    button.disabled = state.room.status === "completed";
    button.addEventListener("click", () => addReaction(line, reaction));
    wrap.append(button);
  });
  return wrap;
}
function renderReviewBar(line) {
  const wrap = document.createElement("div");
  wrap.className = "review-bar";
  const agrees = state.reviews.filter((review) => review.line_id === line.id && review.agrees).length;
  const needed = Math.floor(state.players.length / 2) + 1;
  const alreadyVoted = state.reviews.some((review) => review.line_id === line.id && review.voter_id === state.user?.id);
  const meta = document.createElement("span");
  meta.textContent = state.players.length >= 3 ? `개연성 심사 ${agrees}/${needed}` : "개연성 심사는 3명부터";
  wrap.append(meta);
  if (state.players.length >= 3 && line.user_id !== state.user?.id && state.room.status !== "completed") {
    const button = document.createElement("button");
    button.className = "ghost compact";
    button.type = "button";
    button.textContent = alreadyVoted ? "심사 변경" : "개연성 문제";
    button.addEventListener("click", () => voteRevision(line));
    wrap.append(button);
  }
  return wrap;
}
async function addReaction(line, reaction) {
  const mine = state.reactions.filter((item) => item.line_id === line.id && item.user_id === state.user?.id);
  const total = mine.reduce((sum, item) => sum + item.count, 0);
  if (total >= 50) return toast("한 문장에 반응은 최대 50개까지 보낼 수 있습니다.");
  const existing = mine.find((item) => item.reaction === reaction);
  const payload = { updated_at: new Date().toISOString() };
  const result = existing
    ? await supabase.from("line_reactions").update({ ...payload, count: existing.count + 1 }).eq("id", existing.id).select().single()
    : await supabase.from("line_reactions").insert({ room_id: state.room.id, line_id: line.id, user_id: state.user.id, reaction, count: 1 }).select().single();
  if (result.error) return toast(result.error.message);
  await loadRoom();
  render();
}
async function voteRevision(line) {
  const { data, error } = await supabase.rpc("vote_line_revision", { target_line_id: line.id, agrees_vote: true });
  if (error) return toast(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  toast(result?.needs_revision ? "과반수 동의로 수정이 필요합니다." : "개연성 심사를 보냈습니다.");
  await loadRoom();
  render();
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
