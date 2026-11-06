import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
import worker,{digest} from '../worker.mjs';
import {DB} from './db.mjs';
const htmlURL=existsSync(new URL('../index.html',import.meta.url))?new URL('../index.html',import.meta.url):new URL('../../index.html',import.meta.url);
const html=readFileSync(htmlURL,'utf8');
const main=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(x=>!x[1].includes('src=')&&!x[1].includes('application/json'))[2];
new vm.Script(main);
function browser(env,saved={}){
 const elements=new Map(),ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 function el(id){if(elements.has(id))return elements.get(id);const e={id,value:'',textContent:'',innerHTML:'',hidden:false,style:{},dataset:{},events:{},children:[],classList:{add(){},remove(){},contains(){return false;}},setAttribute(){},addEventListener(k,f){this.events[k]=f;},querySelector(){return el(id+'-span');},querySelectorAll(){return [];},appendChild(node){this.children.push(node);},append(...nodes){this.children.push(...nodes);},showModal(){this.open=true;},close(){this.open=false;},focus(){},select(){},click(){return this.events.click?.({});}};elements.set(id,e);return e;}
 const grades=[1,2,3,4,5].map(g=>{const e=el('grade-'+g);e.dataset.grade=''+g;return e;});
 el('import-grade').value='5';el('import-mode').value='both';el('mode').value='full';
 const document={getElementById(id){assert(ids.has(id),'missing element '+id);return el(id);},querySelector(q){return q.includes('practice-mode')?el('mode'):el(q);},querySelectorAll(q){return q==='.grade-btn'||q==='.grade-btn,.num-btn'?grades:[];},createElement:tag=>el('new-'+tag+'-'+Math.random()),body:{appendChild(){},removeChild(){}}};
 const storage={...saved};
 const ctx={document,window:{innerWidth:1000,E_WRITING_API:'https://api.example',addEventListener(){}},crypto,TextEncoder,structuredClone,AbortController,setTimeout,clearTimeout,Blob,URL,console,localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]},navigator:{},alert(){},confirm:()=>true,prompt:()=>null,
 fetch:async(url,options)=>worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:env.FRONTEND_ORIGIN,'CF-Connecting-IP':'test-browser'}}),env)};
 vm.createContext(ctx);vm.runInContext(main,ctx);
 return {el,ctx,storage,run:code=>vm.runInContext(code,ctx)};
}
test('Cloud frontend login, class selection, teacher editing and student sync',async()=>{
 const env={DB:new DB(),FRONTEND_ORIGIN:'https://bingley-a.github.io'};
 await env.DB.prepare('INSERT INTO teacher_invites VALUES(?,1,?)').bind(await digest('teacher-frontend'),Date.now()+100000).run();
 const teacher=browser(env);teacher.el('student-nickname').value='前端老师';teacher.el('student-password').value='password123';teacher.el('teacher-invite').value='teacher-frontend';
 await teacher.run('authenticate(true)');assert.equal(teacher.run('activeStudent.role'),'teacher');
 const created=await teacher.run("api('/classes','POST',{name:'测试班',library:{1:[],2:[],3:[],4:[],5:[]}})");teacher.ctx.created=created;
 await teacher.run('refreshClasses(created.class.id)');assert.equal(teacher.run('currentClass.name'),'测试班');
 const word={word:'阿姨',pinyin:'ā yí',english:'aunt',syllables:[{char:'阿',pinyinBase:'a',tone:1,initial:'无',final:'a'},{char:'姨',pinyinBase:'yi',tone:2,initial:'y',final:'i'}]};
 teacher.el('import-json').value=JSON.stringify([word]);await teacher.el('confirm-import').click();assert.equal(teacher.run('gradeWords[5].length'),1);assert.equal(teacher.run('cloudVersion'),2);
 const student=browser(env);student.el('student-nickname').value='前端学生';student.el('student-password').value='password123';await student.run('authenticate(true)');
 student.ctx.code=created.class.joinCode;await student.run("api('/classes/join','POST',{code})");student.ctx.classId=created.class.id;await student.run('refreshClasses(classId)');assert.equal(student.run('gradeWords[5][0].word'),'阿姨');
 assert.equal(student.el('cloud-library-tools').hidden,true);assert.equal(await student.run('commitCloudEdits([])'),false);
 word.english='new meaning';teacher.el('import-json').value=JSON.stringify([word]);await teacher.el('confirm-import').click();await student.run('syncLibrary()');assert.equal(student.run('gradeWords[5][0].english'),'new meaning');
 await student.run('startGame()');assert.equal(student.run('activeRound.classId'),created.class.id);student.run('wordCorrectStatus[0]=true;recordFinishedWord();finishLearningRecord("已完成")');await student.run('cloudQueue');
 const results=await teacher.run("api('/classes/'+currentClass.id+'/records')");assert.equal(results.records.length,1);assert.equal(results.records[0].score,1);
 await teacher.el('clear-grade-mode').click();await student.run('syncLibrary()');assert.equal(student.run('gradeWords[5].length'),0);
 const restored=browser(env,student.storage);await new Promise(r=>setTimeout(r,30));assert.equal(restored.run('activeStudent.nickname'),'前端学生');
 env.DB.db.close();
});
