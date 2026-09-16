const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "85mmtzowner";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname,"public")));

async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      anon_id TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL DEFAULT '匿名用户',
      avatar TEXT NOT NULL DEFAULT 'default',
      banned_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS posts(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      image_data TEXT,
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      edited BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS comments(
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      edited BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS likes(
      post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(post_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS messages(
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      receiver_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reports(
      id BIGSERIAL PRIMARY KEY,
      reporter_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      target_type TEXT NOT NULL,
      target_id BIGINT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notices(
      id BIGSERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id);
    CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages(sender_id,receiver_id,created_at);
  `);
}

function newAnon(){
  return crypto.randomBytes(10).toString("hex");
}
async function getUser(req,res){
  let anon = req.signedCookies.anon_id;
  if(!anon){
    anon = newAnon();
    res.cookie("anon_id",anon,{signed:true,httpOnly:true,sameSite:"lax",maxAge:1000*60*60*24*365*5});
  }
  let r = await pool.query("SELECT * FROM users WHERE anon_id=$1",[anon]);
  if(!r.rows[0]){
    r = await pool.query("INSERT INTO users(anon_id) VALUES($1) RETURNING *",[anon]);
  }
  return r.rows[0];
}
function clean(s,max=5000){ return String(s||"").trim().slice(0,max); }
function admin(req){ return req.signedCookies.admin === "1"; }

app.get("/api/me", async (req,res)=>{
  try{ const u=await getUser(req,res); res.json({user:u}); }catch(e){res.status(500).json({error:"服务器错误"});}
});

app.post("/api/profile", async (req,res)=>{
  try{
    const u=await getUser(req,res);
    const name=clean(req.body.display_name,30)||"匿名用户";
    const avatar=clean(req.body.avatar,500)||"default";
    await pool.query("UPDATE users SET display_name=$1,avatar=$2 WHERE id=$3",[name,avatar,u.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"保存失败"});}
});

app.get("/api/posts", async(req,res)=>{
  try{
    const u=await getUser(req,res);
    const q=clean(req.query.q,100);
    const sort=req.query.sort==="hot" ? "likes DESC, p.created_at DESC" : "p.pinned DESC, p.created_at DESC";
    const sql=`
      SELECT p.*, u.display_name,u.avatar,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id)::int AS likes,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id)::int AS comments,
      EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id=p.id AND l2.user_id=$1) AS liked
      FROM posts p JOIN users u ON u.id=p.user_id
      WHERE ($2='' OR p.content ILIKE '%'||$2||'%')
      ORDER BY ${sort} LIMIT 100`;
    const r=await pool.query(sql,[u.id,q]);
    res.json({posts:r.rows});
  }catch(e){res.status(500).json({error:"加载失败"});}
});

app.post("/api/posts", upload.single("image"), async(req,res)=>{
  try{
    const u=await getUser(req,res);
    if(u.banned_until && new Date(u.banned_until)>new Date()) return res.status(403).json({error:"你暂时不能发帖"});
    const content=clean(req.body.content,5000);
    if(!content && !req.file) return res.status(400).json({error:"内容不能为空"});
    const img=req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}` : null;
    await pool.query("INSERT INTO posts(user_id,content,image_data) VALUES($1,$2,$3)",[u.id,content||"",img]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"发布失败"});}
});

app.delete("/api/posts/:id", async(req,res)=>{
  try{
    const u=await getUser(req,res);
    const r=await pool.query("DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,u.id]);
    if(!r.rows[0]) return res.status(403).json({error:"只能删除自己的帖子"});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"删除失败"});}
});

app.put("/api/posts/:id", async(req,res)=>{
  try{
    const u=await getUser(req,res);
    const content=clean(req.body.content,5000);
    if(!content)return res.status(400).json({error:"内容不能为空"});
    const r=await pool.query("UPDATE posts SET content=$1,edited=true,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING id",[content,req.params.id,u.id]);
    if(!r.rows[0])return res.status(403).json({error:"只能编辑自己的帖子"});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"编辑失败"});}
});

app.post("/api/posts/:id/like", async(req,res)=>{
  try{
    const u=await getUser(req,res);
    const old=await pool.query("SELECT 1 FROM likes WHERE post_id=$1 AND user_id=$2",[req.params.id,u.id]);
    if(old.rows[0]) await pool.query("DELETE FROM likes WHERE post_id=$1 AND user_id=$2",[req.params.id,u.id]);
    else await pool.query("INSERT INTO likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.params.id,u.id]);
    const n=await pool.query("SELECT COUNT(*)::int AS n FROM likes WHERE post_id=$1",[req.params.id]);
    res.json({liked:!old.rows[0],likes:n.rows[0].n});
  }catch(e){res.status(500).json({error:"操作失败"});}
});

app.get("/api/posts/:id/comments", async(req,res)=>{
  try{
    const r=await pool.query(`SELECT c.*,u.display_name,u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC`,[req.params.id]);
    res.json({comments:r.rows});
  }catch(e){res.status(500).json({error:"加载失败"});}
});
app.post("/api/posts/:id/comments", async(req,res)=>{
  try{
    const u=await getUser(req,res), content=clean(req.body.content,2000);
    if(!content)return res.status(400).json({error:"回复不能为空"});
    await pool.query("INSERT INTO comments(post_id,user_id,content) VALUES($1,$2,$3)",[req.params.id,u.id,content]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"回复失败"});}
});
app.delete("/api/comments/:id",async(req,res)=>{
  try{
    const u=await getUser(req,res);
    const r=await pool.query("DELETE FROM comments WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,u.id]);
    if(!r.rows[0])return res.status(403).json({error:"只能删除自己的回复"});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"删除失败"});}
});

app.post("/api/report",async(req,res)=>{
  try{
    const u=await getUser(req,res);
    const type=["post","comment","message"].includes(req.body.target_type)?req.body.target_type:"post";
    const reason=clean(req.body.reason,300);
    await pool.query("INSERT INTO reports(reporter_id,target_type,target_id,reason) VALUES($1,$2,$3,$4)",[u.id,type,Number(req.body.target_id),reason||"未说明"]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"举报失败"});}
});

app.get("/api/users",async(req,res)=>{
  try{
    const u=await getUser(req,res);
    const q=clean(req.query.q,50);
    const r=await pool.query("SELECT id,display_name,avatar FROM users WHERE id<>$1 AND display_name ILIKE '%'||$2||'%' ORDER BY id DESC LIMIT 50",[u.id,q]);
    res.json({users:r.rows});
  }catch(e){res.status(500).json({error:"加载失败"});}
});
app.get("/api/messages/:id",async(req,res)=>{
  try{
    const u=await getUser(req,res), other=Number(req.params.id);
    await pool.query("UPDATE messages SET read_at=NOW() WHERE receiver_id=$1 AND sender_id=$2 AND read_at IS NULL",[u.id,other]);
    const r=await pool.query(`SELECT m.*,su.display_name AS sender_name,su.avatar AS sender_avatar
      FROM messages m JOIN users su ON su.id=m.sender_id
      WHERE (m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1)
      ORDER BY m.created_at ASC LIMIT 300`,[u.id,other]);
    res.json({messages:r.rows});
  }catch(e){res.status(500).json({error:"加载失败"});}
});
app.post("/api/messages/:id",async(req,res)=>{
  try{
    const u=await getUser(req,res), other=Number(req.params.id), content=clean(req.body.content,2000);
    if(!content)return res.status(400).json({error:"消息不能为空"});
    await pool.query("INSERT INTO messages(sender_id,receiver_id,content) VALUES($1,$2,$3)",[u.id,other,content]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"发送失败"});}
});

app.post("/api/admin/login",(req,res)=>{
  if(req.body.password===ADMIN_PASSWORD){
    res.cookie("admin","1",{signed:true,httpOnly:true,sameSite:"lax",maxAge:1000*60*60*8});
    return res.json({ok:true});
  }
  res.status(401).json({error:"密码错误"});
});
app.post("/api/admin/logout",(req,res)=>{res.clearCookie("admin");res.json({ok:true});});
function needAdmin(req,res,next){if(!admin(req))return res.status(401).json({error:"需要管理员权限"});next();}
app.get("/api/admin/data",needAdmin,async(req,res)=>{
  const [posts,reports,users,notices]=await Promise.all([
    pool.query(`SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 300`),
    pool.query(`SELECT r.*,u.display_name FROM reports r LEFT JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 300`),
    pool.query(`SELECT id,display_name,avatar,banned_until,created_at FROM users ORDER BY id DESC LIMIT 300`),
    pool.query(`SELECT * FROM notices ORDER BY created_at DESC LIMIT 20`)
  ]);
  res.json({posts:posts.rows,reports:reports.rows,users:users.rows,notices:notices.rows});
});
app.delete("/api/admin/posts/:id",needAdmin,async(req,res)=>{await pool.query("DELETE FROM posts WHERE id=$1",[req.params.id]);res.json({ok:true});});
app.delete("/api/admin/comments/:id",needAdmin,async(req,res)=>{await pool.query("DELETE FROM comments WHERE id=$1",[req.params.id]);res.json({ok:true});});
app.post("/api/admin/posts/:id/pin",needAdmin,async(req,res)=>{await pool.query("UPDATE posts SET pinned=NOT pinned WHERE id=$1",[req.params.id]);res.json({ok:true});});
app.post("/api/admin/ban/:id",needAdmin,async(req,res)=>{
  const days=Math.max(1,Math.min(365,Number(req.body.days)||1));
  await pool.query("UPDATE users SET banned_until=NOW()+($1||' days')::interval WHERE id=$2",[days,req.params.id]);
  res.json({ok:true});
});
app.post("/api/admin/unban/:id",needAdmin,async(req,res)=>{await pool.query("UPDATE users SET banned_until=NULL WHERE id=$1",[req.params.id]);res.json({ok:true});});
app.post("/api/admin/notice",needAdmin,async(req,res)=>{const c=clean(req.body.content,1000);if(c)await pool.query("INSERT INTO notices(content) VALUES($1)",[c]);res.json({ok:true});});
app.delete("/api/admin/notice/:id",needAdmin,async(req,res)=>{await pool.query("DELETE FROM notices WHERE id=$1",[req.params.id]);res.json({ok:true});});
app.post("/api/admin/report/:id",needAdmin,async(req,res)=>{await pool.query("UPDATE reports SET status=$1 WHERE id=$2",[req.body.status==="resolved"?"resolved":"ignored",req.params.id]);res.json({ok:true});});

app.get("/api/notices",async(req,res)=>{const r=await pool.query("SELECT * FROM notices ORDER BY created_at DESC LIMIT 10");res.json({notices:r.rows});});

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

initDb().then(()=>app.listen(PORT,()=>console.log("85班 running on "+PORT))).catch(e=>{console.error(e);process.exit(1);});