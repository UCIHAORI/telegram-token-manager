(() => {
const $ = id => document.getElementById(id);
let currentUser = null;
let loginMode = "admin";
function setLoginMode(mode){
 loginMode=mode;
 const admin=mode==="admin";
 $("admin-login-tab").classList.toggle("active",admin);
 $("member-login-tab").classList.toggle("active",!admin);
 $("username-wrap").classList.toggle("hidden",admin);
 $("username").required=!admin;
 $("username").disabled=admin;
 $("login-mode-label").textContent=admin?"ADMIN PORTAL":"MEMBER PORTAL";
 $("password").placeholder=admin?"Password admin":"Password member";
 $("login-submit").innerHTML=admin?'Login sebagai Admin <span>→</span>':'Login sebagai Member <span>→</span>';
 msg("login-error","");
}
async function request(path, options = {}) {
 const response = await fetch(path, { credentials:"same-origin", headers:{"Content-Type":"application/json",...(options.headers||{})}, ...options });
 const data = await response.json().catch(()=>({}));
 if (!response.ok) throw new Error(data.error || `Request gagal (${response.status})`);
 return data;
}
function msg(id,text,bad=false){const el=$(id);el.textContent=text;el.classList.toggle("bad",bad);}
function showDashboard(user){
 currentUser=user;$("login-view").classList.add("hidden");$("dashboard-view").classList.remove("hidden");$("logout-btn").classList.remove("hidden");
 $("role-label").textContent=(user.role==="owner"?"OWNER":"MEMBER")+" · "+user.username;$("role-label").classList.remove("hidden");
 const owner=user.role==="owner";$("owner-area").classList.toggle("hidden",!owner);
 $("role-eyebrow").textContent=owner?"OWNER CONTROL CENTER":"MEMBER ACCESS";
 $("page-title").innerHTML=owner?'Daftar bot<span class="accent">.</span>':'Tambah token<span class="accent">.</span>';
 $("page-description").textContent=owner?"Kelola bot, akun member, dan pengiriman pesan.":"Akses member hanya untuk menambahkan token bot.";
 $("open-add").classList.remove("hidden");
 if(owner){loadBots().catch(e=>alert(e.message));loadUsers().catch(e=>alert(e.message));}
}
function showLogin(){$("login-view").classList.remove("hidden");$("dashboard-view").classList.add("hidden");$("logout-btn").classList.add("hidden");$("role-label").classList.add("hidden");$("add-panel").classList.add("hidden");currentUser=null;}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function loadBots(){
 const data=await request("/api/bots"), bots=data.bots||[], valid=bots.filter(b=>b.valid);
 $("total-bots").textContent=bots.length;$("active-bots").textContent=valid.length;
 $("bot-list").innerHTML=bots.length?bots.map(b=>`<div class="bot-item"><div><div class="bot-name">${esc(b.owner)}</div><div class="bot-user">${b.username?"@"+esc(b.username):"Username tidak tersedia"}</div><div class="bot-id">${b.telegramId?"Telegram ID "+esc(b.telegramId):"Token tidak valid / Telegram tidak dapat dijangkau"}</div></div><div class="bot-actions"><span class="pill ${b.valid?"":"pill-bad"}">${b.valid?"VALID":"ERROR"}</span><button class="btn btn-delete" data-delete="${esc(b.id)}">Hapus</button></div></div>`).join(""):'<div class="empty">Belum ada bot.</div>';
 $("send-bot").innerHTML='<option value="">Pilih bot...</option>'+valid.map(b=>`<option value="${esc(b.id)}">${esc(b.owner)} (@${esc(b.username)})</option>`).join("");
}
async function loadUsers(){
 const data=await request("/api/users"), users=data.users||[];
 $("user-list").innerHTML=users.length?users.map(u=>`<div class="user-item"><div><strong>${esc(u.username)}</strong><small>MEMBER</small></div><button class="btn btn-delete" data-user-delete="${esc(u.username)}">Hapus akun</button></div>`).join(""):'<div class="empty">Belum ada akun member.</div>';
}
$("admin-login-tab").addEventListener("click",()=>setLoginMode("admin"));
$("member-login-tab").addEventListener("click",()=>setLoginMode("member"));
$("login-form").addEventListener("submit",async e=>{e.preventDefault();msg("login-error","");const username=loginMode==="admin"?"owner":$("username").value.trim();try{const data=await request("/api/auth/login",{method:"POST",body:JSON.stringify({username,password:$("password").value})});if((loginMode==="admin"&&data.user.role!=="owner")||(loginMode==="member"&&data.user.role!=="member"))throw new Error("Jenis akun tidak sesuai dengan menu login.");$("password").value="";showDashboard(data.user);}catch(err){msg("login-error",err.message,true);}});
$("logout-btn").addEventListener("click",async()=>{try{await request("/api/auth/logout",{method:"POST",body:"{}"});}finally{showLogin();}});
$("open-add").addEventListener("click",()=>{$("add-panel").classList.remove("hidden");$("owner").focus();});
$("close-add").addEventListener("click",()=>{$("add-panel").classList.add("hidden");});
$("refresh-btn").addEventListener("click",()=>loadBots().catch(e=>alert(e.message)));
$("bot-list").addEventListener("click",async e=>{const button=e.target.closest("[data-delete]");if(!button)return;if(!confirm("Hapus bot ini dari daftar?"))return;button.disabled=true;try{await request("/api/bots/"+encodeURIComponent(button.dataset.delete),{method:"DELETE"});await loadBots();}catch(err){alert(err.message);button.disabled=false;}});
$("user-list").addEventListener("click",async e=>{const button=e.target.closest("[data-user-delete]");if(!button)return;if(!confirm("Hapus akun member ini?"))return;button.disabled=true;try{await request("/api/users/"+encodeURIComponent(button.dataset.userDelete),{method:"DELETE"});await loadUsers();}catch(err){alert(err.message);button.disabled=false;}});
$("add-form").addEventListener("submit",async e=>{e.preventDefault();msg("add-message","Memvalidasi token dan menyimpan...");const submit=e.submitter;submit.disabled=true;try{await request("/api/bots",{method:"POST",body:JSON.stringify({owner:$("owner").value.trim(),token:$("token").value.trim()})});$("token").value="";$("owner").value="";msg("add-message","Bot berhasil divalidasi dan disimpan.");if(currentUser?.role==="owner")await loadBots();}catch(err){msg("add-message",err.message,true);}finally{submit.disabled=false;}});
$("user-form").addEventListener("submit",async e=>{e.preventDefault();msg("user-message","Membuat akun...");const submit=e.submitter;submit.disabled=true;try{await request("/api/users",{method:"POST",body:JSON.stringify({username:$("new-username").value.trim(),password:$("new-password").value})});$("new-username").value="";$("new-password").value="";msg("user-message","Akun member berhasil dibuat.");await loadUsers();}catch(err){msg("user-message",err.message,true);}finally{submit.disabled=false;}});
$("send-form").addEventListener("submit",async e=>{e.preventDefault();msg("send-message","Mengirim pesan...");try{const data=await request("/api/send",{method:"POST",body:JSON.stringify({botId:$("send-bot").value,chatId:$("chat-id").value.trim(),text:$("message-text").value})});msg("send-message",`Pesan terkirim. Message ID: ${data.messageId}`);}catch(err){msg("send-message",err.message,true);}});
fetch("/api/health").then(r=>{if(!r.ok)throw Error();$("api-state").textContent="API ONLINE";}).catch(()=>$("api-state").textContent="API CONFIG ERROR");
setLoginMode("admin");request("/api/auth/me").then(data=>showDashboard(data.user)).catch(showLogin);
})();