import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
const { Pool } = pg;
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({limit:'5mb'}));
const pool = new Pool({connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const sign=u=>jwt.sign({userId:u.user_id,role:u.role,departmentId:u.department_id},process.env.JWT_SECRET,{expiresIn:'8h'});
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Authentication required'});req.user=jwt.verify(h.slice(7),process.env.JWT_SECRET);next()}catch{return res.status(401).json({error:'Invalid or expired session'})}}
const requireRole=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'Access denied'});
const emptyState=()=>({members:[],dues:[],paid:[],remits:[],globalDues:[],deptLogos:{}});
async function ensureState(){await pool.query(`CREATE TABLE IF NOT EXISTS app_state (state_id integer PRIMARY KEY DEFAULT 1,state_json jsonb NOT NULL DEFAULT '{"members":[],"dues":[],"paid":[],"remits":[],"globalDues":[],"deptLogos":{}}'::jsonb,updated_at timestamptz NOT NULL DEFAULT now())`);await pool.query(`INSERT INTO app_state(state_id) VALUES (1) ON CONFLICT (state_id) DO NOTHING`)}
app.get('/api/health',async(_req,res)=>{try{await pool.query('select 1');await ensureState();res.json({ok:true,database:'connected',mode:'v37-central-bridge'})}catch(e){res.status(503).json({ok:false,database:'unavailable',error:e.message})}});
app.post('/api/auth/login',async(req,res)=>{const {username,password}=req.body||{};if(!username||!password)return res.status(400).json({error:'Username and password are required'});const {rows}=await pool.query('select user_id,username,password_hash,role,department_id,first_login,status from users where lower(username)=lower($1)',[username.trim()]);const u=rows[0];if(!u||u.status!=='active'||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:'Invalid credentials'});res.json({token:sign(u),user:{userId:u.user_id,username:u.username,role:u.role,departmentId:u.department_id,firstLogin:u.first_login}})});
app.post('/api/auth/change-password',auth,async(req,res)=>{const {currentPassword,newPassword}=req.body||{};if(!currentPassword||!newPassword||newPassword.length<10)return res.status(400).json({error:'New password must be at least 10 characters'});const {rows}=await pool.query('select password_hash from users where user_id=$1',[req.user.userId]);if(!rows[0]||!(await bcrypt.compare(currentPassword,rows[0].password_hash)))return res.status(401).json({error:'Current password is incorrect'});const hash=await bcrypt.hash(newPassword,12);await pool.query('update users set password_hash=$1,first_login=false,updated_at=now() where user_id=$2',[hash,req.user.userId]);res.json({ok:true})});
app.get('/api/me',auth,async(req,res)=>{const {rows}=await pool.query('select user_id,username,role,department_id,first_login,status from users where user_id=$1',[req.user.userId]);res.json(rows[0]||null)});
function deptOfMember(m){return m?.dept||null}
function scopeState(state,user){
 const s=state||emptyState();
 if(user.role==='admin'||user.role==='overall_treasurer') return s;
 if(user.role==='department_treasurer'){
   const dept=String(user.departmentId||'');
   const members=s.members.filter(m=>m.dept===dept);
   const ids=new Set(members.map(m=>m.id));
   const dues=s.dues.filter(d=>d.dept===dept).map(d=>({...d,assignedTo:Array.isArray(d.assignedTo)?d.assignedTo.filter(id=>ids.has(id)):[]}));
   const dueIds=new Set(dues.map(d=>d.id));
   return {members,dues,paid:s.paid.filter(p=>ids.has(p.member)&&dueIds.has(p.due)),remits:s.remits.filter(r=>r.dept===dept),globalDues:s.globalDues||[],deptLogos:{[dept]:s.deptLogos?.[dept]||null}};
 }
 if(user.role==='member'){
   const member=s.members.find(m=>m.id===user.username||m.userId===user.userId||m.user_id===user.userId);
   if(!member) return emptyState();
   const dues=s.dues.filter(d=>d.dept===member.dept && Array.isArray(d.assignedTo)&&d.assignedTo.includes(member.id));
   const ids=new Set(dues.map(d=>d.id));
   return {members:[member],dues,paid:s.paid.filter(p=>p.member===member.id&&ids.has(p.due)),remits:[],globalDues:s.globalDues||[],deptLogos:{[member.dept]:s.deptLogos?.[member.dept]||null}};
 }
 return emptyState();
}
app.get('/api/state',auth,async(req,res)=>{try{await ensureState();const {rows}=await pool.query('select state_json from app_state where state_id=1');res.json(scopeState(rows[0]?.state_json||emptyState(),req.user));}catch(e){res.status(500).json({error:'Could not load central state'})}});
app.put('/api/state',auth,async(req,res)=>{try{await ensureState();const incoming=req.body||{};const {rows}=await pool.query('select state_json from app_state where state_id=1');const current=rows[0]?.state_json||emptyState();let next;
 if(req.user.role==='admin'||req.user.role==='overall_treasurer') next={...emptyState(),...incoming};
 else if(req.user.role==='department_treasurer'){
   const dept=String(req.user.departmentId||'');
   const keepMembers=current.members.filter(m=>m.dept!==dept); const keepDues=current.dues.filter(d=>d.dept!==dept); const keepPaid=current.paid.filter(p=>{const m=current.members.find(x=>x.id===p.member);return m?.dept!==dept}); const keepRemits=current.remits.filter(r=>r.dept!==dept);
   next={...current,members:[...keepMembers,...(incoming.members||[])],dues:[...keepDues,...(incoming.dues||[])],paid:[...keepPaid,...(incoming.paid||[])],remits:[...keepRemits,...(incoming.remits||[])],globalDues:current.globalDues||[],deptLogos:{...(current.deptLogos||{}),[dept]:incoming.deptLogos?.[dept]||current.deptLogos?.[dept]||null}};
 } else return res.status(403).json({error:'Members are view-only'});
 await pool.query('update app_state set state_json=$1::jsonb,updated_at=now() where state_id=1',[JSON.stringify(next)]);res.json({ok:true,state:scopeState(next,req.user)});
 }catch(e){res.status(500).json({error:'Could not save central state',detail:e.message})}});
app.get('/api/dashboard',auth,requireRole('admin','overall_treasurer'),async(req,res)=>{try{const {rows}=await pool.query('select state_json from app_state where state_id=1');const s=rows[0]?.state_json||emptyState();const out=(s.members?Array.from(new Set(s.members.map(m=>m.dept))):[]).map(dept=>{const members=s.members.filter(m=>m.dept===dept);const ids=new Set(members.map(m=>m.id));const dues=s.dues.filter(d=>d.dept===dept&&Array.isArray(d.assignedTo));const assigned=dues.reduce((a,d)=>a+d.amount*(d.assignedTo||[]).filter(id=>ids.has(id)).length,0);const collected=s.paid.filter(p=>ids.has(p.member)).reduce((a,p)=>a+Number(p.amount||0),0);const rem=s.remits.filter(r=>r.dept===dept).slice(-1)[0];return {department:dept,members:members.length,assigned,collected,outstanding:Math.max(assigned-collected,0),remitted:Number(rem?.amount||0)};});res.json(out)}catch(e){res.status(500).json({error:'Could not load dashboard'})}});
const port=process.env.PORT||3000;
ensureState().catch(()=>{}).finally(()=>app.listen(port,()=>console.log(`CAANHS Dues API v3 listening on ${port}`)));
