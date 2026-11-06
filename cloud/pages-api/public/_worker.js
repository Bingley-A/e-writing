const encoder=new TextEncoder();
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
}
function fail(status,message){throw Object.assign(new Error(message),{status});}
function text(value,max=80){if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,'必填内容为空或长度不符合要求');return value.trim();}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'}});}
async function body(request){
  if(Number(request.headers.get('Content-Length')||0)>1500000)fail(413,'提交内容过大');
  const reader=request.body?.getReader();if(!reader)fail(400,'缺少提交资料');
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1500000){await reader.cancel();fail(413,'提交内容过大');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'JSON 格式错误');}
}
export function validateLibrary(library){
  if(!library||Array.isArray(library)||typeof library!=='object')fail(400,'词库必须按年级分组');
  let count=0;
  for(const [grade,words] of Object.entries(library)){
    if(!['1','2','3','4','5'].includes(grade)||!Array.isArray(words))fail(400,'词库年级格式错误');
    const seen=new Set();
    for(const w of words){
      text(w?.word,40);text(w.pinyin,200);text(w.english,500);
      if(!/^[\u3400-\u9fff]+$/u.test(w.word)||!Array.isArray(w.syllables)||w.syllables.length!==Array.from(w.word).length)fail(400,'词语与逐字资料不匹配');
      const modes=w.modes||['full','listen'];
      if(!Array.isArray(modes)||!modes.length||new Set(modes).size!==modes.length||modes.some(m=>!['full','listen'].includes(m)))fail(400,'模式错误');
      for(const m of modes){const key=w.word+':'+m;if(seen.has(key))fail(400,'同年级同模式词语重复');seen.add(key);}
      w.syllables.forEach((s,i)=>{
        if(s?.char!==Array.from(w.word)[i]||!Number.isInteger(s.tone)||s.tone<0||s.tone>4||typeof s.initial!=='string'||!/^(?:|无|b|p|m|f|d|t|n|l|g|k|h|j|q|x|zh|ch|sh|r|z|c|s|y|w)$/.test(s.initial)||typeof s.pinyinBase!=='string'||!/^[a-zü]+$/u.test(s.pinyinBase)||typeof s.final!=='string'||!/^[a-zü]+$/u.test(s.final))fail(400,'逐字拼音字段格式错误，轻声请填0');
      });
      if(++count>10000)fail(400,'每个班级最多保存10000条词语');
    }
  }
  return library;
}
async function limited(env,key,limit=30){
  const window=Math.floor(Date.now()/900000),hash=await digest(key);
  const row=await env.DB.prepare('INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').bind(hash,window).first();
  if(row.count>limit)fail(429,'操作过于频繁，请15分钟后重试');
}
async function userFor(request,env){
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  if(!token||token.length!==64)fail(401,'请先登录');
  const user=await env.DB.prepare('SELECT u.id,u.nickname,u.role FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),Date.now()).first();
  if(!user)fail(401,'登录已过期，请重新登录');return user;
}
async function classFor(env,user,id,write=false){
  const row=await env.DB.prepare('SELECT * FROM classes WHERE id=?').bind(id).first();
  if(!row)fail(404,'班级不存在');
  if(row.teacher_id===user.id&&user.role==='teacher')return row;
  if(write)fail(403,'只有本班教师可以修改');
  if(!await env.DB.prepare('SELECT 1 FROM members WHERE class_id=? AND student_id=?').bind(id,user.id).first())fail(403,'你不属于这个班级');
  return row;
}
function publicClass(c){return {id:c.id,name:c.name,version:c.version,joinCode:c.join_code};}
export async function route(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(path==='/health'&&method==='GET')return json({ok:true});
  if((path==='/auth/register'||path==='/auth/login')&&method==='POST'){
    const data=await body(request),nickname=text(data.nickname,20),nameKey=nickname.normalize('NFKC').toLowerCase();
    if(typeof data.password!=='string'||data.password.length<8||data.password.length>128||!data.password.trim())fail(400,'密码需要8–128个字符');
    await limited(env,'ip:'+request.headers.get('CF-Connecting-IP'),40);
    await limited(env,'account:'+nameKey,15);
    let user;
    if(path.endsWith('register')){
      if(await env.DB.prepare('SELECT 1 FROM users WHERE name_key=?').bind(nameKey).first())fail(409,'昵称已注册');
      const id=crypto.randomUUID(),salt=random(),hash=await passwordHash(data.password,salt),now=Date.now();
      if(data.teacherInvite){
        const codeHash=await digest(text(data.teacherInvite,150));
        const results=await env.DB.batch([
          env.DB.prepare("INSERT INTO users(id,nickname,name_key,salt,password_hash,role,created_at) SELECT ?,?,?,?,?,'teacher',? WHERE EXISTS(SELECT 1 FROM teacher_invites WHERE code_hash=? AND remaining>0 AND expires_at>?)").bind(id,nickname,nameKey,salt,hash,now,codeHash,now),
          env.DB.prepare('UPDATE teacher_invites SET remaining=remaining-1 WHERE code_hash=? AND remaining>0 AND EXISTS(SELECT 1 FROM users WHERE id=?)').bind(codeHash,id)
        ]);
        if(!results[0].meta.changes)fail(400,'教师邀请码无效、已使用或已过期');
      }else await env.DB.prepare("INSERT INTO users VALUES(?,?,?,?,?,'student',?)").bind(id,nickname,nameKey,salt,hash,now).run();
      user=await env.DB.prepare('SELECT id,nickname,role FROM users WHERE id=?').bind(id).first();
    }else{
      const row=await env.DB.prepare('SELECT * FROM users WHERE name_key=?').bind(nameKey).first();
      const hash=await passwordHash(data.password,row?.salt||'invalid-account-salt');
      if(!row||hash!==row.password_hash)fail(401,'昵称或密码不正确');
      user={id:row.id,nickname:row.nickname,role:row.role};
    }
    const token=random();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),user.id,Date.now()+30*86400000).run();
    return json({user,token});
  }
  const user=await userFor(request,env);
  if(path==='/auth/me'&&method==='GET')return json({user});
  if(path==='/auth/logout'&&method==='POST'){
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(request.headers.get('Authorization').slice(7))).run();return json({ok:true});
  }
  if(path==='/classes'&&method==='GET'){
    const result=await env.DB.prepare('SELECT DISTINCT c.* FROM classes c LEFT JOIN members m ON c.id=m.class_id WHERE c.teacher_id=? OR m.student_id=? ORDER BY c.created_at DESC').bind(user.id,user.id).all();
    return json({classes:result.results.map(publicClass)});
  }
  if(path==='/classes'&&method==='POST'){
    if(user.role!=='teacher')fail(403,'只有教师可以创建班级');
    const data=await body(request),name=text(data.name,40);await limited(env,'create:'+user.id,10);
    const library=validateLibrary(data.library),id=crypto.randomUUID(),code=random().slice(0,16).toUpperCase();
    await env.DB.prepare('INSERT INTO classes(id,name,teacher_id,join_code,library,created_at) VALUES(?,?,?,?,?,?)').bind(id,name,user.id,code,JSON.stringify(library),Date.now()).run();
    return json({class:publicClass({id,name,version:1,join_code:code})},201);
  }
  if(path==='/classes/join'&&method==='POST'){
    if(user.role!=='student')fail(403,'只有学生账号可以加入班级');
    await limited(env,'join:'+user.id,20);
    const data=await body(request),code=text(data.code,32).toUpperCase();
    const c=await env.DB.prepare('SELECT * FROM classes WHERE join_code=?').bind(code).first();if(!c)fail(404,'班级邀请码不正确');
    await env.DB.prepare('INSERT OR IGNORE INTO members VALUES(?,?)').bind(c.id,user.id).run();return json({class:publicClass(c)});
  }
  const match=path.match(/^\/classes\/([^/]+)\/(library|records|members)$/);
  if(match){
    const [,id,resource]=match,c=await classFor(env,user,id,method!=='GET'||resource!=='library');
    if(resource==='library'&&method==='GET')return json(url.searchParams.get('version')===String(c.version)?{version:c.version,unchanged:true}:{version:c.version,library:JSON.parse(c.library)});
    if(resource==='library'&&method==='PUT'){
      const data=await body(request),library=validateLibrary(data.library);
      if(!Number.isInteger(data.version))fail(400,'缺少词库版本号');
      const result=await env.DB.prepare('UPDATE classes SET library=?,version=version+1 WHERE id=? AND version=? AND teacher_id=?').bind(JSON.stringify(library),id,data.version,user.id).run();
      if(!result.meta.changes)fail(409,'词库已被其他页面更新，请同步后重试');return json({version:data.version+1});
    }
    if(resource==='members'&&method==='GET'){
      const result=await env.DB.prepare('SELECT u.id,u.nickname FROM users u JOIN members m ON u.id=m.student_id WHERE m.class_id=? ORDER BY u.nickname LIMIT 1000').bind(id).all();return json({members:result.results});
    }
    if(resource==='records'&&method==='GET'){
      const before=Number(url.searchParams.get('before')||Date.now()+1);
      const rows=await env.DB.prepare('SELECT a.data,u.nickname FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.class_id=? AND a.updated_at<? ORDER BY a.updated_at DESC,a.id DESC LIMIT 100').bind(id,before).all();
      return json({records:rows.results.map(r=>({...JSON.parse(r.data),nickname:r.nickname}))});
    }
  }
  if(path==='/records'&&method==='GET'){
    const rows=await env.DB.prepare('SELECT data FROM attempts WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').bind(user.id).all();return json({records:rows.results.map(r=>JSON.parse(r.data))});
  }
  if(path==='/records'&&method==='PUT'){
    const data=await body(request);await classFor(env,user,text(data.classId,60));
    text(data.id,80);text(data.grade,40);
    if(!['full','listen'].includes(data.mode)||!['未完成','提前结束','已完成'].includes(data.status)||!Number.isInteger(data.total)||data.total<1||data.total>1000||!Number.isFinite(data.startedAt)||!Number.isFinite(data.elapsedMs)||data.elapsedMs<0||!Array.isArray(data.words)||data.words.length>data.total)fail(400,'成绩格式错误');
    const indexes=new Set();for(const w of data.words){text(w?.word,40);text(w.pinyin,200);if(typeof w.correct!=='boolean'||!Number.isInteger(w.index)||w.index<0||w.index>=data.total||indexes.has(w.index))fail(400,'逐词成绩格式错误');indexes.add(w.index);}
    if(data.status==='已完成'&&data.words.length!==data.total)fail(400,'完成词数不足');
    const old=await env.DB.prepare('SELECT class_id,started_at,finished,status FROM attempts WHERE user_id=? AND id=?').bind(user.id,data.id).first();
    if(old&&(old.class_id!==data.classId||old.started_at!==data.startedAt))fail(409,'练习身份不一致');
    if(old&&(old.finished>data.words.length||(old.status!=='未完成'&&data.status==='未完成')))return json({ok:true,ignored:true});
    const score=data.words.filter(w=>w.correct).length,now=Date.now();
    const record={id:data.id,classId:data.classId,startedAt:data.startedAt,grade:data.grade,mode:data.mode,total:data.total,status:data.status,elapsedMs:data.elapsedMs,words:data.words,score,updatedAt:now};
    await env.DB.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET updated_at=excluded.updated_at,score=excluded.score,finished=excluded.finished,status=excluded.status,data=excluded.data WHERE attempts.finished<=excluded.finished AND NOT(attempts.status!=\'未完成\' AND excluded.status=\'未完成\')').bind(data.id,user.id,data.classId,data.startedAt,now,data.grade,data.mode,data.total,score,data.words.length,data.status,JSON.stringify(record)).run();
    return json({ok:true});
  }
  fail(404,'接口不存在');
}
export default {async fetch(request,env){
  const origin=request.headers.get('Origin'),allowed=env.FRONTEND_ORIGIN;
  if(origin&&origin!==allowed)return json({error:'不允许的网站来源'},403);
  let response;
  try{response=request.method==='OPTIONS'?new Response(null,{status:204}):await route(request,env);}
  catch(e){response=json({error:e.status?e.message:'服务暂时不可用，请稍后重试'},e.status||503);}
  response.headers.set('Access-Control-Allow-Origin',allowed);
  response.headers.set('Vary','Origin');response.headers.set('Access-Control-Allow-Headers','Content-Type,Authorization');response.headers.set('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
  response.headers.set('X-Content-Type-Options','nosniff');return response;
}};
