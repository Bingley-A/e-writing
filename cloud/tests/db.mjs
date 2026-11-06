import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export class DB {
  constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));}
  prepare(sql){const db=this.db;return {args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(sql).get(...this.args)||null;},async all(){return {results:db.prepare(sql).all(...this.args)};},async run(){const info=db.prepare(sql).run(...this.args);return {meta:{changes:Number(info.changes)}};}};}
  async batch(statements){this.db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());this.db.exec('COMMIT');return results;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
