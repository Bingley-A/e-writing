import {randomBytes,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const code='TEACHER-'+randomBytes(18).toString('hex');
const hash=createHash('sha256').update(code).digest('hex');
const expiryDate=new Date();
expiryDate.setUTCFullYear(expiryDate.getUTCFullYear()+1);
const expiry=expiryDate.getTime();
writeFileSync('invite.sql',`INSERT INTO teacher_invites(code_hash,remaining,expires_at) VALUES('${hash}',1,${expiry});\n`);
console.log('教师专用邀请码（一年有效，仅可使用一次，请私下发送给老师）：\n'+code+'\n下一步执行：npx wrangler d1 execute e-writing-classroom --remote --file=invite.sql');
