(() => {
const $ = id => document.getElementById(id);
async function request(path, options = {}) {
 const response = await fetch(path, { credentials:"same-origin", headers:{"Content-Type":"application/json",...(options.headers||{})}, ...options });
 const data = await response.json().catch(()=>({}));
 if (!response.ok) throw new Error(data.error || `Request gagal (${response.status})`);
 return data;
}
function msg(id,text,bad=false){const el=$(id);el.textContent=text;el.classList.toggle("bad",bad);}
function showDashboard(){$("login-view").classList.add("hidden");$("dashboard-view").classList.remove("hidden");$("logout-btn").classList.remove("hidden");}
function showLogin(){$("login-view").classList.remove("hidden");$("dashboard-view").classList.add("hidden");$("logout-btn").classList.add("hidden");}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function loadBots(){
 const data=await request("/api/bots"), bots=data.bots||[], valid=bots.filter(b=>b.valid);
 $("total-bots").textContent=bots.length;$("active-bots").textContent=valid.length;
 $("bot-list").innerHTML=bots.length?bots.map(b=>`<div class="bot-item"><div><div class="bot-name">${esc(b.owner)}</div><div class="bot-user">${b.username?"@"+esc(b.username):"Username tidak tersedia"}</div><div class="bot-id">${b.telegramId?"Telegram ID "+esc(b.telegramId):"Token tidak valid / Telegram tidak dapat dijangkau"}</div></div><div class="bot-actions"><span class="pill ${b.valid?"":"pill-bad"}">${b.valid?"VALID":"ERROR"}</span><button class="btn btn-delete" data-delete="${esc(b.id)}">Hapus</button></div></div>`).join(""):'<div class="empty">Belum ada bot. Tekan Tambah Token untuk memulai.</div>';
 $("send-bot").innerHTML='<option value="">Pilih bot...</option>'+valid.map(b=>`<option value="${esc(b.id)}">${esc(b.owner)} (@${esc(b.username)})</option>`).join("");
}
$("login-form").addEventListener("submit",async e=>{e.preventDefault();msg("login-error","");try{await request("/api/auth/login",{method:"POST",body:JSON.stringify({password:$("password").value})});$("password").value="";showDashboard();await loadBots();}catch(err){msg("login-error",err.message,true);}});
$("logout-btn").addEventListener("click",async()=>{try{await request("/api/auth/logout",{method:"POST",body:"{}"});}finally{showLogin();}});
$("open-add").addEventListener("click",()=>{$("add-panel").classList.remove("hidden");$("owner").focus();});
$("close-add").addEventListener("click",()=>{$("add-panel").classList.add("hidden");});
$("refresh-btn").addEventListener("click",()=>loadBots().catch(e=>alert(e.message)));
$("bot-list").addEventListener("click",async e=>{const button=e.target.closest("[data-delete]");if(!button)return;if(!confirm("Hapus bot ini dari daftar?"))return;button.disabled=true;try{await request("/api/bots/"+encodeURIComponent(button.dataset.delete),{method:"DELETE"});await loadBots();}catch(err){alert(err.message);button.disabled=false;}});
$("add-form").addEventListener("submit",async e=>{e.preventDefault();msg("add-message","Memvalidasi token dan menyimpan...");const submit=e.submitter;submit.disabled=true;try{await request("/api/bots",{method:"POST",body:JSON.stringify({owner:$("owner").value.trim(),token:$("token").value.trim()})});$("token").value="";$("owner").value="";msg("add-message","Bot berhasil divalidasi dan disimpan.");await loadBots();}catch(err){msg("add-message",err.message,true);}finally{submit.disabled=false;}});
$("send-form").addEventListener("submit",async e=>{e.preventDefault();msg("send-message","Mengirim pesan...");try{const data=await request("/api/send",{method:"POST",body:JSON.stringify({botId:$("send-bot").value,chatId:$("chat-id").value.trim(),text:$("message-text").value})});msg("send-message",`Pesan terkirim. Message ID: ${data.messageId}`);}catch(err){msg("send-message",err.message,true);}});
fetch("/api/health").then(r=>{if(!r.ok)throw Error();$("api-state").textContent="API ONLINE";}).catch(()=>$("api-state").textContent="API CONFIG ERROR");
request("/api/auth/me").then(async()=>{showDashboard();await loadBots();}).catch(showLogin);
})();