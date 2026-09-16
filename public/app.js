let me=null,sort="new";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function toast(x){$("#toast").textContent=x;$("#toast").style.display="block";setTimeout(()=>$("#toast").style.display="none",1800)}
function avatar(a){return a&&a!=="default"?a:"https://api.dicebear.com/9.x/initials/svg?seed=85";}
function time(x){return new Date(x).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
async function api(u,o){let r=await fetch(u,o);let d=await r.json();if(!r.ok)throw Error(d.error||"请求失败");return d}
async function init(){me=(await api("/api/me")).user;load();loadNotice()}
async function load(){let q=encodeURIComponent($("#search").value.trim());let d=await api("/api/posts?q="+q+"&sort="+(sort==="hot"?"hot":"new"));$("#posts").innerHTML=d.posts.map(p=>card(p)).join("")||'<div class="card">还没有帖子，来发第一条吧。</div>'}
function card(p){return `<article class="card"><div class="user"><img class="avatar" src="${esc(avatar(p.avatar))}"><div><div class="name">${esc(p.display_name)} ${p.pinned?"📌":""}</div><div class="time">${time(p.created_at)}${p.edited?" · 已编辑":""}</div></div></div><div class="content">${esc(p.content)}</div>${p.image_data?`<img class="postimg" src="${p.image_data}">`:""}<div class="actions"><button class="${p.liked?"liked":""}" onclick="like(${p.id})">♥ ${p.likes}</button><button onclick="comments(${p.id})">💬 ${p.comments}</button>${p.user_id===me.id?`<button onclick="editPost(${p.id},${JSON.stringify(p.content)})">编辑</button><button onclick="delPost(${p.id})">删除</button>`:""}<button onclick="report('post',${p.id})">举报</button></div></article>`}
async function postIt(){let c=$("#content").value.trim(),f=$("#image").files[0];if(!c&&!f)return toast("内容不能为空");let fd=new FormData();fd.append("content",c);if(f)fd.append("image",f);await api("/api/posts",{method:"POST",body:fd});$("#content").value="";$("#image").value="";toast("发布成功");load()}
async function like(id){await api("/api/posts/"+id+"/like",{method:"POST"});load()}
async function delPost(id){if(confirm("删除这条帖子？")){await api("/api/posts/"+id,{method:"DELETE"});load()}}
async function editPost(id,old){let c=prompt("修改帖子",old);if(c!==null){await api("/api/posts/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:c})});load()}}
async function comments(id){let d=await api("/api/posts/"+id+"/comments");show(`<h2>回复</h2><div id="comments">${d.comments.map(c=>`<div class="comment"><b>${esc(c.display_name)}</b><div>${esc(c.content)}</div><small>${time(c.created_at)} ${c.user_id===me.id?`<button onclick="delComment(${c.id},${id})">删除</button>`:""} <button onclick="report('comment',${c.id})">举报</button></small></div>`).join("")||"还没有回复"}</div><textarea id="reply" placeholder="写下回复…"></textarea><button class="primary" onclick="reply(${id})">回复</button>`)}
async function reply(id){let c=$("#reply").value.trim();if(!c)return;await api("/api/posts/"+id+"/comments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:c})});comments(id)}
async function delComment(id,pid){await api("/api/comments/"+id,{method:"DELETE"});comments(pid)}
async function report(type,id){let reason=prompt("举报原因");if(reason)await api("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target_type:type,target_id:id,reason})});toast("已提交举报")}
function show(x){$("#modal").innerHTML=`<div>${x}<button onclick="closeModal()" style="float:right">关闭</button></div>`;$("#modal").classList.add("show")}
function closeModal(){$("#modal").classList.remove("show")}
async function openProfile(){show(`<h2>我的资料</h2><img class="avatar" src="${esc(avatar(me.avatar))}"><input id="pname" value="${esc(me.display_name)}" placeholder="匿名昵称"><input id="pavatar" value="${me.avatar==="default"?"":esc(me.avatar)}" placeholder="头像图片URL（可选）"><button class="primary" onclick="saveProfile()">保存</button>`)}
async function saveProfile(){await api("/api/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({display_name:$("#pname").value,avatar:$("#pavatar").value})});me=(await api("/api/me")).user;closeModal();load();toast("已保存")}
async function openMessages(){let d=await api("/api/users");show(`<h2>私信</h2><input id="userq" placeholder="搜索匿名昵称" oninput="searchUsers()"><div id="users">${d.users.map(u=>`<div class="adminItem"><img class="avatar" src="${avatar(u.avatar)}"> ${esc(u.display_name)} <button onclick="chat(${u.id},${JSON.stringify(u.display_name)})">聊天</button></div>`).join("")}</div>`)}
async function searchUsers(){let d=await api("/api/users?q="+encodeURIComponent($("#userq").value));$("#users").innerHTML=d.users.map(u=>`<div class="adminItem"><img class="avatar" src="${avatar(u.avatar)}"> ${esc(u.display_name)} <button onclick="chat(${u.id},${JSON.stringify(u.display_name)})">聊天</button></div>`).join("")}
async function chat(id,name){let d=await api("/api/messages/"+id);show(`<h2>${esc(name)}</h2><div style="max-height:50vh;overflow:auto">${d.messages.map(m=>`<div class="comment"><b>${esc(m.sender_name)}</b>：${esc(m.content)}</div>`).join("")||"暂无消息"}</div><input id="msg" placeholder="输入消息"><button class="primary" onclick="sendMsg(${id})">发送</button>`)}
async function sendMsg(id){let c=$("#msg").value.trim();if(!c)return;await api("/api/messages/"+id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:c})});chat(id,"私信")}
async function loadNotice(){let d=await api("/api/notices");$("#notice").innerHTML=d.notices.map(n=>`<div class="notice">📢 ${esc(n.content)}</div>`).join("")}
function toggleDark(){document.body.classList.toggle("dark");localStorage.dark=document.body.classList.contains("dark")?"1":"0"}
if(localStorage.dark==="1")document.body.classList.add("dark");
$("#search").addEventListener("input",()=>{clearTimeout(window.st);window.st=setTimeout(load,300)});
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");sort=b.dataset.sort;load()});
init();
