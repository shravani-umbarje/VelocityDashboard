import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { io, Socket } from "socket.io-client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
type User = { id:string; name:string; email:string; role:"ADMIN"|"PM"|"DEVELOPER" };
type Project = { id:string; name:string; description?:string; client?:{name:string}; _count?:{tasks:number} };
type Task = { id:number; title:string; description?:string; status:string; priority:string; dueDate:string; assignedDeveloper?:{id:string;name:string} };
type Activity = { id:string; message:string; createdAt:string; actor?:{name:string}; project?:{name:string} };

axios.defaults.withCredentials = true;
let accessToken = "";

async function refresh() {
  const r = await axios.post(`${API}/api/auth/refresh`);
  accessToken = r.data.accessToken;
  return r.data.user as User;
}
async function api<T>(method:string, path:string, data?:unknown) {
  return axios.request<T>({ method, url:`${API}${path}`, data, headers:{ Authorization:`Bearer ${accessToken}` }});
}
function timeAgo(iso:string) {
  const mins = Math.max(0, Math.floor((Date.now()-new Date(iso).getTime())/60000));
  return mins < 1 ? "just now" : mins === 1 ? "1 min ago" : `${mins} mins ago`;
}

function Login({onLogin}:{onLogin:(u:User)=>void}) {
  const [email,setEmail]=useState("admin@velozity.local");
  const [password,setPassword]=useState("Password@123");
  const [busy,setBusy]=useState(false); const [err,setErr]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setErr("");
    try { const r=await axios.post(`${API}/api/auth/login`,{email,password}); accessToken=r.data.accessToken; onLogin(r.data.user); }
    catch(e:any){setErr(e?.response?.data?.error?.message||"Login failed");} finally{setBusy(false);}
  }
  return <div className="login-shell"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark">V</div><h1>Velozity</h1><p>Client Project Control Center</p>
    <label>Email<input value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {err&&<div className="error">{err}</div>}<button disabled={busy}>{busy?"Signing in…":"Sign in"}</button>
    <small>Seed users: admin@velozity.local / Password@123</small>
  </form></div>
}

function App({user,onLogout}:{user:User;onLogout:()=>void}) {
  const [projects,setProjects]=useState<Project[]>([]);
  const [selected,setSelected]=useState<Project|null>(null);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [activities,setActivities]=useState<Activity[]>([]);
  const [notifications,setNotifications]=useState<any[]>([]);
  const [unread,setUnread]=useState(0);
  const [presence,setPresence]=useState(0);
  const [filterStatus,setFilterStatus]=useState(""); const [filterPriority,setFilterPriority]=useState("");
  const [socket,setSocket]=useState<Socket|null>(null);
  const [dashboard,setDashboard]=useState<any>({});

  useEffect(()=>{ (async()=>{
    try { await api("get","/api/projects").then(r=>setProjects((r.data as any).projects));
      await api("get","/api/notifications").then(r=>{setNotifications((r.data as any).notifications);setUnread((r.data as any).unread)});
      await api("get","/api/dashboard").then(r=>setDashboard(r.data));
    } catch(e:any){ if(e?.response?.status===401){try{const u=await refresh(); location.reload();}catch{onLogout();}}}
  })(); },[]);

  useEffect(()=>{
    const s=io(API,{auth:{token:accessToken},withCredentials:true});
    s.on("presence:update",(d)=>setPresence(d.count));
    s.on("notification:new",(n)=>{setNotifications(x=>[n,...x]);setUnread(x=>x+1)});
    s.on("activity:global",(a)=>{if(user.role==="ADMIN")setActivities(x=>[a,...x].slice(0,50))});
    s.on("activity:new",(a)=>{setActivities(x=>[...x.filter(v=>v.id!==a.id),a].slice(-50))});
    s.emit("presence:request"); setSocket(s); return()=>{s.disconnect()};
  },[]);

  async function selectProject(p:Project){
    setSelected(p); setActivities([]);
    socket?.emit("project:join",p.id);
    const params=new URLSearchParams(); if(filterStatus)params.set("status",filterStatus);if(filterPriority)params.set("priority",filterPriority);
    const [t,a]=await Promise.all([
      api("get",`/api/projects/${p.id}/tasks?${params.toString()}`),
      api("get",`/api/projects/${p.id}/activity`)
    ]);
    setTasks((t.data as any).tasks); setActivities((a.data as any).activities);
  }
  async function changeStatus(id:number,status:string){
    await api("patch",`/api/tasks/${id}/status`,{status});
    if(selected) selectProject(selected);
  }
  async function readOne(id:string){await api("patch",`/api/notifications/${id}/read`);setNotifications(x=>x.map(n=>n.id===id?{...n,isRead:true}:n));setUnread(x=>Math.max(0,x-1))}
  async function readAll(){await api("patch","/api/notifications/read-all");setNotifications(x=>x.map(n=>({...n,isRead:true})));setUnread(0)}
  const statusCounts=useMemo(()=>tasks.reduce((a,t)=>(a[t.status]=(a[t.status]||0)+1,a),{} as Record<string,number>),[tasks]);

  return <div className="app">
    <header><div className="logo">VELOZITY</div><div className="header-right"><span className="online">● {presence} online</span><span className="role">{user.role}</span>
      <details className="notif"><summary>🔔 {unread}</summary><div className="dropdown"><div className="drop-head"><b>Notifications</b><button onClick={readAll}>Read all</button></div>
      {notifications.length?notifications.slice(0,8).map(n=><div className={n.isRead?"notice":"notice unread"} key={n.id} onClick={()=>readOne(n.id)}><b>{n.title}</b><span>{n.body}</span></div>):<p>No notifications</p>}</div></details>
      <span>{user.name}</span><button className="ghost" onClick={onLogout}>Logout</button></div></header>
    <main>
      <aside><h3>Projects</h3>{projects.map(p=><button key={p.id} className={selected?.id===p.id?"project active":"project"} onClick={()=>selectProject(p)}><b>{p.name}</b><span>{p.client?.name||"Client"} · {p._count?.tasks||0} tasks</span></button>)}</aside>
      <section className="content">
        <div className="hero"><div><div className="eyebrow">{user.role} DASHBOARD</div><h2>{selected?selected.name:"Project Overview"}</h2><p>{selected?.description||"Manage projects, tasks and live team activity."}</p></div></div>
        <div className="stats">
          <div><small>Projects</small><strong>{dashboard.projects?.length??dashboard.projects??projects.length}</strong></div>
          <div><small>Tasks shown</small><strong>{selected?tasks.length:(dashboard.tasks?.length||"—")}</strong></div>
          <div><small>In progress</small><strong>{statusCounts.IN_PROGRESS||0}</strong></div>
          <div><small>Overdue</small><strong>{dashboard.overdue??tasks.filter(t=>t.status==="OVERDUE").length}</strong></div>
        </div>
        {selected&&<div className="workspace">
          <div className="panel"><div className="panel-head"><h3>Tasks</h3><div className="filters">
            <select value={filterStatus} onChange={e=>{setFilterStatus(e.target.value);setTimeout(()=>selected&&selectProject(selected),0)}}><option value="">All status</option><option value="TODO">To Do</option><option value="IN_PROGRESS">In Progress</option><option value="IN_REVIEW">In Review</option><option value="DONE">Done</option><option value="OVERDUE">Overdue</option></select>
            <select value={filterPriority} onChange={e=>{setFilterPriority(e.target.value);setTimeout(()=>selected&&selectProject(selected),0)}}><option value="">All priority</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select>
          </div></div>
          <div className="task-list">{tasks.map(t=><div className="task" key={t.id}><div><span className={`pill ${t.priority.toLowerCase()}`}>{t.priority}</span><h4>#{t.id} {t.title}</h4><p>{t.description||"No description"} · Due {new Date(t.dueDate).toLocaleDateString()}</p></div>
            <div className="task-right"><span className={`status ${t.status.toLowerCase()}`}>{t.status.replaceAll("_"," ")}</span>{user.role==="DEVELOPER"&&t.status!=="DONE"&&t.status!=="OVERDUE"&&<select value={t.status} onChange={e=>changeStatus(t.id,e.target.value)}><option value="TODO">To Do</option><option value="IN_PROGRESS">In Progress</option><option value="IN_REVIEW">In Review</option><option value="DONE">Done</option></select>}</div></div>)}</div></div>
          <div className="panel"><div className="panel-head"><h3>Live Activity</h3><span className="live-dot">LIVE</span></div><div className="feed">{activities.map(a=><div className="feed-item" key={a.id}><div className="dot"></div><div><b>{a.message}</b><span>{timeAgo(a.createdAt)}</span></div></div>)}</div></div>
        </div>}
        {!selected&&<div className="empty"><div className="empty-icon">↗</div><h3>Select a project</h3><p>Choose a project to view role-filtered tasks and its live activity feed.</p></div>}
      </section>
    </main>
  </div>
}

function Root(){
  const [user,setUser]=useState<User|null>(null); const [loading,setLoading]=useState(true);
  useEffect(()=>{refresh().then(setUser).catch(()=>{}).finally(()=>setLoading(false))},[]);
  if(loading)return <div className="loading">Loading…</div>;
  return user?<App user={user} onLogout={async()=>{await axios.post(`${API}/api/auth/logout`);accessToken="";setUser(null)}}/>:<Login onLogin={setUser}/>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Root/></React.StrictMode>);
