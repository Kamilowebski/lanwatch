const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createSnippetStore}=require('./snippets');
const value={title:'Test',description:'Opis',platform:'Windows',shell:'PowerShell',category:'Sieć',tags:'test, diagnostyka',command:'  Write-Host "{{HOST}}"\r\nGet-Date\r\n',favorite:false};
test('snippet CRUD preserves literal content and favorite updates do not change commands',()=>{
 const db=new DatabaseSync(':memory:');try{
  const store=createSnippetStore(db),count=store.list().length;
  const created=store.create(value);assert.equal(created.command,value.command);assert.equal(store.list().length,count+1);
  const favorite=store.favorite(created.id,true);assert.equal(favorite.favorite,true);assert.equal(favorite.command,value.command);
  const updated=store.update(created.id,{...value,title:'Changed',favorite:true});assert.equal(updated.title,'Changed');
  store.remove(created.id);assert.throws(()=>store.remove(created.id),{status:404});
 }finally{db.close();}
});
test('snippet import validates the entire batch and never reseeds a cleared library',()=>{
 const db=new DatabaseSync(':memory:');try{
  const store=createSnippetStore(db),before=store.list().length;
  assert.throws(()=>store.import({version:1,snippets:[value,{...value,platform:'invalid'}]}),{status:400});
  assert.equal(store.list().length,before);
  assert.deepEqual(store.import({version:1,snippets:[value,{...value,title:'Second'}]}),{imported:2});
  assert.equal(store.list().length,before+2);
  for(const entry of store.list())store.remove(entry.id);
  assert.equal(createSnippetStore(db).list().length,0);
 }finally{db.close();}
});
