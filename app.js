(() => {
  const $ = id => document.getElementById(id);
  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request gagal (${response.status})`);
    return data;
  }
  function message(id, text, bad = false) {
    const el = $(id); el.textContent = text; el.classList.toggle("bad", bad);
  }
  function showDashboard() {
    $("login-view").classList.add("hidden"); $("dashboard-view").classList.remove("hidden"); $("logout-btn").classList.remove("hidden");
  }
  function showLogin() {
    $("login-view").classList.remove("hidden"); $("dashboard-view").classList.add("hidden"); $("logout-btn").classList.add("hidden");
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }
  async function loadBots() {
    const data = await request("/api/bots"), bots = data.bots;
    $("total-bots").textContent = bots.length; $("active-bots").textContent = bots.length;
    $("bot-list").innerHTML = bots.length ? bots.map(bot => `
      <div class="bot-item"><div><div class="bot-name">${escapeHtml(bot.label)}</div><div class="bot-user">@${escapeHtml(bot.username || "unknown")}</div><div class="bot-id">ID ${escapeHtml(bot.telegram_id)}</div></div>
      <div class="bot-actions"><span class="pill">VALID</span><button class="delete-btn" data-delete="${escapeHtml(bot.id)}" title="Hapus bot">×</button></div></div>`).join("") : '<div class="empty">Belum ada bot. Tambahkan token pertama kamu.</div>';
    $("send-bot").innerHTML = '<option value="">Pilih bot...</option>' + bots.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.label)} (@${escapeHtml(b.username)})</option>`).join("");
  }
  async function checkSession() {
    try { await request("/api/auth/me"); showDashboard(); await loadBots(); } catch { showLogin(); }
  }
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault(); message("login-error", "");
    try {
      await request("/api/auth/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
      $("password").value = ""; showDashboard(); await loadBots();
    } catch (err) { message("login-error", err.message, true); }
  });
  $("logout-btn").addEventListener("click", async () => {
    try { await request("/api/auth/logout", { method: "POST", body: "{}" }); } finally { showLogin(); }
  });
  $("add-form").addEventListener("submit", async e => {
    e.preventDefault(); message("add-message", "Memvalidasi token ke Telegram...");
    try {
      const data = await request("/api/bots", { method: "POST", body: JSON.stringify({ label: $("bot-label").value, token: $("bot-token").value }) });
      $("bot-label").value = ""; $("bot-token").value = "";
      message("add-message", `Berhasil: @${data.bot.username} tersimpan terenkripsi.`); await loadBots();
    } catch (err) { message("add-message", err.message, true); }
  });
  $("bot-list").addEventListener("click", async e => {
    const button = e.target.closest("[data-delete]"); if (!button) return;
    if (!confirm("Hapus bot ini dari dashboard?")) return;
    try { await request(`/api/bots/${encodeURIComponent(button.dataset.delete)}`, { method: "DELETE" }); await loadBots(); }
    catch (err) { alert(err.message); }
  });
  $("refresh-btn").addEventListener("click", () => loadBots().catch(err => alert(err.message)));
  $("send-form").addEventListener("submit", async e => {
    e.preventDefault(); message("send-message", "Mengirim pesan...");
    try {
      const data = await request("/api/send", { method: "POST", body: JSON.stringify({ botId: $("send-bot").value, chatId: $("chat-id").value.trim(), text: $("message-text").value }) });
      message("send-message", `Pesan terkirim. Message ID: ${data.messageId}`);
    } catch (err) { message("send-message", err.message, true); }
  });
  fetch("/api/health").then(r => { if (!r.ok) throw new Error(); $("api-state").textContent = "API ONLINE"; })
    .catch(() => { $("api-state").textContent = "API OFFLINE"; $("api-state").style.color = "#ff6f83"; });
  checkSession();
})();
